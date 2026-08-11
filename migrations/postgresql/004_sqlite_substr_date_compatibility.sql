-- Compatibility overloads for legacy SQLite queries that call substr() on
-- DATE/TIMESTAMP values. PostgreSQL intentionally does not cast those types to
-- text for substr(), while SQLite does. These exact-type overloads preserve the
-- existing reporting semantics without changing stored data.
BEGIN;
SET TIME ZONE 'UTC';

CREATE OR REPLACE FUNCTION public.substr(value DATE, start_pos INTEGER, char_count INTEGER)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$ SELECT pg_catalog.substr(value::TEXT, start_pos, char_count) $$;

CREATE OR REPLACE FUNCTION public.substr(value TIMESTAMP WITHOUT TIME ZONE, start_pos INTEGER, char_count INTEGER)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$ SELECT pg_catalog.substr(value::TEXT, start_pos, char_count) $$;

CREATE OR REPLACE FUNCTION public.substr(value TIMESTAMP WITH TIME ZONE, start_pos INTEGER, char_count INTEGER)
RETURNS TEXT
LANGUAGE SQL
STABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$ SELECT pg_catalog.substr(value::TEXT, start_pos, char_count) $$;

CREATE OR REPLACE FUNCTION public.substr(value DATE, start_pos INTEGER)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$ SELECT pg_catalog.substr(value::TEXT, start_pos) $$;

CREATE OR REPLACE FUNCTION public.substr(value TIMESTAMP WITHOUT TIME ZONE, start_pos INTEGER)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$ SELECT pg_catalog.substr(value::TEXT, start_pos) $$;

CREATE OR REPLACE FUNCTION public.substr(value TIMESTAMP WITH TIME ZONE, start_pos INTEGER)
RETURNS TEXT
LANGUAGE SQL
STABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$ SELECT pg_catalog.substr(value::TEXT, start_pos) $$;

COMMIT;
