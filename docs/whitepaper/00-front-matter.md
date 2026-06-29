# OpenBucket — Implementation White Paper

> **Status:** implementation plan (v1). This document specifies *how* OpenBucket is built, in enough detail that a senior engineer can implement directly from it. It is the operational sibling of [`ARCHITECTURE.md`](./ARCHITECTURE.md) (the *what*) and supersedes [`BACKEND-DESIGN.md`](./BACKEND-DESIGN.md) (the summary-level *how*) at the level of code.

---

## Scope

OpenBucket is a **single-container, single-process, self-contained S3-compatible object store** with an embedded admin UI. One Docker image, one Node process, one host-mounted volume. No external database, no sidecars.

This white paper covers the implementation in five sections:

| § | Section | Owner concern |
|---|---|---|
| **1** | [Backend Architecture & Bootstrap](#1-backend-architecture--bootstrap) | NestJS topology, the classifier middleware, config, filters, shutdown |
| **2** | [S3 Wire Protocol & SigV4 Authentication](#2-s3-wire-protocol--sigv4-authentication) | XML serialization, SigV4 reverse-verify, full operation route table, error taxonomy |
| **3** | [Persistence & Storage Layer](#3-persistence--storage-layer) | MikroORM entities, migrations, path-mirror BlobStore, two-phase commit, crash recovery |
| **4** | [Streaming I/O, Concurrency & Background Work](#4-streaming-io-concurrency--background-work) | PUT/GET streaming, multipart, range requests, the background tick scheduler |
| **5** | [Admin API, Frontend, Auth & Delivery](#5-admin-api-frontend-auth-flow--delivery) | Admin endpoints, JWT flow, Angular SPA, OpenAPI client gen, Docker, CI |

Each section is implementable from the code it contains. Cross-references between sections appear as `[see §N]`.

---

## Locked-in decisions (from `BACKEND-DESIGN.md` §0)

| Area | Choice |
|---|---|
| HTTP platform | Express adapter |
| Module topology | One Nest app, two controller trees (S3 + Admin) sharing services |
| ORM | MikroORM + `better-sqlite3` |
| Validation | `nestjs-zod` (Zod-derived DTOs, swagger-integrated) |
| Logging | `nestjs-pino` |
| Admin auth | JWT access (15 m) + refresh in HttpOnly cookie scoped to `/api/admin/auth` |
| S3 auth | SigV4 reverse-verify via `aws4`; chunked-payload signing rejected in v1 |
| Frontend contract | OpenAPI 3 → generated Angular client |
| Image base | `node:22-bookworm-slim` (not alpine — `better-sqlite3` glibc dependency) |
| Testing | Unit + e2e (supertest) + S3 conformance (aws-cli, mc, s3cmd) |

---

## How to read this document

The sections are intentionally vertically deep. Reading top-to-bottom is the recommended path for an engineer about to implement; reading by section is the right path for an engineer touching a specific subsystem. Each section assumes the locked-in decisions above and the context in `ARCHITECTURE.md` §§1–11.

The code samples are not pseudocode. File paths are intended to match the resulting source tree. Where an interface is consumed in one section and implemented in another, both sections name the same method signature.

---
