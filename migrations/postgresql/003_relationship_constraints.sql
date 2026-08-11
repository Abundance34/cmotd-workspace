-- Foreign keys are added NOT VALID so a legacy database can be loaded first.
-- scripts/verify_database_migration.py reports orphaned rows and can validate
-- constraints after discrepancies are resolved.
BEGIN;

CREATE OR REPLACE FUNCTION pf_add_fk(
    constraint_name TEXT,
    child_table TEXT,
    child_column TEXT,
    parent_table TEXT,
    parent_column TEXT DEFAULT 'id',
    delete_action TEXT DEFAULT 'SET NULL'
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF to_regclass(child_table) IS NULL OR to_regclass(parent_table) IS NULL THEN
        RETURN;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name=child_table AND column_name=child_column
    ) THEN
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname=constraint_name) THEN
        RETURN;
    END IF;
    EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(%I) ON DELETE %s DEFERRABLE INITIALLY DEFERRED NOT VALID',
        child_table, constraint_name, child_column, parent_table, parent_column, delete_action
    );
END $$;

-- Identity and access relationships.
SELECT pf_add_fk('fk_users_role','users','role','roles','name','RESTRICT');
SELECT pf_add_fk('fk_role_permissions_role','role_permissions','role_name','roles','name','CASCADE');
SELECT pf_add_fk('fk_role_permissions_permission','role_permissions','permission_name','permissions','name','CASCADE');
SELECT pf_add_fk('fk_password_history_user','password_history','user_id','users','id','CASCADE');
SELECT pf_add_fk('fk_user_sessions_user','user_sessions','user_id','users','id','CASCADE');
SELECT pf_add_fk('fk_notification_preferences_user','notification_preferences','user_id','users','id','CASCADE');
SELECT pf_add_fk('fk_push_subscriptions_user','push_subscriptions','user_id','users','id','CASCADE');
SELECT pf_add_fk('fk_section_attention_reads_user','section_attention_reads','user_id','users','id','CASCADE');

-- Purchase request lifecycle.
SELECT pf_add_fk('fk_purchase_requests_requested_by','purchase_requests','requested_by','users','id','RESTRICT');
SELECT pf_add_fk('fk_purchase_requests_facility_manager','purchase_requests','facility_manager_user_id','users','id','SET NULL');
SELECT pf_add_fk('fk_purchase_requests_procurement_manager','purchase_requests','assigned_procurement_manager_id','users','id','SET NULL');
SELECT pf_add_fk('fk_purchase_requests_imported_doc','purchase_requests','imported_doc_id','imported_legacy_documents','id','SET NULL');
SELECT pf_add_fk('fk_purchase_requests_selected_vendor','purchase_requests','selected_vendor_id','vendors','id','SET NULL');
SELECT pf_add_fk('fk_purchase_requests_selected_quote','purchase_requests','selected_vendor_quote_id','vendor_quotes','id','SET NULL');
SELECT pf_add_fk('fk_purchase_requests_selected_payee','purchase_requests','selected_payee_detail_id','payment_payee_details','id','SET NULL');
SELECT pf_add_fk('fk_purchase_request_items_request','purchase_request_items','request_id','purchase_requests','id','CASCADE');
SELECT pf_add_fk('fk_sourcing_tasks_request','sourcing_tasks','request_id','purchase_requests','id','CASCADE');
SELECT pf_add_fk('fk_sourcing_tasks_assigned','sourcing_tasks','assigned_to','users','id','SET NULL');
SELECT pf_add_fk('fk_sourcing_tasks_vendor','sourcing_tasks','recommended_vendor_id','vendors','id','SET NULL');
SELECT pf_add_fk('fk_vendor_quotes_task','vendor_quotes','sourcing_task_id','sourcing_tasks','id','CASCADE');
SELECT pf_add_fk('fk_vendor_quotes_request','vendor_quotes','request_id','purchase_requests','id','CASCADE');
SELECT pf_add_fk('fk_vendor_quotes_vendor','vendor_quotes','vendor_id','vendors','id','SET NULL');
SELECT pf_add_fk('fk_vendor_quote_items_quote','vendor_quote_items','vendor_quote_id','vendor_quotes','id','CASCADE');
SELECT pf_add_fk('fk_vendor_quote_items_request_item','vendor_quote_items','request_item_id','purchase_request_items','id','SET NULL');
SELECT pf_add_fk('fk_quote_comparisons_task','quote_comparisons','sourcing_task_id','sourcing_tasks','id','CASCADE');

-- Approvals, comments, activity and notifications.
SELECT pf_add_fk('fk_approval_history_user','approval_history','user_id','users','id','SET NULL');
SELECT pf_add_fk('fk_approval_history_approver','approval_history','approved_by_user_id','users','id','SET NULL');
SELECT pf_add_fk('fk_approval_rescissions_history','approval_rescissions','approval_history_id','approval_history','id','SET NULL');
SELECT pf_add_fk('fk_approval_rescissions_original_user','approval_rescissions','original_approver_user_id','users','id','SET NULL');
SELECT pf_add_fk('fk_approval_rescissions_actor','approval_rescissions','rescinded_by_user_id','users','id','RESTRICT');
SELECT pf_add_fk('fk_comments_user','comments','user_id','users','id','RESTRICT');
SELECT pf_add_fk('fk_attachments_user','attachments','uploaded_by','users','id','SET NULL');
SELECT pf_add_fk('fk_activity_logs_user','activity_logs','user_id','users','id','SET NULL');
SELECT pf_add_fk('fk_notifications_user','notifications','user_id','users','id','CASCADE');
SELECT pf_add_fk('fk_notification_outbox_target','notification_outbox','target_user_id','users','id','CASCADE');
SELECT pf_add_fk('fk_collaboration_messages_thread','collaboration_messages','thread_id','collaboration_threads','id','CASCADE');
SELECT pf_add_fk('fk_collaboration_messages_sender','collaboration_messages','sender_user_id','users','id','RESTRICT');

-- Purchase orders, receiving, invoices and expenses.
SELECT pf_add_fk('fk_purchase_orders_request','purchase_orders','request_id','purchase_requests','id','SET NULL');
SELECT pf_add_fk('fk_purchase_orders_vendor','purchase_orders','vendor_id','vendors','id','SET NULL');
SELECT pf_add_fk('fk_purchase_order_items_po','purchase_order_items','po_id','purchase_orders','id','CASCADE');
SELECT pf_add_fk('fk_receiving_slips_po','receiving_slips','po_id','purchase_orders','id','CASCADE');
SELECT pf_add_fk('fk_receiving_slips_vendor','receiving_slips','vendor_id','vendors','id','SET NULL');
SELECT pf_add_fk('fk_receiving_slip_items_slip','receiving_slip_items','slip_id','receiving_slips','id','CASCADE');
SELECT pf_add_fk('fk_receiving_slip_items_po_item','receiving_slip_items','po_item_id','purchase_order_items','id','SET NULL');
SELECT pf_add_fk('fk_invoices_po','invoices','po_id','purchase_orders','id','SET NULL');
SELECT pf_add_fk('fk_invoices_vendor','invoices','vendor_id','vendors','id','SET NULL');
SELECT pf_add_fk('fk_invoices_request','invoices','linked_request_id','purchase_requests','id','SET NULL');
SELECT pf_add_fk('fk_invoice_items_invoice','invoice_items','invoice_id','invoices','id','CASCADE');
SELECT pf_add_fk('fk_expenses_vendor','expenses','vendor_id','vendors','id','SET NULL');
SELECT pf_add_fk('fk_expenses_po','expenses','linked_po_id','purchase_orders','id','SET NULL');
SELECT pf_add_fk('fk_expenses_receipt','expenses','receipt_id','receipt_records','id','SET NULL');

-- Payee, payment, receipt and OCR evidence.
SELECT pf_add_fk('fk_payee_request','payment_payee_details','purchase_request_id','purchase_requests','id','CASCADE');
SELECT pf_add_fk('fk_payee_po','payment_payee_details','purchase_order_id','purchase_orders','id','SET NULL');
SELECT pf_add_fk('fk_payee_vendor','payment_payee_details','vendor_id','vendors','id','SET NULL');
SELECT pf_add_fk('fk_payee_approval','payment_payee_details','approval_history_id','approval_history','id','SET NULL');
-- payment_payee_detail_versions is immutable audit history and may outlive
-- the current payee row. Keep the historical numeric reference without a
-- cascading foreign key so legacy audit evidence is never deleted.
SELECT pf_add_fk('fk_payments_request','payments','request_id','purchase_requests','id','SET NULL');
SELECT pf_add_fk('fk_payments_invoice','payments','invoice_id','invoices','id','SET NULL');
SELECT pf_add_fk('fk_payments_po','payments','po_id','purchase_orders','id','SET NULL');
SELECT pf_add_fk('fk_payments_vendor','payments','vendor_id','vendors','id','SET NULL');
SELECT pf_add_fk('fk_payments_payee','payments','payee_detail_id','payment_payee_details','id','SET NULL');
SELECT pf_add_fk('fk_payments_approval','payments','approval_history_id','approval_history','id','SET NULL');
SELECT pf_add_fk('fk_payments_receipt','payments','receipt_id','receipt_records','id','SET NULL');
SELECT pf_add_fk('fk_payments_proof_receipt','payments','proof_of_payment_receipt_id','receipt_records','id','SET NULL');
SELECT pf_add_fk('fk_payments_vendor_receipt','payments','vendor_receipt_id','receipt_records','id','SET NULL');
SELECT pf_add_fk('fk_receipts_payment','receipt_records','payment_id','payments','id','CASCADE');
SELECT pf_add_fk('fk_receipts_linked_payment','receipt_records','linked_payment_id','payments','id','CASCADE');
SELECT pf_add_fk('fk_receipts_request','receipt_records','request_id','purchase_requests','id','SET NULL');
SELECT pf_add_fk('fk_receipts_vendor','receipt_records','vendor_id','vendors','id','SET NULL');
SELECT pf_add_fk('fk_receipt_items_receipt','receipt_items','receipt_id','receipt_records','id','CASCADE');
SELECT pf_add_fk('fk_receipt_versions_receipt','receipt_document_versions','receipt_id','receipt_records','id','CASCADE');

-- Gateway pass and logistics.
SELECT pf_add_fk('fk_gateway_passes_facility_manager','gateway_passes','facility_manager_user_id','users','id','RESTRICT');
SELECT pf_add_fk('fk_gateway_pass_items_pass','gateway_pass_items','gateway_pass_id','gateway_passes','id','CASCADE');
SELECT pf_add_fk('fk_gateway_pass_events_pass','gateway_pass_events','gateway_pass_id','gateway_passes','id','CASCADE');
SELECT pf_add_fk('fk_gateway_pass_approvals_pass','gateway_pass_approvals','gateway_pass_id','gateway_passes','id','CASCADE');
SELECT pf_add_fk('fk_logistics_exceptions_po','logistics_exceptions','po_id','purchase_orders','id','CASCADE');
SELECT pf_add_fk('fk_logistics_exceptions_request','logistics_exceptions','request_id','purchase_requests','id','SET NULL');
SELECT pf_add_fk('fk_logistics_documents_po','logistics_documents','po_id','purchase_orders','id','SET NULL');
SELECT pf_add_fk('fk_logistics_documents_gateway','logistics_documents','gateway_pass_id','gateway_passes','id','SET NULL');

-- Administration and delegation.
SELECT pf_add_fk('fk_facility_manager_links_fm','facility_manager_links','facility_manager_user_id','users','id','CASCADE');
SELECT pf_add_fk('fk_facility_manager_links_pm','facility_manager_links','procurement_manager_user_id','users','id','CASCADE');
SELECT pf_add_fk('fk_user_availability_user','user_availability','user_id','users','id','CASCADE');
SELECT pf_add_fk('fk_approval_delegations_primary_user','approval_delegations','primary_user_id','users','id','SET NULL');
SELECT pf_add_fk('fk_approval_delegations_delegate_user','approval_delegations','delegate_user_id','users','id','SET NULL');
SELECT pf_add_fk('fk_annual_budgets_creator','annual_budgets','created_by','users','id','SET NULL');
SELECT pf_add_fk('fk_income_entries_creator','income_entries','created_by','users','id','SET NULL');

DROP FUNCTION pf_add_fk(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT);
COMMIT;
