# Backlog

Ordered list of every Story in dependency-respecting topological
order. A Story never appears before something it is blocked by.

Epic order reflects the dependency graph:

```
EPIC-01 ──┬──▶ EPIC-03 ──┬──▶ EPIC-04 ──┐
          │              │              ├──▶ EPIC-02 ──▶ EPIC-06
          │              │              │
          └──▶ EPIC-05 ──┴──────────────┘
```

So Stories appear in the order:
**EPIC-01 → EPIC-03 → EPIC-04 → EPIC-05 → EPIC-02 → EPIC-06**.
Within each Epic, Stories follow numerical ID (which was allocated
in dependency order by the Epic agents).

Format: `STORY-NNNN — <title> — EPIC-NN — size`.

---

## EPIC-01 — Backend architecture & bootstrap (15)

1. STORY-0001 — Scaffold backend Nx app and directory layout — EPIC-01 — S
2. STORY-0002 — Implement bootstrap main.ts with Express adapter, Pino, timeouts — EPIC-01 — M
3. STORY-0003 — Implement opt-in body parsers for admin routes — EPIC-01 — XS
4. STORY-0004 — Compose AppModule root with ordered imports and middleware — EPIC-01 — M
5. STORY-0005 — Augment Express.Request with OpenBucketRequestContext — EPIC-01 — XS
6. STORY-0006 — Implement UUIDv7 request-id middleware — EPIC-01 — XS
7. STORY-0007 — Implement request classifier middleware (S3 vs admin vs SPA) — EPIC-01 — M
8. STORY-0008 — Wire CommonModule with global filters, pipes, interceptors — EPIC-01 — S
9. STORY-0009 — Implement S3ExceptionFilter scaffold (XML, request-id, kind gate) — EPIC-01 — S
10. STORY-0010 — Implement AdminExceptionFilter, catch-all filter, and Zod validation pipe — EPIC-01 — S
11. STORY-0011 — Implement Zod-validated env schema and AppConfigService — EPIC-01 — M
12. STORY-0012 — Add /api/admin/health and /api/admin/ready endpoints — EPIC-01 — S
13. STORY-0013 — Serve Angular admin SPA under /admin with cache headers and fallback — EPIC-01 — S
14. STORY-0014 — Implement ShutdownState service and in-flight tracker interceptor — EPIC-01 — S
15. STORY-0015 — Implement SIGTERM shutdown coordinator with drain deadline — EPIC-01 — M

## EPIC-03 — Persistence & storage layer (14)

16. STORY-0200 — MikroORM bootstrap with WAL PRAGMAs and request-scoped EM — EPIC-03 — M
17. STORY-0201 — Define core object entities (Bucket, ObjectEntity, ObjectVersion) — EPIC-03 — M
18. STORY-0202 — Define multipart entities (MultipartUpload, MultipartPart) — EPIC-03 — S
19. STORY-0203 — Define auth and admin entities (AccessKey, AdminUser, RefreshToken) — EPIC-03 — S
20. STORY-0204 — Define LifecycleState entity and persistence barrel — EPIC-03 — S
21. STORY-0205 — Initial migration and boot-time `migration:up` — EPIC-03 — M
22. STORY-0206 — Repository pattern (BucketRepository, ObjectRepository) — EPIC-03 — M
23. STORY-0207 — Filesystem-safe key encoding (`encodeKey`/`decodeKey`) — EPIC-03 — S
24. STORY-0208 — BlobStore — atomic stage-and-rename filesystem layer — EPIC-03 — L
25. STORY-0209 — Two-phase commit `ObjectWriterService` — EPIC-03 — M
26. STORY-0210 — Startup crash recovery and orphan-blob scan — EPIC-03 — M
27. STORY-0211 — Trash manifest schema and write-after-move ordering — EPIC-03 — XS
28. STORY-0212 — `KeyService.getSecret` interface for SigV4 lookup — EPIC-03 — S
29. STORY-0213 — Versioning storage (`VersionStoreService`, demote-on-write) — EPIC-03 — L

## EPIC-04 — Streaming, concurrency & background work (20)

30. STORY-0300 — RawReq decorator for unbuffered request streams — EPIC-04 — XS
31. STORY-0301 — PutObjectInterceptor with hash, size-cap, and MD5/SHA256 verification — EPIC-04 — M
32. STORY-0302 — PUT object handler streaming to BlobStore — EPIC-04 — S
33. STORY-0303 — GET object handler streaming from disk with fd cleanup — EPIC-04 — S
34. STORY-0304 — Single-range HTTP Range header parser — EPIC-04 — XS
35. STORY-0305 — InitiateMultipartUpload handler — EPIC-04 — S
36. STORY-0306 — UploadPart handler with O_EXCL staging and per-part ETag — EPIC-04 — M
37. STORY-0307 — CompleteMultipartUpload with 5 MiB minimum and multipart-ETag — EPIC-04 — M
38. STORY-0308 — AbortMultipartUpload handler — EPIC-04 — XS
39. STORY-0309 — HTTP server timeouts calibrated for object storage — EPIC-04 — XS
40. STORY-0310 — UV_THREADPOOL_SIZE=16 before any require — EPIC-04 — XS
41. STORY-0311 — Backpressure invariants and explicit highWaterMark settings — EPIC-04 — S
42. STORY-0312 — Concurrency invariants doc and O_EXCL collision tolerance — EPIC-04 — S
43. STORY-0313 — BackgroundService scheduler with no-pile-up semantics — EPIC-04 — M
44. STORY-0314 — LifecycleSweepRunner with cursor pagination and days/date eval — EPIC-04 — M
45. STORY-0315 — MultipartCleanupRunner tick — EPIC-04 — S
46. STORY-0316 — TrashPurgeRunner tick — EPIC-04 — S
47. STORY-0317 — OrphanScanRunner one-shot at bootstrap — EPIC-04 — S
48. STORY-0318 — Clock abstraction with TestClock and OPENBUCKET_TEST_MODE advance endpoint — EPIC-04 — S
49. STORY-0319 — ShutdownService 5-step ordering with stream drain deadline — EPIC-04 — M

## EPIC-05 — Admin API, frontend & auth flow (20)

50. STORY-0400 — Wire AdminModule tree and global JWT guard — EPIC-05 — S
51. STORY-0401 — Stand up AuthModule and AuthService — EPIC-05 — M
52. STORY-0402 — Implement RefreshTokenService with rotation and reuse revocation — EPIC-05 — M
53. STORY-0403 — Implement POST /api/admin/auth/login with refresh cookie — EPIC-05 — S
54. STORY-0404 — Implement POST /api/admin/auth/refresh — EPIC-05 — S
55. STORY-0405 — Implement POST /api/admin/auth/logout — EPIC-05 — XS
56. STORY-0406 — Implement GET /api/admin/auth/me — EPIC-05 — XS
57. STORY-0407 — Implement JwtAuthGuard global admin guard — EPIC-05 — S
58. STORY-0408 — Establish nestjs-zod DTO pattern with sample DTOs — EPIC-05 — S
59. STORY-0409 — Implement admin bucket endpoints — EPIC-05 — M
60. STORY-0410 — Implement admin object browser endpoints — EPIC-05 — M
61. STORY-0411 — Implement access-key management endpoints — EPIC-05 — M
62. STORY-0412 — Initial admin bootstrap and change-password flow — EPIC-05 — M
63. STORY-0413 — Implement AuditService and event catalogue — EPIC-05 — S
64. STORY-0414 — Bootstrap Angular SPA structure — EPIC-05 — S
65. STORY-0415 — Implement SPA routing and auth guards — EPIC-05 — S
66. STORY-0416 — Implement AuthService and single-retry refresh interceptor — EPIC-05 — M
67. STORY-0417 — Wire the generated OpenAPI client into the SPA — EPIC-05 — S
68. STORY-0418 — Object browser UI with prefix/delimiter pagination and uploads — EPIC-05 — M
69. STORY-0419 — Signal-based state store pattern — EPIC-05 — S

## EPIC-02 — S3 wire protocol & SigV4 (19)

70. STORY-0100 — S3 controller topology and dispatcher pattern — EPIC-02 — M
71. STORY-0101 — RouteResolver for virtual-host vs path-style routing — EPIC-02 — S
72. STORY-0102 — XML request/response handling — EPIC-02 — M
73. STORY-0103 — SigV4 verification core (header-based) and canonical request — EPIC-02 — M
74. STORY-0104 — Presigned URL verification — EPIC-02 — S
75. STORY-0105 — S3Error class hierarchy and error taxonomy — EPIC-02 — S
76. STORY-0106 — S3 XML exception filter — EPIC-02 — S
77. STORY-0107 — Service-scope operations (ListBuckets) — EPIC-02 — XS
78. STORY-0108 — Bucket CRUD and listing operations — EPIC-02 — M
79. STORY-0109 — Object CRUD operations — EPIC-02 — M
80. STORY-0110 — Multipart upload operations — EPIC-02 — M
81. STORY-0111 — Tagging, ACL, and Policy operations — EPIC-02 — M
82. STORY-0112 — Bucket CORS configuration operations — EPIC-02 — S
83. STORY-0113 — Bucket versioning operations — EPIC-02 — S
84. STORY-0114 — Bucket lifecycle configuration operations — EPIC-02 — S
85. STORY-0115 — Object lock configuration, retention, and legal hold — EPIC-02 — S
86. STORY-0116 — Bucket encryption operations — EPIC-02 — S
87. STORY-0117 — CORS preflight handling per bucket — EPIC-02 — S
88. STORY-0118 — ListObjectsV2 pagination with HMAC-sealed continuation token — EPIC-02 — M

## EPIC-06 — Build, CI & release (6)

89. STORY-0500 — OpenAPI export and Angular client generation pipeline — EPIC-06 — M
90. STORY-0501 — Docker multi-stage build image — EPIC-06 — M
91. STORY-0502 — CI base lint, unit, and e2e workflow — EPIC-06 — M
92. STORY-0503 — CI Docker image build workflow — EPIC-06 — S
93. STORY-0504 — CI S3 conformance suite (aws-cli, mc, s3cmd, AWS SDK) — EPIC-06 — L
94. STORY-0505 — Testing patterns — unit, e2e, and conformance sample templates — EPIC-06 — M

## EPIC-07 — Admin console UX & full S3 feature coverage (18)

> Added 2026-06-22 from a five-lens UX/UI review. All Stories `backlog`;
> Task/Test files are created at refinement (tasks enumerated inline per Story).
> Dependency-respecting order: foundations → core screens → feature screens.

95. STORY-0600 — Shared UX kit: toasts, confirm dialog, copy-button, live-region announcer — EPIC-07 — M
96. STORY-0601 — App-shell cleanup, brand component & page-header unification — EPIC-07 — M
97. STORY-0602 — Domain navigation, routing, breadcrumbs & 404 page — EPIC-07 — M
98. STORY-0603 — Buckets list on spartan-ng (create dialog, delete-confirm, badges, states) — EPIC-07 — M
99. STORY-0612 — Admin REST endpoints for the S3 config surface + client regeneration — EPIC-07 — L
100. STORY-0604 — Object browser rebuild: spartan table, multi-select, bulk delete, row actions — EPIC-07 — L
101. STORY-0605 — Object listing UX: pagination, page-size, prefix search, counts, deep-link — EPIC-07 — M
102. STORY-0606 — Upload UX overhaul: progress, drag affordance, cancel/retry, summary — EPIC-07 — M
103. STORY-0607 — Appearance & Settings screen (themes/dark/shell/locale) + change-password — EPIC-07 — M
104. STORY-0608 — Auth & login polish on the design system (login, force-rotate) — EPIC-07 — S
105. STORY-0609 — Dashboard / home overview — EPIC-07 — M
106. STORY-0610 — Command palette ⌘K & keyboard shortcuts — EPIC-07 — M
107. STORY-0611 — Access-keys management screen — EPIC-07 — M
108. STORY-0613 — Bucket-detail tabbed page (versioning, encryption, tagging, lifecycle, CORS, policy) — EPIC-07 — L
109. STORY-0614 — Object versions, tagging & retention UI — EPIC-07 — M
110. STORY-0615 — Presigned share links — EPIC-07 — S
111. STORY-0616 — Accessibility & inclusive-design hardening (WCAG 2.2 AA) — EPIC-07 — M
112. STORY-0617 — i18n completeness for feature screens — EPIC-07 — S
113. STORY-0119 — Chunked-upload signing (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`) — EPIC-02 — L
114. STORY-0120 — Unsigned trailer chunked upload (`STREAMING-UNSIGNED-PAYLOAD-TRAILER`) — EPIC-02 — M
115. STORY-0121 — Object-lock enforcement on delete (WORM) — EPIC-02 — S
116. STORY-0122 — SSE-S3 encryption at rest (real AES-256) — EPIC-03 — L

---

**Total: 116 Stories.**
