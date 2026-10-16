import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { DmmfDatamodel } from '../../src/testing/drift.js';

const require = createRequire(import.meta.url);
const run = promisify(execFile);

export const DATASOURCE_HEADER = `generator client {
  provider        = "prisma-client"
  output          = "../generated"
  previewFeatures = ["partialIndexes"]
}

datasource db {
  provider = "postgresql"
  schemas  = ["core", "platform"]
}
`;

/** DMMF of a multi-file schema via @prisma/prisma-schema-wasm (no engine binary needed). */
export function getDmmf(files: [string, string][]): DmmfDatamodel {
  const wasm = require('@prisma/prisma-schema-wasm') as { get_dmmf(params: string): string };
  const dmmf = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema: files }))) as {
    datamodel: DmmfDatamodel;
  };
  return dmmf.datamodel;
}

/**
 * Runs the real `prisma validate` CLI on a temp project. Prisma 7 validates with WebAssembly; the CLI still
 * resolves a schema-engine binary at start-up (downloaded from binaries.prisma.sh). Pointing
 * PRISMA_SCHEMA_ENGINE_BINARY at a stub that is never executed by `validate` keeps the check offline.
 */
export async function prismaValidate(files: Record<string, string>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'asset-core-prisma-'));
  mkdirSync(join(dir, 'prisma', 'schema'), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'prisma', 'schema', name), text);
  writeFileSync(
    join(dir, 'prisma.config.ts'),
    `export default { schema: 'prisma/schema', datasource: { url: 'postgresql://u:p@127.0.0.1:1/db' } };\n`,
  );
  const stub = join(dir, 'schema-engine-stub');
  writeFileSync(stub, '#!/bin/sh\necho "schema engine not needed for validate" >&2\nexit 1\n');
  chmodSync(stub, 0o755);
  const cli = require.resolve('prisma/build/index.js');
  const { stdout, stderr } = await run(process.execPath, [cli, 'validate'], {
    cwd: dir,
    env: {
      ...process.env,
      PRISMA_SCHEMA_ENGINE_BINARY: process.env.PRISMA_SCHEMA_ENGINE_BINARY ?? stub,
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    },
    timeout: 120_000,
  });
  return stdout + stderr;
}
