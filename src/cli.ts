#!/usr/bin/env node
/* eslint-disable no-console */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGE_NAME, PACKAGE_VERSION } from './generated/assets.js';
import { assetCoreMigrate, assetCoreStatus, coreMigrationSql } from './migrate.js';
import { buildPrismaFragment } from './prisma-fragment.js';

const HELP = `${PACKAGE_NAME}@${PACKAGE_VERSION}

Usage: asset-core <command> [options]

Commands
  migrate [--url <url>] [--dry-run]   apply pending core migrations (default url: $DATABASE_URL)
  status  [--url <url>]               list core migrations and whether they are applied
  sql                                 print every core migration as one SQL script (Prisma initShadowDb, psql)
  prisma-fragment [--relations-from <dir|file> ...] [--out <file>]
                                      print prisma/core.prisma with the back-relations the app's models need
  version                             print the package version
`;

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function options(args: string[], name: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a === name && args[i + 1]) out.push(args[i + 1]!);
  });
  return out;
}

function prismaSources(paths: string[], exclude?: string): string[] {
  const files: string[] = [];
  for (const p of paths) {
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p)) if (f.endsWith('.prisma')) files.push(join(p, f));
    } else files.push(p);
  }
  return files.filter((f) => !exclude || !f.endsWith(exclude)).map((f) => readFileSync(f, 'utf8'));
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case 'migrate': {
      const result = await assetCoreMigrate({
        databaseUrl: option(args, '--url'),
        dryRun: args.includes('--dry-run'),
        log: (line) => console.log(line),
      });
      if (args.includes('--dry-run')) console.log(`asset-core: ${result.pending.length} pending`);
      return 0;
    }
    case 'status': {
      const status = await assetCoreStatus({ databaseUrl: option(args, '--url') });
      for (const s of status)
        console.log(`${s.state.padEnd(18)} ${s.id}${s.appliedAt ? `  ${s.appliedAt.toISOString()}` : ''}`);
      return status.some((s) => s.state === 'checksum_mismatch' || s.state === 'unknown') ? 1 : 0;
    }
    case 'sql':
      process.stdout.write(coreMigrationSql());
      return 0;
    case 'prisma-fragment': {
      const out = option(args, '--out');
      const sources = prismaSources(
        options(args, '--relations-from'),
        out ? out.split('/').pop() : 'core.prisma',
      );
      const text = buildPrismaFragment(sources);
      if (out) writeFileSync(out, text);
      else process.stdout.write(text);
      return 0;
    }
    case 'version':
    case '--version':
      console.log(PACKAGE_VERSION);
      return 0;
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      return command === undefined ? 64 : 0;
    default:
      console.error(`asset-core: unknown command "${command}"\n\n${HELP}`);
      return 64;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
