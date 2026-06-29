#!/usr/bin/env node
// Generate an argon2id hash for ADMIN_PASSWORD_HASH.
//
//   node scripts/hash-password.mjs 'my-strong-password'
//
// Copy the printed hash into your .env (ADMIN_PASSWORD_HASH=...) or pass it as
// `admin.passwordHash` to OpenBucketModule.forRoot(). Run on Node 20 (the
// backend's Node version — argon2 ships a native binding built against it).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const argon2 = require('argon2');

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs '<password>'");
  process.exit(1);
}

const hash = await argon2.hash(password, { type: argon2.argon2id });
console.log(hash);
