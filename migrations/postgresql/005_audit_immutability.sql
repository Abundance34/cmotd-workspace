-- Prevent UPDATE/DELETE operations against the append-only PostgreSQL audit ledger.
BEGIN;
SET TIME ZONE 'UTC';

CREATE OR REPLACE FUNCTION public.procureflow_prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_events_no_update ON audit_events;
CREATE TRIGGER trg_audit_events_no_update
BEFORE UPDATE ON audit_events
FOR EACH ROW EXECUTE FUNCTION public.procureflow_prevent_audit_event_mutation();

DROP TRIGGER IF EXISTS trg_audit_events_no_delete ON audit_events;
CREATE TRIGGER trg_audit_events_no_delete
BEFORE DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION public.procureflow_prevent_audit_event_mutation();

COMMIT;
