-- collective-asset-core 0.3.0 / 0010 — lease & occupancy support for getproperty B2 (additive only, D-153).
-- * document kind `signature`: the drawn signature image of an e-signed contract or inspection report (D-062);
--   kept apart from `contract` so retention and download auditing can treat it as signer evidence.
-- * occupancy lookups by lease: activation creates the occupancy rows of a lease and the lease end closes them
--   (the lease lives in the app schema, so core keeps only the logical reference `lease_id`).
ALTER TYPE core.document_kind ADD VALUE IF NOT EXISTS 'signature';

CREATE INDEX IF NOT EXISTS occupancy_lease_id_idx ON core.occupancy (lease_id) WHERE (lease_id IS NOT NULL);
COMMENT ON INDEX core.occupancy_lease_id_idx IS 'Occupancies created by a lease (opened at activation, closed at the lease end).';
