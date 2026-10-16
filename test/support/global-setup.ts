import { execFileSync } from 'node:child_process';
import { chownSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Starts one embedded PostgreSQL 18 cluster (embedded-postgres) for the test run, or uses DATABASE_URL_ADMIN
 * (a superuser URL of an existing server, e.g. the CI service container). PostgreSQL refuses to run as root:
 * when the tests run as root the cluster runs as the OS user `postgres` (EMBEDDED_PG_OS_USER) in a temp
 * directory owned by it.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  if (process.env.DATABASE_URL_ADMIN) {
    project.provide('adminUrl', process.env.DATABASE_URL_ADMIN);
    return () => Promise.resolve();
  }
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const osUser = isRoot ? (process.env.EMBEDDED_PG_OS_USER ?? 'postgres') : undefined;
  const parent = mkdtempSync(join(tmpdir(), 'asset-core-pg-'));
  if (osUser) {
    const uid = Number(execFileSync('id', ['-u', osUser]).toString().trim());
    const gid = Number(execFileSync('id', ['-g', osUser]).toString().trim());
    chownSync(parent, uid, gid);
  }
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: join(parent, 'data'),
    user: 'gp',
    password: 'gp',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => undefined,
    ...(osUser ? { postgresUser: osUser } : {}),
  });
  await pg.initialise();
  await pg.start();
  project.provide('adminUrl', `postgresql://gp:gp@127.0.0.1:${port}/postgres`);
  return async () => {
    await pg.stop().catch(() => undefined);
    rmSync(parent, { recursive: true, force: true });
  };
}
