import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Bucket CORS config (STORY-0612 / TASK-1860). Mirrors the persisted
 * `CorsRule[]` shape; the rule item is a named component for clean codegen.
 */
const CorsRuleSchema = z
  .object({
    id: z.string().optional(),
    allowedOrigins: z.array(z.string()),
    allowedMethods: z.array(z.enum(['GET', 'PUT', 'POST', 'DELETE', 'HEAD'])),
    allowedHeaders: z.array(z.string()).optional(),
    exposeHeaders: z.array(z.string()).optional(),
    maxAgeSeconds: z.number().int().optional(),
  })
  .meta({ id: 'CorsRuleDto' });

export const CorsConfigSchema = z.object({ rules: z.array(CorsRuleSchema) }).strict();

export class CorsConfigDto extends createZodDto(CorsConfigSchema) {}
