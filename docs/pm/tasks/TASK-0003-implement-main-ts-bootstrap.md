---
id: TASK-0003
title: Implement main.ts bootstrap function
story: STORY-0002
status: done
type: implementation
size: S
---

## Description
Author `apps/backend/src/main.ts` containing the async `bootstrap()` function exactly as specified in §1.2. Create the Express instance, instantiate the Nest app on `ExpressAdapter`, bind Pino via `app.useLogger(app.get(Logger))`, fetch `AppConfigService`, call `configureBodyParsers`, register shutdown handlers, and listen on `config.port` and `'0.0.0.0'`.

## Files to create / modify
- `apps/openbucket-backend/src/main.ts` — new

## Implementation notes
- Quote §1.2 verbatim:
  ```ts
  async function bootstrap(): Promise<void> {
    const expressInstance: Express = express();
    expressInstance.disable('x-powered-by');
    expressInstance.disable('etag');
    expressInstance.set('trust proxy', 'loopback');

    const app = await NestFactory.create<NestExpressApplication>(
      AppModule,
      new ExpressAdapter(expressInstance),
      {
        bufferLogs: true,
        rawBody: false,
        bodyParser: false,
      },
    );
    app.useLogger(app.get(Logger));
    ...
    await app.listen(config.port, '0.0.0.0');
    const url = await app.getUrl();
    app.get(Logger).log(`OpenBucket listening on ${url}`, 'Bootstrap');
  }
  ```
- `NestFactory.create` options object must be `{ bufferLogs: true, rawBody: false, bodyParser: false }` verbatim — these are load-bearing.
- Pino logger binding is via `app.useLogger(app.get(Logger))` from `nestjs-pino`.

## Acceptance criteria
- [ ] `apps/openbucket-backend/src/main.ts` exists and exports a `bootstrap` invocation at module scope.
- [ ] `NestFactory.create` is called with exactly `{ bufferLogs: true, rawBody: false, bodyParser: false }`.
- [ ] App listens on `config.port` and host `'0.0.0.0'`.
- [ ] Boot log line is `'OpenBucket listening on ${url}'` at the `Bootstrap` category.

## Test obligations
- Unit: covered by [TEST-0002]
- E2E: N/A — wider e2e covered by STORY-0007/0012/0013/0015 e2e plans
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001], [TASK-0007], [TASK-0030], [TASK-0040]

## References
- `docs/WHITEPAPER.md` §1.2 (lines 127–193)
