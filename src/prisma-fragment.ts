import { CORE_PRISMA, PACKAGE_NAME, PACKAGE_VERSION } from './generated/assets.js';

/** The Prisma fragment of schema `core` exactly as shipped (prisma/core.prisma). */
export function corePrismaFragment(): string {
  return CORE_PRISMA;
}

/** Model names defined by the fragment (Tenant, Building, …). */
export function corePrismaModels(fragment: string = CORE_PRISMA): string[] {
  return [...fragment.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!);
}

export interface BackRelation {
  /** Core model that receives the field. */
  coreModel: string;
  /** App model on the other side. */
  appModel: string;
  relationName: string;
  fieldName: string;
  /** `[]` (one-to-many) or `?` (one-to-one: the app's FK field is unique). */
  arity: '[]' | '?';
}

export class PrismaFragmentError extends Error {
  override name = 'PrismaFragmentError';
}

/**
 * Finds every relation from an app model to a core model in the given .prisma sources. Prisma requires the
 * opposite field on the core model, which apps cannot edit (the fragment is generated), so the fragment
 * generator injects it. Each such relation must be named (`@relation("AuditLogTenant", …)`) — the name becomes
 * the back-relation field (`auditLogTenant AuditLog[]`), which keeps the generated fields stable and unique.
 */
export function findBackRelations(appSources: string[], fragment: string = CORE_PRISMA): BackRelation[] {
  const core = new Set(corePrismaModels(fragment));
  const out: BackRelation[] = [];
  for (const source of appSources) {
    for (const block of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const appModel = block[1]!;
      const body = block[2]!;
      if (core.has(appModel)) continue;
      const lines = body.split('\n');
      for (const line of lines) {
        const m = /^\s*(\w+)\s+(\w+)(\??)\s+@relation\((.*)\)\s*(?:\/\/.*)?$/.exec(line);
        if (!m) continue;
        const [, field, type, , args] = m;
        if (!type || !core.has(type)) continue;
        if (!/fields:\s*\[/.test(args ?? '')) continue; // the back side of a relation, not the FK side
        const name = /^\s*"([^"]+)"/.exec(args ?? '')?.[1] ?? /name:\s*"([^"]+)"/.exec(args ?? '')?.[1];
        if (!name) {
          throw new PrismaFragmentError(
            `${appModel}.${field} → ${type}: relations from app models to core models must be named, e.g. @relation("${appModel}${capitalise(field!)}", fields: …)`,
          );
        }
        const fkFields =
          /fields:\s*\[([^\]]*)\]/
            .exec(args ?? '')?.[1]
            ?.split(',')
            .map((s) => s.trim()) ?? [];
        out.push({
          coreModel: type,
          appModel,
          relationName: name,
          fieldName: name.charAt(0).toLowerCase() + name.slice(1),
          arity: isUniqueFk(body, fkFields) ? '?' : '[]',
        });
      }
    }
  }
  const seen = new Set<string>();
  for (const r of out) {
    const key = `${r.coreModel}.${r.fieldName}`;
    if (seen.has(key))
      throw new PrismaFragmentError(`duplicate back-relation ${key} (relation names must be unique)`);
    seen.add(key);
  }
  return out;
}

function isUniqueFk(body: string, fkFields: string[]): boolean {
  if (fkFields.length !== 1) {
    const joined = fkFields.join(',\\s*');
    return new RegExp(`@@(id|unique)\\(\\[\\s*${joined}\\s*\\]`).test(body);
  }
  const f = fkFields[0]!;
  const fieldLine = new RegExp(`^\\s*${f}\\s+[^\\n]*@(id|unique)\\b`, 'm');
  return fieldLine.test(body) || new RegExp(`@@(id|unique)\\(\\[\\s*${f}\\s*\\]`).test(body);
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The fragment as an app should commit it (`asset-core prisma-fragment --relations-from prisma/schema >
 * prisma/schema/core.prisma`): a GENERATED header, then the shipped models with the back-relation fields of the
 * app's relations inserted before each core model's block attributes.
 */
export function buildPrismaFragment(appSources: string[] = [], fragment: string = CORE_PRISMA): string {
  const relations = findBackRelations(appSources, fragment);
  const byModel = new Map<string, BackRelation[]>();
  for (const r of relations) {
    if (!byModel.has(r.coreModel)) byModel.set(r.coreModel, []);
    byModel.get(r.coreModel)!.push(r);
  }
  const body = fragment.replace(
    /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm,
    (whole, model: string, inner: string) => {
      const extra = byModel.get(model);
      if (!extra?.length) return whole;
      const width = Math.max(...extra.map((r) => r.fieldName.length));
      const lines = extra
        .sort((a, b) => a.fieldName.localeCompare(b.fieldName))
        .map((r) => `  ${r.fieldName.padEnd(width)} ${r.appModel}${r.arity} @relation("${r.relationName}")`);
      const insertAt = inner.search(/^\s*@@/m);
      const block = `\n  // back-relations of app models (injected by asset-core prisma-fragment)\n${lines.join('\n')}\n`;
      const newInner =
        insertAt === -1
          ? `${inner}${block}`
          : `${inner.slice(0, insertAt)}${block}\n${inner.slice(insertAt).replace(/^\n/, '')}`;
      return `model ${model} {${newInner}}`;
    },
  );
  const header = [
    `// GENERATED by \`asset-core prisma-fragment\` from ${PACKAGE_NAME}@${PACKAGE_VERSION} — do not edit.`,
    '// Regenerate after changing a relation to a core model or bumping the package (pnpm prisma:core).',
    `// Back-relations injected: ${relations.length}.`,
    '',
  ].join('\n');
  return header + body;
}
