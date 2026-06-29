import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

/**
 * Shared boot + exec helpers for the CLI-matrix conformance suites (§5.20 closing
 * note): aws-cli / mc / s3cmd each shell out to their binary against the same
 * OpenBucket container. AWS's published example credentials are used as fixed
 * sentinels (safe to commit).
 */
export const CREDS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
} as const;

export interface RunningOpenbucket {
  container: StartedTestContainer;
  host: string;
  port: number;
  endpoint: string;
}

/** Boot the built image (OPENBUCKET_IMAGE, default openbucket:local) and wait for health. */
export async function startOpenbucket(): Promise<RunningOpenbucket> {
  const container = await new GenericContainer(process.env.OPENBUCKET_IMAGE ?? 'openbucket:local')
    .withExposedPorts(9000)
    .withEnvironment({
      DATA_DIR: '/data',
      JWT_SECRET: 'conformance-secret-conformance-secret',
      ROOT_ACCESS_KEY_ID: CREDS.accessKeyId,
      ROOT_SECRET_ACCESS_KEY: CREDS.secretAccessKey,
      // Required by the refuse-to-boot config schema (argon2id format).
      ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    })
    .withWaitStrategy(Wait.forHttp('/api/admin/health', 9000).forStatusCode(200))
    .withStartupTimeout(60_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(9000);
  return { container, host, port, endpoint: `http://${host}:${port}` };
}

const pexecFile = promisify(execFile);

/**
 * Run a CLI binary; on non-zero exit, surface its stderr/stdout in the thrown
 * error so a failing conformance assertion shows the client's own message
 * (TEST-0502: "no silent client errors").
 */
export async function run(
  bin: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await pexecFile(bin, args, {
      env: { ...process.env, ...env },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      `\`${bin} ${args.join(' ')}\` failed: ${err.stderr || err.stdout || err.message || 'unknown error'}`,
    );
  }
}

/** Like {@link run} but returns stdout as raw bytes (e.g. `mc cat` of a binary blob). */
export async function runBinary(
  bin: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<Buffer> {
  try {
    const { stdout } = await pexecFile(bin, args, {
      env: { ...process.env, ...env },
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'buffer',
    });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    throw new Error(`\`${bin} ${args.join(' ')}\` failed: ${String(err.stderr ?? err.message)}`);
  }
}
