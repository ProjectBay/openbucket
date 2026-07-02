# Concurrency invariants

OpenBucket is single-process and single-threaded on the JS side, so "concurrency"
means interleaving on the event loop — not parallel execution. The interesting
surface is between the event loop and (a) the libuv thread pool that runs `fs.*`
and (b) the SQLite driver's write serialization. WHITEPAPER §4.8.

| Scenario | Safe? | Mechanism |
|---|---|---|
| PUT `bucketA/keyA` and PUT `bucketB/keyB` concurrently | Yes | Distinct tmp files, distinct rename targets, distinct SQLite rows. No shared mutable state on the hot path. |
| PUT `bucket/key` from client X and client Y concurrently | Yes (last-rename-wins) | Both stream to distinct `tmp/<uuid>.tmp` paths. Both rename to `blobs/<bucket>/<key>`. POSIX `rename(2)` is atomic: the inode swap is instantaneous. Any reader that opened the file before the rename keeps reading the old inode (open fds survive unlink/rename). The row update is the linearization point — the second writer's SQLite transaction commits after the first and wins the ETag. |
| Multipart UploadPart same `uploadId`, different `partNumber` | Yes | Distinct `<N>.part.tmp` paths, distinct rename targets, distinct SQLite rows in `multipart_parts`. |
| Multipart UploadPart same `uploadId` and same `partNumber` from two clients | Yes (last-rename-wins) | Both stage to `<N>.part.tmp` — but `flags: 'wx'` (O_EXCL) means the second creates a *different* tmp file (we suffix a random nonce when we detect the collision; see code). Both rename to `<N>.part`. The second rename atomically replaces the first. The `multipart_parts` row is updated in a SQLite transaction; the later update wins per AWS semantics. |
| CompleteMultipartUpload while a UploadPart is in flight for the same upload | Tolerated | `CompleteMultipartUpload` reads the `multipart_parts` rows it cares about at the start of its transaction. If a part appears between then and the compose, it's ignored — the client gets the upload list it sent in the XML body. The orphan part file will be removed by the multipart-cleanup tick. |
| Concurrent SQLite writes | Serialized | `libsql` is synchronous; the driver enforces one writer at a time. WAL mode allows readers to proceed in parallel. Long transactions (the lifecycle sweep in particular) commit in batches to avoid blocking writers. |
| Concurrent SQLite reads | Yes | WAL readers don't block writers and aren't blocked by them, modulo the brief WAL-checkpoint window. |
| GET while DELETE happens | Yes | The reader has an open fd. `unlink(2)` removes the directory entry but the inode persists until the last fd closes. The GET drains successfully; the next GET gets 404. |
| Multipart compose while a part file is being read | N/A | Parts are not exposed via S3 GET. Only internal code paths read them, and the compose path is the only such reader. |

The collision-tolerant rename for same-`partNumber` concurrent uploads suffixes a
`randomUUID()` to the tmp path (`BlobStore.putPart`) so the second writer doesn't
fail the `'wx'` (O_EXCL) open; both rename to `<N>.part` and the last rename wins.
This is the only place the random suffix is needed beyond `BlobStore.putBlob`,
which already does it internally for single-shot PUTs.
