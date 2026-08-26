-- uuidv7() polyfill for PostgreSQL < 18 (local dev on PG17).
-- PostgreSQL 18 ships uuidv7() natively (see docker-compose.dev.yml, postgres:18);
-- this shim lets the same schema run on an older local instance. Apply once to
-- the telvyn database BEFORE `prisma migrate` (the column DEFAULTs reference it).
-- Idempotent. Correct v7 layout: 48-bit ms timestamp + version 7 + variant bits.
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  ts_millis bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  b bytea := uuid_send(gen_random_uuid());
BEGIN
  b := overlay(b placing substring(int8send(ts_millis) FROM 3 FOR 6) FROM 1 FOR 6);
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);   -- version = 7
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);   -- variant = 10xx
  RETURN encode(b, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;
