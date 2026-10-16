-- collective-asset-core 0.2.0 / 0008 — party matching for resident sign-in (getproperty B1.3, additive only).
-- A resident who proves possession of a phone number by SMS OTP is linked to the parties that carry that phone
-- (operators entered it on the party); a LINE sign-in links parties carrying that LINE user id. Both lookups run
-- across tenants as gp_platform (identity service), so they need indexes that do not start with tenant_id.
ALTER TYPE core.party_link_via ADD VALUE IF NOT EXISTS 'phone_match';

CREATE INDEX IF NOT EXISTS party_phone_e164_idx ON core.party (phone_e164) WHERE (deleted_at IS NULL AND anonymised_at IS NULL);
CREATE INDEX IF NOT EXISTS party_line_user_id_idx ON core.party (line_user_id) WHERE (deleted_at IS NULL AND anonymised_at IS NULL);
COMMENT ON INDEX core.party_phone_e164_idx IS 'Cross-tenant party match after a verified SMS OTP (party_user_link.linked_via = phone_match).';
COMMENT ON INDEX core.party_line_user_id_idx IS 'Cross-tenant party match at LINE sign-in (party_user_link.linked_via = line_match).';
