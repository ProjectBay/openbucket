import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Single-action authorization simulate request (§5.7, EPIC-11 TASK-3012).
 * `action` accepts either a bare op name (`GetObject`) or an IAM action
 * (`s3:GetObject`) — normalized server-side. `resource` is a resource ARN
 * (`arn:aws:s3:::bucket/key`). `secureTransport`/`sourceIp` are optional
 * hypothetical condition context; they default to a benign, allow-friendly
 * value so a raw scope's `aws:SecureTransport`/`aws:SourceIp` conditions don't
 * falsely deny. Bounded (closed max lengths) so a call can't fan out.
 */
export const SimulateRequestSchema = z
  .object({
    action: z.string().min(1).max(64),
    resource: z.string().min(1).max(2048),
    secureTransport: z.boolean().optional(),
    sourceIp: z.string().max(64).optional(),
  })
  .strict();

export class SimulateRequestDto extends createZodDto(SimulateRequestSchema) {}

/** Simulate response — the evaluator's decision for the given action+resource. */
export const SimulateResponseSchema = z.object({
  decision: z.enum(['allow', 'deny']),
});

export class SimulateResponseDto extends createZodDto(SimulateResponseSchema) {}
