/**
 * Jest `globalSetup`: clear the streamed-results scratch file so each run starts
 * from a clean slate and the emitted report reflects only this run.
 */
import { rmSync } from 'node:fs';

import { resultsFile } from './recorder';

export default async function globalSetup(): Promise<void> {
  rmSync(resultsFile(), { force: true });
}
