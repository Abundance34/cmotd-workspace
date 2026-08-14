
-- ProcureFlow configurable Procurement Manager approval limit.
--
-- Default policy:
--   At or below configured amount -> Procurement Manager
--   Above configured amount       -> Approver / MD
--
-- A Procurement Manager-created request remains subject to
-- independent Approver / MD approval regardless of amount.
--
-- IMPORTANT:
-- NUMERIC is deliberately declared WITHOUT precision/scale.
-- ProcureFlow imposes no application-defined maximum approval limit.

CREATE TABLE IF NOT EXISTS approval_policy_settings (
    policy_key TEXT PRIMARY KEY,
    amount NUMERIC NOT NULL
        CHECK (amount > 0),
    updated_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,
    update_reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_policy_history (
    id BIGSERIAL PRIMARY KEY,
    policy_key TEXT NOT NULL,
    old_amount NUMERIC NOT NULL
        CHECK (old_amount > 0),
    new_amount NUMERIC NOT NULL
        CHECK (new_amount > 0),
    changed_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,
    change_reason TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS
idx_approval_policy_history_key_changed
ON approval_policy_history(
    policy_key,
    changed_at DESC
);

INSERT INTO approval_policy_settings (
    policy_key,
    amount,
    updated_by,
    update_reason
)
VALUES (
    'procurement_manager_approval_limit',
    2000000.00,
    NULL,
    'Initial ProcureFlow approval policy default'
)
ON CONFLICT (policy_key) DO NOTHING;
