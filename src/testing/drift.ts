/**
 * Structural drift check between a migrated PostgreSQL database and a Prisma schema (DMMF): tables,
 * columns (type, nullability, default), enums, primary keys, unique and secondary indexes (columns, access
 * method, operator class, partial predicate) and foreign keys (columns, target, referential actions).
 *
 * Why it exists: `prisma migrate diff` needs Prisma's native schema engine. CI runs the real diff; this check
 * runs everywhere (including sandboxes without the engine binary) and is stricter on a few points Prisma
 * ignores. SQL-only objects are allowed by design and skipped: CHECK and EXCLUDE constraints (and the indexes
 * backing EXCLUDE), triggers, RLS policies, functions, views. Anything else that exists on only one side is
 * reported.
 */

/** The subset of a `pg` client this module needs. */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** Minimal DMMF shapes (`@prisma/prisma-schema-wasm` get_dmmf → datamodel). */
export interface DmmfField {
  name: string;
  dbName?: string | null;
  kind: 'scalar' | 'object' | 'enum' | 'unsupported';
  isList: boolean;
  isRequired: boolean;
  isId: boolean;
  isUnique: boolean;
  type: string;
  nativeType?: [string, string[]] | null;
  hasDefaultValue: boolean;
  default?: unknown;
  relationName?: string;
  relationFromFields?: string[];
  relationToFields?: string[];
  relationOnDelete?: string;
  relationOnUpdate?: string;
}
export interface DmmfModel {
  name: string;
  dbName?: string | null;
  schema?: string | null;
  fields: DmmfField[];
  primaryKey?: { name?: string | null; fields: string[] } | null;
}
export interface DmmfEnum {
  name: string;
  dbName?: string | null;
  schema?: string | null;
  values: { name: string; dbName?: string | null }[];
}
export interface DmmfIndex {
  model: string;
  type: 'id' | 'normal' | 'unique' | 'fulltext';
  isDefinedOnField: boolean;
  dbName?: string | null;
  algorithm?: string;
  fields: { name: string; operatorClass?: string; sortOrder?: string }[];
}
export interface DmmfDatamodel {
  models: DmmfModel[];
  enums: DmmfEnum[];
  indexes?: DmmfIndex[];
}

export interface DriftOptions {
  /** Database schemas to compare (models/enums of other schemas are ignored). */
  schemas: string[];
  /** Raw text of the .prisma files: used to read `where: raw("…")` predicates of partial indexes. */
  schemaText?: string;
  /** Tables that exist only in SQL (e.g. `core._migration`), as `schema.table`. */
  ignoreTables?: string[];
  /** Indexes that are allowed to exist only in SQL, as `schema.index_name`. */
  sqlOnlyIndexes?: string[];
}

interface DbColumn {
  schema: string;
  table: string;
  column: string;
  not_null: boolean;
  type: string;
  type_schema: string;
  type_name: string;
  is_enum: boolean;
  is_array: boolean;
  default_expr: string | null;
}
interface DbIndex {
  schema: string;
  table: string;
  name: string;
  is_unique: boolean;
  is_primary: boolean;
  method: string;
  columns: (string | null)[];
  opclasses: string[];
  descending: boolean[];
  predicate: string | null;
  backs_exclusion: boolean;
}
interface DbForeignKey {
  schema: string;
  table: string;
  name: string;
  columns: string[];
  ref_schema: string;
  ref_table: string;
  ref_columns: string[];
  on_delete: string;
  on_update: string;
}

const ACTIONS: Record<string, string> = {
  a: 'NoAction',
  r: 'Restrict',
  c: 'Cascade',
  n: 'SetNull',
  d: 'SetDefault',
};

/** Returns human-readable differences; an empty array means no drift. */
export async function checkPrismaDrift(
  db: Queryable,
  datamodel: DmmfDatamodel,
  options: DriftOptions,
): Promise<string[]> {
  const problems: string[] = [];
  const schemas = options.schemas;
  const ignoreTables = new Set(options.ignoreTables ?? []);
  const sqlOnlyIndexes = new Set(options.sqlOnlyIndexes ?? []);
  const predicates = parsePredicates(options.schemaText ?? '');

  // DMMF enums carry no schema: read `@@schema("…")` of each enum block from the source text.
  const enumSchemas = parseEnumSchemas(options.schemaText ?? '');
  // DMMF omits Unsupported("…") fields: read them from the source text.
  const unsupported = parseUnsupportedFields(options.schemaText ?? '');
  const allEnums = datamodel.enums.map((e) => ({
    ...e,
    schema: e.schema ?? enumSchemas.get(e.name) ?? 'public',
  }));
  const models = datamodel.models.filter((m) => schemas.includes(m.schema ?? 'public'));
  const enums = allEnums.filter((e) => schemas.includes(e.schema));
  const modelByName = new Map(datamodel.models.map((m) => [m.name, m]));
  const tableOf = (m: DmmfModel) => `${m.schema ?? 'public'}.${m.dbName ?? m.name}`;
  const columnOf = (m: DmmfModel, fieldName: string) => {
    const f = m.fields.find((x) => x.name === fieldName);
    return f ? (f.dbName ?? f.name) : fieldName;
  };

  // ---- tables
  const { rows: tableRows } = await db.query<{ schema: string; table: string }>(
    `SELECT n.nspname AS schema, c.relname AS table
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY($1) AND NOT c.relispartition`,
    [schemas],
  );
  const dbTables = new Set(
    tableRows.map((r) => `${r.schema}.${r.table}`).filter((t) => !ignoreTables.has(t)),
  );
  const prismaTables = new Set(models.map(tableOf));
  for (const t of dbTables)
    if (!prismaTables.has(t)) problems.push(`table ${t}: exists in the database but has no Prisma model`);
  for (const t of prismaTables)
    if (!dbTables.has(t)) problems.push(`table ${t}: Prisma model has no table in the database`);

  // ---- enums
  const { rows: enumRows } = await db.query<{ schema: string; name: string; labels: string[] }>(
    `SELECT n.nspname AS schema, t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname = ANY($1) GROUP BY 1, 2`,
    [schemas],
  );
  const dbEnums = new Map(enumRows.map((r) => [`${r.schema}.${r.name}`, r.labels]));
  for (const e of enums) {
    const key = `${e.schema ?? 'public'}.${e.dbName ?? e.name}`;
    const labels = dbEnums.get(key);
    const expected = e.values.map((v) => v.dbName ?? v.name);
    if (!labels) problems.push(`enum ${key}: missing in the database`);
    else if (labels.join(',') !== expected.join(',')) {
      problems.push(`enum ${key}: database [${labels.join(', ')}] ≠ Prisma [${expected.join(', ')}]`);
    }
    dbEnums.delete(key);
  }
  for (const key of dbEnums.keys()) problems.push(`enum ${key}: exists in the database but not in Prisma`);

  // ---- columns
  const { rows: columnRows } = await db.query<DbColumn>(
    `SELECT n.nspname AS schema, c.relname AS table, a.attname AS column, a.attnotnull AS not_null,
            format_type(a.atttypid, a.atttypmod) AS type,
            tn.nspname AS type_schema,
            CASE WHEN t.typcategory = 'A' THEN et.typname ELSE t.typname END AS type_name,
            (CASE WHEN t.typcategory = 'A' THEN et.typtype ELSE t.typtype END) = 'e' AS is_enum,
            t.typcategory = 'A' AS is_array,
            pg_get_expr(d.adbin, d.adrelid) AS default_expr
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
       LEFT JOIN pg_type et ON et.oid = t.typelem AND t.typcategory = 'A'
       JOIN pg_namespace tn ON tn.oid = CASE WHEN t.typcategory = 'A' THEN et.typnamespace ELSE t.typnamespace END
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY($1) AND a.attnum > 0 AND NOT a.attisdropped`,
    [schemas],
  );
  const columnsByTable = new Map<string, Map<string, DbColumn>>();
  for (const r of columnRows) {
    const key = `${r.schema}.${r.table}`;
    if (!columnsByTable.has(key)) columnsByTable.set(key, new Map());
    columnsByTable.get(key)!.set(r.column, r);
  }
  const enumByName = new Map(allEnums.map((e) => [e.name, e]));

  for (const m of models) {
    const table = tableOf(m);
    const dbCols = columnsByTable.get(table);
    if (!dbCols) continue;
    const seen = new Set<string>();
    for (const f of m.fields) {
      if (f.kind === 'object') continue;
      const col = f.dbName ?? f.name;
      seen.add(col);
      const c = dbCols.get(col);
      if (!c) {
        problems.push(`column ${table}.${col}: in Prisma, missing in the database`);
        continue;
      }
      if (f.kind === 'unsupported') continue;
      const expectedType = expectedDbType(f, enumByName);
      const actualType = c.is_enum ? `${c.type_schema}.${c.type_name}${c.is_array ? '[]' : ''}` : c.type;
      if (expectedType !== actualType) {
        problems.push(
          `column ${table}.${col}: type ${actualType} in the database ≠ ${expectedType} from Prisma`,
        );
      }
      if (!f.isList && f.isRequired !== c.not_null) {
        problems.push(
          `column ${table}.${col}: ${c.not_null ? 'NOT NULL' : 'nullable'} in the database but ${f.isRequired ? 'required' : 'optional'} in Prisma`,
        );
      }
      const expectedDefault = expectedDefaultValue(f);
      const actualDefault = normaliseDbDefault(c.default_expr);
      if (expectedDefault !== actualDefault) {
        problems.push(
          `column ${table}.${col}: default ${actualDefault ?? '(none)'} in the database ≠ ${expectedDefault ?? '(none)'} from Prisma`,
        );
      }
    }
    for (const u of unsupported.get(m.name) ?? []) {
      seen.add(u.column);
      const c = dbCols.get(u.column);
      if (!c)
        problems.push(
          `column ${table}.${u.column}: Unsupported("${u.type}") in Prisma, missing in the database`,
        );
      else {
        if (c.type !== u.type)
          problems.push(
            `column ${table}.${u.column}: type ${c.type} in the database ≠ Unsupported("${u.type}")`,
          );
        if (c.not_null === u.optional) {
          problems.push(
            `column ${table}.${u.column}: ${c.not_null ? 'NOT NULL' : 'nullable'} in the database but ${u.optional ? 'optional' : 'required'} in Prisma`,
          );
        }
      }
    }
    for (const col of dbCols.keys()) {
      if (!seen.has(col)) problems.push(`column ${table}.${col}: exists in the database but not in Prisma`);
    }
  }

  // ---- indexes (primary keys, uniques, secondary)
  const { rows: indexRows } = await db.query<DbIndex>(
    `SELECT n.nspname AS schema, t.relname AS table, ic.relname AS name, i.indisunique AS is_unique,
            i.indisprimary AS is_primary, am.amname AS method,
            ARRAY(SELECT a.attname::text FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
                    LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum AND k.attnum > 0
                   ORDER BY k.ord) AS columns,
            ARRAY(SELECT oc.opcname::text FROM unnest(i.indclass::oid[]) WITH ORDINALITY k(oid, ord)
                    JOIN pg_opclass oc ON oc.oid = k.oid ORDER BY k.ord) AS opclasses,
            ARRAY(SELECT (o & 1) = 1 FROM unnest(i.indoption::int2[]) WITH ORDINALITY k(o, ord) ORDER BY k.ord) AS descending,
            pg_get_expr(i.indpred, i.indrelid) AS predicate,
            EXISTS (SELECT 1 FROM pg_constraint x WHERE x.conindid = i.indexrelid AND x.contype = 'x') AS backs_exclusion
       FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_am am ON am.oid = ic.relam
      WHERE n.nspname = ANY($1)`,
    [schemas],
  );
  const dbIndexes = new Map<string, DbIndex>();
  const dbPrimaryKeys = new Map<string, DbIndex>();
  for (const r of indexRows) {
    const table = `${r.schema}.${r.table}`;
    if (ignoreTables.has(table)) continue;
    if (r.is_primary) dbPrimaryKeys.set(table, r);
    else if (!r.backs_exclusion) dbIndexes.set(`${r.schema}.${r.name}`, r);
  }

  for (const m of models) {
    const table = tableOf(m);
    const pkFields = m.primaryKey?.fields ?? m.fields.filter((f) => f.isId).map((f) => f.name);
    const expectedPk = pkFields.map((f) => columnOf(m, f));
    const pk = dbPrimaryKeys.get(table);
    if (!pk) {
      if (dbTables.has(table)) problems.push(`table ${table}: no primary key in the database`);
    } else if (pk.columns.join(',') !== expectedPk.join(',')) {
      problems.push(
        `table ${table}: primary key (${pk.columns.join(', ')}) ≠ Prisma (${expectedPk.join(', ')})`,
      );
    }
  }

  const prismaIndexes = (datamodel.indexes ?? []).filter(
    (ix) => ix.type === 'unique' || ix.type === 'normal',
  );
  for (const ix of prismaIndexes) {
    const m = modelByName.get(ix.model);
    if (!m || !schemas.includes(m.schema ?? 'public')) continue;
    const table = m.dbName ?? m.name;
    const cols = ix.fields.map((f) => columnOf(m, f.name));
    const name = ix.dbName ?? `${table}_${cols.join('_')}_${ix.type === 'unique' ? 'key' : 'idx'}`;
    const key = `${m.schema ?? 'public'}.${name}`;
    const d = dbIndexes.get(key);
    if (!d) {
      problems.push(`index ${key}: in Prisma, missing in the database`);
      continue;
    }
    dbIndexes.delete(key);
    if (d.table !== table)
      problems.push(`index ${key}: on table ${d.table} in the database, ${table} in Prisma`);
    if (d.is_unique !== (ix.type === 'unique')) {
      problems.push(
        `index ${key}: ${d.is_unique ? 'unique' : 'non-unique'} in the database, ${ix.type} in Prisma`,
      );
    }
    if (d.columns.join(',') !== cols.join(',')) {
      problems.push(
        `index ${key}: columns (${d.columns.map((c) => c ?? '<expr>').join(', ')}) ≠ Prisma (${cols.join(', ')})`,
      );
    }
    const method = (ix.algorithm ?? 'BTree').toLowerCase();
    if (d.method !== method) problems.push(`index ${key}: method ${d.method} ≠ Prisma ${method}`);
    ix.fields.forEach((f, i) => {
      if (f.operatorClass && d.opclasses[i] !== f.operatorClass) {
        problems.push(`index ${key}: operator class ${d.opclasses[i]} ≠ Prisma ${f.operatorClass}`);
      }
      const desc = f.sortOrder === 'desc';
      if (method === 'btree' && Boolean(d.descending[i]) !== desc) {
        problems.push(
          `index ${key}: column ${cols[i]} is ${d.descending[i] ? 'DESC' : 'ASC'} in the database, ${desc ? 'Desc' : 'Asc'} in Prisma`,
        );
      }
    });
    const expectedPredicate = predicates.get(name) ?? null;
    if ((d.predicate ?? null) !== expectedPredicate) {
      problems.push(
        `index ${key}: predicate ${d.predicate ?? '(none)'} in the database ≠ ${expectedPredicate ?? '(none)'} in Prisma`,
      );
    }
  }
  for (const [key, d] of dbIndexes) {
    if (sqlOnlyIndexes.has(key)) continue;
    problems.push(`index ${key} on ${d.schema}.${d.table}: exists in the database but not in Prisma`);
  }

  // ---- foreign keys
  const { rows: fkRows } = await db.query<DbForeignKey>(
    `SELECT n.nspname AS schema, t.relname AS table, c.conname AS name,
            ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS columns,
            rn.nspname AS ref_schema, rt.relname AS ref_table,
            ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.ord) AS ref_columns,
            c.confdeltype AS on_delete, c.confupdtype AS on_update
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_class rt ON rt.oid = c.confrelid JOIN pg_namespace rn ON rn.oid = rt.relnamespace
      WHERE c.contype = 'f' AND n.nspname = ANY($1)`,
    [schemas],
  );
  const dbFks = new Map(fkRows.map((r) => [`${r.schema}.${r.table}(${r.columns.join(',')})`, r]));
  for (const m of models) {
    for (const f of m.fields) {
      if (f.kind !== 'object' || !f.relationFromFields?.length) continue;
      const target = modelByName.get(f.type);
      if (!target) continue;
      const cols = f.relationFromFields.map((x) => columnOf(m, x));
      const key = `${tableOf(m)}(${cols.join(',')})`;
      const fk = dbFks.get(key);
      if (!fk) {
        problems.push(`foreign key ${key} → ${tableOf(target)}: in Prisma, missing in the database`);
        continue;
      }
      dbFks.delete(key);
      const refCols = (f.relationToFields ?? []).map((x) => columnOf(target, x));
      if (
        `${fk.ref_schema}.${fk.ref_table}` !== tableOf(target) ||
        fk.ref_columns.join(',') !== refCols.join(',')
      ) {
        problems.push(
          `foreign key ${key}: references ${fk.ref_schema}.${fk.ref_table}(${fk.ref_columns.join(',')}) ≠ Prisma ${tableOf(target)}(${refCols.join(',')})`,
        );
      }
      const onDelete = f.relationOnDelete ?? (f.isRequired ? 'Restrict' : 'SetNull');
      const onUpdate = f.relationOnUpdate ?? 'Cascade';
      if (ACTIONS[fk.on_delete] !== onDelete) {
        problems.push(`foreign key ${key}: ON DELETE ${ACTIONS[fk.on_delete]} ≠ Prisma ${onDelete}`);
      }
      if (ACTIONS[fk.on_update] !== onUpdate) {
        problems.push(`foreign key ${key}: ON UPDATE ${ACTIONS[fk.on_update]} ≠ Prisma ${onUpdate}`);
      }
    }
  }
  for (const [key, fk] of dbFks) {
    if (ignoreTables.has(`${fk.schema}.${fk.table}`)) continue;
    problems.push(
      `foreign key ${key} → ${fk.ref_schema}.${fk.ref_table}: exists in the database but not in Prisma`,
    );
  }

  return problems.sort();
}

function expectedDbType(f: DmmfField, enums: Map<string, DmmfEnum>): string {
  const list = f.isList ? '[]' : '';
  if (f.kind === 'enum') {
    const e = enums.get(f.type);
    return `${e?.schema ?? 'public'}.${e?.dbName ?? f.type}${list}`;
  }
  const [native, args] = f.nativeType ?? [undefined, []];
  const a = args ?? [];
  let t: string;
  switch (f.type) {
    case 'String':
      t =
        native === 'Uuid'
          ? 'uuid'
          : native === 'Citext'
            ? 'citext'
            : native === 'Char'
              ? `character(${a[0]})`
              : native === 'VarChar'
                ? a.length
                  ? `character varying(${a[0]})`
                  : 'character varying'
                : native === 'Inet'
                  ? 'inet'
                  : 'text';
      break;
    case 'Int':
      t = native === 'SmallInt' ? 'smallint' : 'integer';
      break;
    case 'BigInt':
      t = 'bigint';
      break;
    case 'Boolean':
      t = 'boolean';
      break;
    case 'Float':
      t = native === 'Real' ? 'real' : 'double precision';
      break;
    case 'Decimal':
      t = a.length ? `numeric(${a[0]},${a[1] ?? 0})` : 'numeric(65,30)';
      break;
    case 'DateTime':
      t =
        native === 'Timestamptz'
          ? `timestamp(${a[0] ?? 6}) with time zone`
          : native === 'Date'
            ? 'date'
            : native === 'Time'
              ? `time(${a[0] ?? 6}) without time zone`
              : native === 'Timetz'
                ? `time(${a[0] ?? 6}) with time zone`
                : `timestamp(${a[0] ?? 3}) without time zone`;
      break;
    case 'Json':
      t = native === 'Json' ? 'json' : 'jsonb';
      break;
    case 'Bytes':
      t = 'bytea';
      break;
    default:
      t = f.type;
  }
  return t + list;
}

function expectedDefaultValue(f: DmmfField): string | null {
  if (!f.hasDefaultValue || f.default === undefined) return null;
  const d = f.default as unknown;
  if (d && typeof d === 'object' && !Array.isArray(d) && 'name' in d) {
    const fn = d as { name: string; args: unknown[] };
    if (fn.name === 'now') return 'now()';
    if (fn.name === 'dbgenerated') return typeof fn.args[0] === 'string' ? fn.args[0] : '';
    if (fn.name === 'autoincrement') return 'nextval';
    return `${fn.name}()`;
  }
  if (Array.isArray(d)) return `{${d.map(String).join(',')}}`;
  if (typeof d === 'number') return normaliseNumber(String(d));
  return String(d);
}

/** Strips casts and quotes from pg_get_expr defaults: `'th'::bpchar` → th, `'{}'::jsonb` → {}. */
export function normaliseDbDefault(expr: string | null): string | null {
  if (expr === null) return null;
  let e = expr.trim();
  if (/^nextval\(/.test(e)) return 'nextval';
  if (/^ARRAY\[\]::/.test(e)) return '{}';
  // remove trailing casts (possibly several, possibly schema-qualified, possibly arrays)
  for (;;) {
    const m = /^(.*)::(?:"?[\w ]+"?\.)?"?[\w ]+"?(?:\(\d+(?:,\d+)?\))?(?:\[\])?$/s.exec(e);
    if (!m || m[1] === undefined) break;
    e = m[1];
  }
  if (e.startsWith('(') && e.endsWith(')') && !/\w\(/.test(e)) e = e.slice(1, -1);
  if (e.startsWith("'") && e.endsWith("'")) return e.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(e)) return normaliseNumber(e);
  return e;
}

function normaliseNumber(n: string): string {
  if (!n.includes('.')) return n;
  return n.replace(/0+$/, '').replace(/\.$/, '');
}

/** Model name → Unsupported("…") fields (column name, database type, optional) from .prisma source text. */
export function parseUnsupportedFields(
  schemaText: string,
): Map<string, { column: string; type: string; optional: boolean }[]> {
  const out = new Map<string, { column: string; type: string; optional: boolean }[]>();
  for (const m of schemaText.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    for (const f of (m[2] ?? '').matchAll(/^\s*(\w+)\s+Unsupported\("([^"]+)"\)(\?)?([^\n]*)$/gm)) {
      const column = /@map\("([^"]+)"\)/.exec(f[4] ?? '')?.[1] ?? f[1]!;
      if (!out.has(m[1]!)) out.set(m[1]!, []);
      out.get(m[1]!)!.push({ column, type: f[2]!, optional: f[3] === '?' });
    }
  }
  return out;
}

/** Map of enum name → `@@schema("…")` from .prisma source text. */
export function parseEnumSchemas(schemaText: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of schemaText.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
    const schema = /@@schema\("([^"]+)"\)/.exec(m[2] ?? '');
    if (m[1] && schema?.[1]) out.set(m[1], schema[1]);
  }
  return out;
}

/** Map of index name → `where: raw("…")` predicate from .prisma source text. */
export function parsePredicates(schemaText: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /map:\s*"([^"]+)"[^\n]*?where:\s*raw\("((?:[^"\\]|\\.)*)"\)/g;
  for (const m of schemaText.matchAll(re)) {
    if (m[1] && m[2] !== undefined) out.set(m[1], m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  }
  return out;
}
