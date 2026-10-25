-- collective-asset-core 0.6.0 / 0012 — landlord document set for getproperty B7.5 (D-253; additive within the 0.x
-- major, D-153).
-- * document kinds `pdf_notice` (rent increase, renewal offer, non-renewal, termination, late payment notices),
--   `pdf_certificate` (rent payment certificate) and `pdf_summary` (annual rental income summary).
ALTER TYPE core.document_kind ADD VALUE IF NOT EXISTS 'pdf_notice';
ALTER TYPE core.document_kind ADD VALUE IF NOT EXISTS 'pdf_certificate';
ALTER TYPE core.document_kind ADD VALUE IF NOT EXISTS 'pdf_summary';
