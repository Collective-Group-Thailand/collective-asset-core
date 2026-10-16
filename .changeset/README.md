# Changesets

Every pull request that changes what consumers get (migrations, Prisma fragment, contracts, exports) adds a
changeset: `pnpm changeset`. Semver rules for this package (D-153, ADR-0010):

- **patch** — fixes that do not change the schema or a contract (docs, helpers, tests).
- **minor** — additive changes: new tables, nullable columns, new enum values, new event types or optional
  fields, new helper functions. Always a *new* migration file; released migrations are never edited.
- **major** — renames, drops, type changes, required contract fields. Needs a coordinated upgrade of
  getproperty-api and getbuild-api. (While on 0.x and before getbuild installs the package, ADR-0010 allows
  breaking minors.)
