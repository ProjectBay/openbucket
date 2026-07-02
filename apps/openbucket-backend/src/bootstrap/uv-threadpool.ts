/**
 * Side-effect module: size the libuv thread pool before anything that uses it.
 *
 * Imported FIRST in main.ts. ES module imports execute their side effects in
 * source order, so this runs before @nestjs/*, libsql, etc. are
 * evaluated — which is the only reliable way to set UV_THREADPOOL_SIZE from
 * inside the bundle (a literal "first line" can't precede hoisted imports).
 * The production Dockerfile also sets `ENV UV_THREADPOOL_SIZE=16` as the
 * authoritative guarantee [EPIC-06]. See WHITEPAPER §4.6.
 *
 * 16 matches the v1 concurrent multipart-part cap and is bounded to avoid the
 * ~512 KB-per-thread stack cost on small containers.
 */
process.env.UV_THREADPOOL_SIZE ??= '16';

// Make this a module (not a global script) so it can be dynamically imported
// in tests; the side effect above still runs on first import.
export {};
