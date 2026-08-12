-- ProcureFlow Release A: Admin control foundation.
-- Additive migration only. Existing procurement data is not modified.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_interventions (
    id BIGSERIAL PRIMARY KEY,
    intervention_no TEXT UNIQUE NOT NULL,
    intervention_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id BIGINT,
    target_user_id BIGINT,
    severity TEXT NOT NULL DEFAULT 'High',
    reason TEXT NOT NULL,
    before_state_json TEXT,
    after_state_json TEXT,
    actor_user_id BIGINT NOT NULL,
    actor_role TEXT NOT NULL DEFAULT 'Admin',
    correlation_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_interventions_entity
    ON admin_interventions(
        entity_type,
        entity_id,
        created_at DESC
    );

CREATE INDEX IF NOT EXISTS idx_admin_interventions_actor
    ON admin_interventions(
        actor_user_id,
        created_at DESC
    );

CREATE INDEX IF NOT EXISTS idx_admin_interventions_type
    ON admin_interventions(
        intervention_type,
        created_at DESC
    );


CREATE TABLE IF NOT EXISTS system_exceptions (
    id BIGSERIAL PRIMARY KEY,
    issue_key TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'Warning',
    entity_type TEXT,
    entity_id BIGINT,
    reference TEXT,
    summary TEXT NOT NULL,
    details_json TEXT,
    status TEXT NOT NULL DEFAULT 'Open',
    first_detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    investigated_by BIGINT,
    investigated_at TIMESTAMPTZ,
    investigation_note TEXT,
    resolved_by BIGINT,
    resolved_at TIMESTAMPTZ,
    resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_system_exceptions_status
    ON system_exceptions(
        status,
        severity,
        last_detected_at DESC
    );

CREATE INDEX IF NOT EXISTS idx_system_exceptions_entity
    ON system_exceptions(
        entity_type,
        entity_id
    );


-- Admin interventions are evidence records.
-- They are append-only at database level.
CREATE OR REPLACE FUNCTION
procureflow_block_admin_intervention_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'admin_interventions is append-only';
END;
$$;

DROP TRIGGER IF EXISTS
    trg_admin_interventions_no_update
ON admin_interventions;

CREATE TRIGGER
    trg_admin_interventions_no_update
BEFORE UPDATE OR DELETE
ON admin_interventions
FOR EACH ROW
EXECUTE FUNCTION
    procureflow_block_admin_intervention_mutation();

COMMIT;
