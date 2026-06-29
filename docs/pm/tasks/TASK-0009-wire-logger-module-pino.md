---
id: TASK-0009
title: Wire LoggerModule.forRootAsync with Pino redact and serializers
story: STORY-0004
status: done
type: implementation
size: S
---

## Description
Configure `LoggerModule.forRootAsync` inside `AppModule` per §1.3 with `pinoHttp` options: log level from `config.logLevel`, `genReqId` reading `req.openbucket.requestId` (fallback `randomUUID()`), `customProps` exposing `kind` and `bucket` from `req.openbucket`, redact paths for the five sensitive headers, `req` serializer projecting only `method`, `url`, `host`, `remoteAddress`, and `pino-pretty` transport only when `NODE_ENV === 'development'`.

## Files to create / modify
- `apps/openbucket-backend/src/app.module.ts` — modify

## Implementation notes
- Quote §1.3 (lines 266–301):
  ```ts
  LoggerModule.forRootAsync({
    inject: [AppConfigService],
    useFactory: (config: AppConfigService) => ({
      pinoHttp: {
        level: config.logLevel,
        genReqId: (req) =>
          (req as { openbucket?: { requestId?: string } }).openbucket?.requestId ?? randomUUID(),
        customProps: (req) => ({
          kind: (req as { openbucket?: { kind?: string } }).openbucket?.kind,
          bucket: (req as { openbucket?: { bucket?: string } }).openbucket?.bucket,
        }),
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["x-amz-content-sha256"]',
            'req.headers["x-amz-security-token"]',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          censor: '[redacted]',
        },
        serializers: {
          req: (req) => ({ method: req.method, url: req.url, host: req.headers.host, remoteAddress: req.remoteAddress }),
        },
        transport: config.nodeEnv === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
      },
    }),
  })
  ```
- All five redact paths are load-bearing for security; do not omit.

## Acceptance criteria
- [ ] `LoggerModule` is registered async, injecting `AppConfigService`.
- [ ] All five redact paths are present.
- [ ] `genReqId` resolves `req.openbucket.requestId` and falls back to `randomUUID()`.
- [ ] `customProps` emits `kind` and `bucket`.
- [ ] `transport` is `pino-pretty` only in development.

## Test obligations
- Unit: covered by [TEST-0004]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0008]

## References
- `docs/WHITEPAPER.md` §1.3 (lines 266–301)
