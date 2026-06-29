/**
 * Re-export `ZodValidationPipe` from nestjs-zod so the rest of the codebase
 * imports it from a stable internal path. Registered globally via APP_PIPE in
 * CommonModule. See WHITEPAPER §1.6.3.
 */
export { ZodValidationPipe } from 'nestjs-zod';
