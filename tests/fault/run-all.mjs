// Run every fault attack and summarize. Exit code = total guarantee violations
// (0 = all held). See FINDINGS.md.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const attacks = readdirSync(HERE)
  .filter((f) => f.startsWith('attack-') && f.endsWith('.mjs'))
  .sort();

let total = 0;
const results = [];
for (const a of attacks) {
  console.log(`\n================ ${a} ================`);
  const r = spawnSync(process.execPath, [join(HERE, a)], { stdio: 'inherit' });
  const v = r.status ?? -1;
  results.push({ a, v });
  if (v > 0) total += v;
}

console.log('\n================ SUMMARY ================');
for (const { a, v } of results) console.log(`  ${v === 0 ? 'HELD' : 'VIOL'}  ${a}  (exit ${v})`);
console.log(`\nTotal guarantee violations across the suite: ${total}`);
process.exit(total);
