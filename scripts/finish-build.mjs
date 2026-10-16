#!/usr/bin/env node
// Post-build: mark dist/cjs as CommonJS (the package itself is "type": "module"), make the CLI executable and
// regenerate the JSON Schemas of the integration contracts from the freshly built ESM output.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
writeFileSync(join(root, 'dist/cjs/package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
chmodSync(join(root, 'dist/esm/cli.js'), 0o755);

const { integrationEventJsonSchemas } = await import(
  pathToFileURL(join(root, 'dist/esm/contracts/index.js')).href
);
const dir = join(root, 'schemas');
mkdirSync(dir, { recursive: true });
for (const [name, schema] of Object.entries(integrationEventJsonSchemas())) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(schema, null, 2) + '\n');
}
console.log('build: dist/esm, dist/cjs, schemas/*.json');
