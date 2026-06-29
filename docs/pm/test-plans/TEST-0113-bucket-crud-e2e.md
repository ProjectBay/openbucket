---
id: TEST-0113
title: Bucket CRUD e2e
covers: [STORY-0108, TASK-0323, TASK-0324, TASK-0325, TASK-0326, TASK-0327, TASK-0328, TASK-0329, TASK-0330, TASK-0331]
status: done
level: e2e
---

## Goal
End-to-end verify every bucket-scope endpoint from §2.8.2 except those owned by other Stories (CORS config, versioning, lifecycle, object-lock, encryption, tagging/ACL/policy, list-type=2).

## Setup
- Boot backend, sign requests with aws4. Each case isolated to its own bucket.

## Cases
1. `PUT /b` → 200; `HEAD /b` → 200; `DELETE /b` → 204 (empty); `HEAD /b` → 404.
2. `PUT /b` then `PUT /b` → 409 `<Code>BucketAlreadyOwnedByYou</Code>`.
3. `PUT /b` then `PUT /b/k` then `DELETE /b` → 409 `<Code>BucketNotEmpty</Code>`.
4. `GET /b?location` → `<LocationConstraint>us-east-1</LocationConstraint>`.
5. `GET /b` (no list-type) → `<ListBucketResult>` v1 (Marker/NextMarker fields).
6. `GET /b?versions` → `<ListVersionsResult>`.
7. `GET /b?uploads` → `<ListMultipartUploadsResult>`.
8. `POST /b?delete` with `<Delete><Object><Key>k1</Key></Object>…</Delete>` → `<DeleteResult>` with one `<Deleted>` per key.
9. Stub endpoints: `?replication` → 404 `ReplicationConfigurationNotFoundError`; `?notification` → empty doc; `?accelerate` → `<Status>Suspended</Status>`; `?logging` → empty; `?requestPayment` → `<Payer>BucketOwner</Payer>`; `?website` → 501 `NotImplemented`.

## Tooling
- Framework: jest + supertest + aws4
- Runner: `nx e2e backend-e2e --testPathPattern=bucket-crud`

## Pass criteria
- [ ] All nine cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2501–2540)
