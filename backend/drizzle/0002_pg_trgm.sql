-- Trigram search for product names and part numbers (fast ILIKE '%term%').
-- pg_trgm is a trusted extension (PG13+), so the database owner can create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
