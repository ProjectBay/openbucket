import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

/**
 * Resolver for {@link RawReq}, exported separately so it can be unit-tested
 * directly (NestJS wraps the inner factory inside the decorator otherwise).
 */
export const rawRequestFactory = (_data: unknown, ctx: ExecutionContext): IncomingMessage => {
  const req = ctx.switchToHttp().getRequest<IncomingMessage>();
  if (req.readableEnded) {
    throw new Error(
      'RawReq: request stream already consumed. ' +
        'Check that no upstream middleware (body-parser, multer, etc.) ' +
        'has been registered for this route.',
    );
  }
  return req;
};

/**
 * Returns the raw Node IncomingMessage for the current request.
 *
 * Used by streaming handlers (PUT object, UploadPart, etc.) that need to pipe
 * the body somewhere without buffering. Body parsing is disabled globally in
 * main.ts so the stream is still readable when this decorator fires (Express
 * does not consume it). WHITEPAPER §4.1.1.
 */
export const RawReq = createParamDecorator(rawRequestFactory);
