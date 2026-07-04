---
id: EPIC-09
title: Developer upload pipeline
status: backlog
whitepaper_section: "future — post-1.0 feature (extends §2, §4, §5)"
owner_area: backend
---

## Objective

Make OpenBucket the batteries-included **file backend for an app**, not just a
smaller MinIO. The recurring target user is an app developer (especially the
`@openbucket/nestjs` embedder) who stores user uploads and wants the whole
pipeline handled in-process: transform images on read, react to uploads, and let
browsers upload directly. This Epic delivers the three capabilities that turn the
"upload → OpenBucket → save the URL" recipe from *wire-it-up-yourself* into
*already-wired*, leaning on the one thing hosted S3/MinIO structurally cannot do —
run inside the host process.

## Scope

- In scope:
  - **On-the-fly image transformations** on GET (`?w=&h=&fit=&format=&q=`) with a
    cached, content-addressed derivative store. [STORY-0800]
  - **Object event notifications** — in-process typed NestJS events
    (`object.created` / `object.deleted` / multipart-completed) plus optional
    signed HTTP webhooks for the standalone image. [STORY-0801]
  - **Direct browser uploads** — presigned POST policy (form-based) + browser
    multipart helpers so uploads bypass the app server. [STORY-0802]
  - **Upload DX helpers** — higher-level `OpenBucketService` sugar (content-type
    sniffing, size/type validation, image metadata) that shrinks the recipe
    boilerplate. [STORY-0803]
- Out of scope:
  - Video transcoding / streaming media pipelines.
  - A full CDN — derivative caching is local; edge/CDN integration is separate.
  - Malware scanning (leave it to a host-app event handler, which STORY-0801 enables).

## Success criteria

- `GET /bucket/photo.jpg?w=200&h=200&fit=cover&format=webp&q=80` returns a
  correctly resized WebP, served from a cached derivative on repeat requests, with
  bounded/validated parameters (no transform-bomb DoS).
- A host NestJS app can register `@OnObjectCreated()` and receive a typed event for
  every stored object (S3 and admin paths); the standalone image can POST a signed
  webhook to a configured URL with at-least-once delivery + retry.
- A browser can upload a file directly to OpenBucket via a presigned POST returned
  by the host app, honoring content-length and content-type conditions.
- The docs' upload recipe is rewritten to use the new helpers and shrinks by ~half.

## Stories

- [STORY-0800] On-the-fly image transformations + derivative cache — tasks TASK-2400..2409, test TEST-0800
- [STORY-0801] Object event notifications (in-process events + webhooks) — tasks TASK-2410..2419, test TEST-0801
- [STORY-0802] Direct browser uploads (presigned POST) — tasks TASK-2420..2429, test TEST-0802
- [STORY-0803] Upload DX helpers on OpenBucketService — tasks TASK-2430..2439, test TEST-0803

## Dependencies

- Blocks: —
- Blocked by: none (builds on the existing object read/write + presign primitives).

## References

- `libs/nestjs/src/lib/s3/object/` (GET path), `domain/objects/object.service.ts`,
  `storage/` (blob store), `s3/sigv4/presigned.ts`, `open-bucket.service.ts`.
- Docs recipe: `libs/nestjs/README.md#recipe-accept-file-uploads-and-store-their-urls`.
