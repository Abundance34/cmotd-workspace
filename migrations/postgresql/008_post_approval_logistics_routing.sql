-- ProcureFlow post-approval routing and Logistics gate.
--
-- New approvals must be explicitly classified by Procurement:
--   requires_logistics = FALSE -> Finance is the next role immediately.
--   requires_logistics = TRUE  -> PO / Logistics / receiving must complete first.
--   requires_logistics = NULL  -> Procurement routing decision is still outstanding.
--
-- Existing Finance-ready records are backfilled as no-Logistics so the migration
-- does not withdraw already-approved historical work from Finance.

ALTER TABLE purchase_requests
    ADD COLUMN IF NOT EXISTS requires_logistics BOOLEAN;

ALTER TABLE purchase_requests
    ADD COLUMN IF NOT EXISTS logistics_routing_decided_at TIMESTAMPTZ;

ALTER TABLE purchase_requests
    ADD COLUMN IF NOT EXISTS logistics_routing_decided_by BIGINT;

ALTER TABLE purchase_requests
    ADD COLUMN IF NOT EXISTS logistics_completed_at TIMESTAMPTZ;

ALTER TABLE purchase_requests
    ADD COLUMN IF NOT EXISTS logistics_completed_by BIGINT;

DO $$
BEGIN
    ALTER TABLE purchase_requests
        ADD CONSTRAINT fk_purchase_requests_logistics_routing_decided_by
        FOREIGN KEY (logistics_routing_decided_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        NOT VALID;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE purchase_requests
        ADD CONSTRAINT fk_purchase_requests_logistics_completed_by
        FOREIGN KEY (logistics_completed_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        NOT VALID;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Preserve completed Logistics evidence first.
UPDATE purchase_requests pr
SET requires_logistics = TRUE,
    logistics_routing_decided_at = COALESCE(pr.logistics_routing_decided_at, pr.approved_at, pr.updated_at, pr.created_at),
    logistics_completed_at = COALESCE(pr.logistics_completed_at, po.delivery_updated_at, po.updated_at)
FROM purchase_orders po
WHERE pr.linked_po_id = po.id
  AND (
      COALESCE(po.receiving_status,'') = 'Fully Received'
      OR COALESCE(po.logistics_status,'') = 'Fully Received'
      OR COALESCE(po.status,'') = 'Fully Received'
  );

-- Preserve every historical record that was already handed to Finance.
-- This includes old PO-created requests because the previous workflow allowed
-- them to reach Finance before an explicit Logistics-routing decision existed.
UPDATE purchase_requests
SET requires_logistics = FALSE,
    logistics_routing_decided_at = COALESCE(logistics_routing_decided_at, approved_at, updated_at, created_at)
WHERE logistics_completed_at IS NULL
  AND requires_logistics IS NULL
  AND (
      next_role = 'finance'
      OR payment_status = 'Approved for Payment'
      OR status IN ('Awaiting Payment','Approved for Payment','Payment Approved')
  );

-- Existing linked POs that were not already Finance-ready are treated as
-- Logistics work, preserving the intent of the commercial-PO workflow.
UPDATE purchase_requests
SET requires_logistics = TRUE,
    logistics_routing_decided_at = COALESCE(logistics_routing_decided_at, approved_at, updated_at, created_at)
WHERE requires_logistics IS NULL
  AND linked_po_id IS NOT NULL
  AND COALESCE(status,'') NOT IN ('Paid','Completed','Closed','Archived','Rejected');

CREATE INDEX IF NOT EXISTS idx_pr_post_approval_routing
ON purchase_requests (
    next_role,
    requires_logistics,
    payment_status,
    status,
    updated_at
);

CREATE INDEX IF NOT EXISTS idx_pr_logistics_completion
ON purchase_requests (
    requires_logistics,
    logistics_completed_at,
    linked_po_id
);
