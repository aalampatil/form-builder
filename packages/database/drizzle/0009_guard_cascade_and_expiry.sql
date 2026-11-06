CREATE OR REPLACE FUNCTION builder.guard_answer_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; sub_id uuid; sub record; kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_TABLE_NAME = 'answer_selections' THEN
    SELECT submission_id INTO sub_id FROM builder.submission_answers WHERE id = r.answer_id AND workspace_id = r.workspace_id;
    -- Answer deletion already locked/validated its submission before cascading.
    IF TG_OP = 'DELETE' AND sub_id IS NULL THEN RETURN OLD; END IF;
  ELSE sub_id := r.submission_id; END IF;
  IF TG_OP = 'DELETE' AND builder.maintenance_actor() THEN RETURN OLD; END IF;
  SELECT * INTO sub FROM builder.form_submissions WHERE workspace_id = r.workspace_id AND id = sub_id FOR UPDATE;
  IF NOT FOUND OR sub.status <> 'IN_PROGRESS' OR sub.deleted_at IS NOT NULL OR sub.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Answers/files require an active in-progress submission' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM builder.forms f JOIN builder.workspaces w ON w.id = f.workspace_id
    WHERE f.workspace_id = sub.workspace_id AND f.id = sub.form_id
      AND f.deleted_at IS NULL AND w.deleted_at IS NULL FOR SHARE OF f, w;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deleted forms do not accept answers' USING ERRCODE = '23514'; END IF;
  IF TG_TABLE_NAME = 'submission_answers' AND TG_OP <> 'DELETE' THEN
    SELECT t.storage_kind INTO kind FROM builder.form_fields f JOIN builder.field_types t ON t.code = f.type_code
      WHERE f.workspace_id = r.workspace_id AND f.version_id = r.version_id AND f.id = r.field_id;
    IF kind IS DISTINCT FROM r.storage_kind THEN RAISE EXCEPTION 'Answer kind does not match field' USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION builder.guard_submission_expiry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.expires_at <= clock_timestamp() AND NOT builder.maintenance_actor() THEN
    RAISE EXCEPTION 'Expired submissions cannot be updated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER c_submission_expiry BEFORE UPDATE ON builder.form_submissions
  FOR EACH ROW EXECUTE FUNCTION builder.guard_submission_expiry();
REVOKE ALL ON FUNCTION builder.guard_submission_expiry() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION builder.guard_submission_expiry() TO builder_runtime, builder_maintenance;
