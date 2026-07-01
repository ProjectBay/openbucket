/**
 * Test-only fault injection (the Node equivalent of Go's gofail / Rust's `fail`
 * crate). A `faultpoint` is a NO-OP in normal operation and only fires when the
 * `OB_FAULT` environment variable names it — so it is inert in production and CI
 * (which never set OB_FAULT). It exists so the crash-consistency fault harness
 * (tests/fault/) can trigger a fault at an exact point in the write path
 * deterministically, instead of relying on timing races.
 *
 * Usage: `await faultpoint('after-rename')` at the interesting point.
 *   OB_FAULT=after-rename                → the process hard-exits (137) at that
 *                                          point, simulating SIGKILL / power cut.
 *   OB_FAULT=after-rename OB_FAULT_MODE=throw
 *                                        → throws instead (simulating a disk /
 *                                          commit error on the write's tail).
 */
export async function faultpoint(name: string): Promise<void> {
  if (process.env.OB_FAULT !== name) return;
  if ((process.env.OB_FAULT_MODE ?? 'crash') === 'throw') {
    throw new Error(`[faultpoint] injected error at '${name}'`);
  }
  // Simulate a crash / power loss: terminate immediately, no unwind, no commit.
  process.exit(137);
}
