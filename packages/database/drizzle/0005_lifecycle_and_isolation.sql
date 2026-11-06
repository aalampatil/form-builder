-- Cross-row invariants and role security are maintained here, not by drizzle-kit.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'builder_runtime') THEN
    CREATE ROLE builder_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'builder_maintenance') THEN
    CREATE ROLE builder_maintenance NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('builder_runtime','builder_maintenance') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Builder roles must not be superusers or bypass row security';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO builder.field_types (code, storage_kind) VALUES
  ('SHORT_TEXT','TEXT'), ('LONG_TEXT','TEXT'), ('EMAIL','TEXT'),
  ('NUMBER','NUMBER'), ('RATING','NUMBER'), ('CHECKBOX','BOOLEAN'),
  ('DATE','DATE'), ('DATETIME','DATETIME'), ('STRUCTURED','JSON'),
  ('SINGLE_SELECT','SINGLE_SELECT'), ('DROPDOWN','SINGLE_SELECT'),
  ('MULTI_SELECT','MULTI_SELECT'), ('FILE','FILE');
--> statement-breakpoint
ALTER TABLE builder.forms ADD CONSTRAINT forms_published_version_fk
  FOREIGN KEY (workspace_id, id, published_version_id)
  REFERENCES builder.form_versions (workspace_id, form_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION builder.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
--> statement-breakpoint
CREATE FUNCTION builder.maintenance_actor() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT pg_has_role(current_user, 'builder_maintenance', 'MEMBER')
$$;
--> statement-breakpoint
CREATE FUNCTION builder.guard_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    (to_jsonb(NEW)->'id') IS DISTINCT FROM (to_jsonb(OLD)->'id') OR
    (to_jsonb(NEW)->'workspace_id') IS DISTINCT FROM (to_jsonb(OLD)->'workspace_id') OR
    (to_jsonb(NEW)->'version_id') IS DISTINCT FROM (to_jsonb(OLD)->'version_id') OR
    (to_jsonb(NEW)->'form_id') IS DISTINCT FROM (to_jsonb(OLD)->'form_id') OR
    (to_jsonb(NEW)->'submission_id') IS DISTINCT FROM (to_jsonb(OLD)->'submission_id') OR
    (to_jsonb(NEW)->'answer_id') IS DISTINCT FROM (to_jsonb(OLD)->'answer_id') OR
    (to_jsonb(NEW)->'field_id') IS DISTINCT FROM (to_jsonb(OLD)->'field_id') OR
    (to_jsonb(NEW)->'option_id') IS DISTINCT FROM (to_jsonb(OLD)->'option_id') OR
    (to_jsonb(NEW)->'file_id') IS DISTINCT FROM (to_jsonb(OLD)->'file_id') OR
    (to_jsonb(NEW)->'created_at') IS DISTINCT FROM (to_jsonb(OLD)->'created_at')
  ) THEN RAISE EXCEPTION 'Row identity, scope and creation time are immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Restricted AST: all/any/non-empty arrays, not/node, or fieldKey/operator/value.
CREATE FUNCTION builder.valid_condition(w uuid, v uuid, node jsonb, depth integer DEFAULT 0)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE child jsonb; op text;
BEGIN
  IF depth > 20 OR jsonb_typeof(node) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF node ? 'all' OR node ? 'any' THEN
    IF (node ? 'all') AND (node ? 'any') THEN RETURN false; END IF;
    child := COALESCE(node->'all', node->'any');
    IF jsonb_typeof(child) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(child) = 0 THEN RETURN false; END IF;
    FOR child IN SELECT value FROM jsonb_array_elements(child) LOOP
      IF NOT builder.valid_condition(w, v, child, depth + 1) THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF node ? 'not' THEN
    RETURN builder.valid_condition(w, v, node->'not', depth + 1);
  END IF;
  op := node->>'operator';
  RETURN COALESCE(op IN ('equals','not_equals','greater_than','less_than','contains','is_answered')
    AND (op = 'is_answered' OR node ? 'value')
    AND EXISTS (SELECT FROM builder.form_fields WHERE workspace_id = w AND version_id = v AND key = node->>'fieldKey'), false);
END $$;
--> statement-breakpoint
CREATE FUNCTION builder.guard_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PUBLISHED' AND NOT builder.maintenance_actor() THEN
      RAISE EXCEPTION 'Published versions are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'Create a draft before publishing' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'PUBLISHED' THEN RAISE EXCEPTION 'Published versions are immutable' USING ERRCODE = '23514'; END IF;
  IF NEW.version_number <> OLD.version_number THEN RAISE EXCEPTION 'Version number is immutable' USING ERRCODE = '23514'; END IF;
  NEW.revision := OLD.revision + 1;
  IF NEW.status = 'PUBLISHED' THEN
    IF NOT EXISTS (SELECT FROM builder.form_steps WHERE workspace_id = NEW.workspace_id AND version_id = NEW.id)
       OR NOT EXISTS (SELECT FROM builder.form_fields WHERE workspace_id = NEW.workspace_id AND version_id = NEW.id) THEN
      RAISE EXCEPTION 'Publication requires steps and fields' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT FROM builder.form_fields f JOIN builder.field_types t ON t.code = f.type_code
      WHERE f.workspace_id = NEW.workspace_id AND f.version_id = NEW.id AND
      ((t.storage_kind IN ('SINGLE_SELECT','MULTI_SELECT') AND NOT EXISTS (
          SELECT FROM builder.field_options o WHERE o.workspace_id = f.workspace_id AND o.version_id = f.version_id AND o.field_id = f.id))
       OR (t.storage_kind NOT IN ('SINGLE_SELECT','MULTI_SELECT') AND EXISTS (
          SELECT FROM builder.field_options o WHERE o.workspace_id = f.workspace_id AND o.version_id = f.version_id AND o.field_id = f.id)))
    ) THEN RAISE EXCEPTION 'Choice options must match field storage kind' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT FROM builder.form_logic_rules r WHERE r.workspace_id = NEW.workspace_id AND r.version_id = NEW.id
      AND NOT builder.valid_condition(NEW.workspace_id, NEW.id, r.condition)) THEN
      RAISE EXCEPTION 'Invalid conditional expression' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION builder.guard_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; parent_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT status INTO parent_status FROM builder.form_versions
    WHERE workspace_id = r.workspace_id AND id = r.version_id FOR UPDATE;
  -- Parent may already be gone during an explicitly authorized cascading purge.
  IF TG_OP = 'DELETE' AND builder.maintenance_actor() THEN RETURN OLD; END IF;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Only draft definitions can be changed' USING ERRCODE = '23514';
  END IF;
  UPDATE builder.form_versions SET revision = revision + 1 WHERE workspace_id = r.workspace_id AND id = r.version_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION builder.guard_form() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.published_version_id IS NOT NULL AND NOT EXISTS (
    SELECT FROM builder.form_versions WHERE workspace_id = NEW.workspace_id AND form_id = NEW.id
      AND id = NEW.published_version_id AND status = 'PUBLISHED'
  ) THEN RAISE EXCEPTION 'Current version must be published and belong to this form' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION builder.guard_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE intake record; retention integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT builder.maintenance_actor() THEN RAISE EXCEPTION 'Use the maintenance purge role' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT f.*, w.deleted_at AS workspace_deleted, w.retention_days INTO intake
      FROM builder.forms f JOIN builder.workspaces w ON w.id = f.workspace_id
      WHERE f.workspace_id = NEW.workspace_id AND f.id = NEW.form_id FOR SHARE OF f, w;
    IF NOT FOUND OR intake.deleted_at IS NOT NULL OR intake.archived_at IS NOT NULL OR intake.workspace_deleted IS NOT NULL
       OR intake.published_version_id IS DISTINCT FROM NEW.version_id THEN
      RAISE EXCEPTION 'Form is not accepting new submissions for this version' USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'IN_PROGRESS' THEN RAISE EXCEPTION 'Start submissions in progress' USING ERRCODE = '23514'; END IF;
    SELECT COALESCE((settings->>'retentionDays')::integer, intake.retention_days) INTO retention
      FROM builder.form_versions WHERE workspace_id = NEW.workspace_id AND id = NEW.version_id AND status = 'PUBLISHED';
    IF NOT FOUND THEN RAISE EXCEPTION 'Submission version must be published' USING ERRCODE = '23514'; END IF;
    NEW.expires_at := CASE WHEN retention IS NULL THEN NULL ELSE NEW.started_at + retention * interval '1 day' END;
  ELSE
    IF NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
      RAISE EXCEPTION 'Submission start and idempotency key are immutable' USING ERRCODE = '23514';
    END IF;
    IF (NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
       AND NOT builder.maintenance_actor() THEN
      RAISE EXCEPTION 'Retention changes require maintenance role' USING ERRCODE = '42501';
    END IF;
    IF OLD.status <> 'IN_PROGRESS' AND
      (to_jsonb(NEW) - ARRAY['updated_at','expires_at','deleted_at','respondent_user_id']) IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['updated_at','expires_at','deleted_at','respondent_user_id']) THEN
      RAISE EXCEPTION 'Terminal submissions are immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.respondent_user_id IS DISTINCT FROM OLD.respondent_user_id AND NOT builder.maintenance_actor() THEN
      RAISE EXCEPTION 'Respondent reassignment requires maintenance role' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT FROM builder.forms f JOIN builder.workspaces w ON w.id = f.workspace_id
       WHERE f.workspace_id = NEW.workspace_id AND f.id = NEW.form_id AND (f.deleted_at IS NOT NULL OR w.deleted_at IS NOT NULL))
       AND NOT builder.maintenance_actor() THEN
      RAISE EXCEPTION 'Deleted forms do not accept updates' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'COMPLETED' AND EXISTS (
      SELECT FROM builder.answer_files a JOIN builder.submission_files f ON f.id = a.file_id
      WHERE a.workspace_id = NEW.workspace_id AND a.submission_id = NEW.id AND f.upload_state <> 'READY'
    ) THEN RAISE EXCEPTION 'Attached uploads must be ready before completion' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION builder.guard_answer_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; sub_id uuid; sub record; kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_TABLE_NAME = 'answer_selections' THEN
    SELECT submission_id INTO sub_id FROM builder.submission_answers WHERE id = r.answer_id AND workspace_id = r.workspace_id;
  ELSE sub_id := r.submission_id; END IF;
  IF TG_OP = 'DELETE' AND builder.maintenance_actor() THEN RETURN OLD; END IF;
  SELECT * INTO sub FROM builder.form_submissions WHERE workspace_id = r.workspace_id AND id = sub_id FOR UPDATE;
  IF NOT FOUND OR sub.status <> 'IN_PROGRESS' OR sub.deleted_at IS NOT NULL THEN
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
-- Deferred validation sees final transaction state, including children inserted after answers.
CREATE FUNCTION builder.check_answer_children() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE answer_id_value uuid; a record; selections integer; files integer;
BEGIN
  IF TG_TABLE_NAME = 'submission_answers' THEN
    IF TG_OP = 'DELETE' THEN answer_id_value := OLD.id; ELSE answer_id_value := NEW.id; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN answer_id_value := OLD.answer_id; ELSE answer_id_value := NEW.answer_id; END IF;
  END IF;
  SELECT * INTO a FROM builder.submission_answers WHERE id = answer_id_value;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*) INTO selections FROM builder.answer_selections WHERE answer_id = a.id;
  SELECT count(*) INTO files FROM builder.answer_files WHERE answer_id = a.id;
  IF (a.storage_kind = 'SINGLE_SELECT' AND (selections <> 1 OR files <> 0))
    OR (a.storage_kind = 'MULTI_SELECT' AND (selections < 1 OR files <> 0))
    OR (a.storage_kind = 'FILE' AND (files < 1 OR selections <> 0))
    OR (a.storage_kind NOT IN ('SINGLE_SELECT','MULTI_SELECT','FILE') AND (selections <> 0 OR files <> 0)) THEN
    RAISE EXCEPTION 'Answer child payload does not match storage kind/cardinality' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION builder.check_version_settings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.settings ? 'retentionDays' AND (
    jsonb_typeof(NEW.settings->'retentionDays') IS DISTINCT FROM 'number' OR
    (NEW.settings->>'retentionDays') !~ '^[1-9][0-9]{0,4}$'
  ) THEN RAISE EXCEPTION 'retentionDays must be a positive integer <= 99999' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION builder.audit_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; w uuid; actor uuid; action_value text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_TABLE_NAME = 'workspaces' THEN w := r.id; ELSE w := r.workspace_id; END IF;
  actor := NULLIF(current_setting('app.actor_user_id', true), '')::uuid;
  action_value := TG_TABLE_NAME || '.' || lower(TG_OP);
  INSERT INTO builder.workspace_audit_events (workspace_id, actor_user_id, action, entity_type, entity_id)
    VALUES (w, actor, action_value, TG_TABLE_NAME, r.id);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER a_version_guard BEFORE INSERT OR UPDATE OR DELETE ON builder.form_versions FOR EACH ROW EXECUTE FUNCTION builder.guard_version();
CREATE TRIGGER b_version_settings BEFORE INSERT OR UPDATE ON builder.form_versions FOR EACH ROW EXECUTE FUNCTION builder.check_version_settings();
CREATE TRIGGER b_form_guard BEFORE INSERT OR UPDATE ON builder.forms FOR EACH ROW EXECUTE FUNCTION builder.guard_form();
CREATE TRIGGER b_submission_guard BEFORE INSERT OR UPDATE OR DELETE ON builder.form_submissions FOR EACH ROW EXECUTE FUNCTION builder.guard_submission();
CREATE TRIGGER audit_submission_purge AFTER DELETE ON builder.form_submissions FOR EACH ROW EXECUTE FUNCTION builder.audit_lifecycle();
CREATE TRIGGER audit_membership_removal AFTER DELETE ON builder.workspace_memberships FOR EACH ROW EXECUTE FUNCTION builder.audit_lifecycle();
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['workspaces','workspace_memberships','forms','form_versions','form_steps','form_fields','field_options','form_logic_rules','form_submissions','submission_answers','submission_files'] LOOP
    EXECUTE format('CREATE TRIGGER z_touch BEFORE UPDATE ON builder.%I FOR EACH ROW EXECUTE FUNCTION builder.touch_updated_at()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['workspaces','workspace_memberships','forms','form_versions','form_steps','form_fields','field_options','form_logic_rules','form_submissions','submission_answers','submission_files','answer_selections','answer_files'] LOOP
    EXECUTE format('CREATE TRIGGER a_identity BEFORE UPDATE ON builder.%I FOR EACH ROW EXECUTE FUNCTION builder.guard_identity()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['form_steps','form_fields','field_options','form_logic_rules'] LOOP
    EXECUTE format('CREATE TRIGGER b_definition_guard BEFORE INSERT OR UPDATE OR DELETE ON builder.%I FOR EACH ROW EXECUTE FUNCTION builder.guard_definition()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['submission_answers','answer_selections','submission_files','answer_files'] LOOP
    EXECUTE format('CREATE TRIGGER b_answer_guard BEFORE INSERT OR UPDATE OR DELETE ON builder.%I FOR EACH ROW EXECUTE FUNCTION builder.guard_answer_write()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['submission_answers','answer_selections','answer_files'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER answer_children_check AFTER INSERT OR UPDATE OR DELETE ON builder.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION builder.check_answer_children()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['workspaces','workspace_memberships','forms','form_versions','form_submissions'] LOOP
    EXECUTE format('CREATE TRIGGER audit_lifecycle AFTER INSERT OR UPDATE ON builder.%I FOR EACH ROW EXECUTE FUNCTION builder.audit_lifecycle()', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Context is set only by trusted server authorization, transaction-locally.
DO $$ DECLARE t text; scope_column text; BEGIN
  FOREACH t IN ARRAY ARRAY['workspaces','workspace_memberships','forms','form_versions','form_steps','form_fields','field_options','form_logic_rules','form_submissions','submission_answers','answer_selections','submission_files','answer_files','workspace_audit_events'] LOOP
    scope_column := CASE WHEN t = 'workspaces' THEN 'id' ELSE 'workspace_id' END;
    EXECUTE format('ALTER TABLE builder.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE builder.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY workspace_scope ON builder.%I USING (%I = NULLIF(current_setting(''app.workspace_id'', true), '''')::uuid) WITH CHECK (%I = NULLIF(current_setting(''app.workspace_id'', true), '''')::uuid)', t, scope_column, scope_column);
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA builder FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA builder FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA builder FROM PUBLIC;
GRANT USAGE ON SCHEMA builder TO builder_runtime, builder_maintenance;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA builder TO builder_runtime, builder_maintenance;
GRANT SELECT ON ALL TABLES IN SCHEMA builder TO builder_runtime, builder_maintenance;
GRANT INSERT, UPDATE, DELETE ON builder.workspaces, builder.workspace_memberships, builder.forms,
  builder.form_versions, builder.form_steps, builder.form_fields, builder.field_options, builder.form_logic_rules,
  builder.form_submissions, builder.submission_answers, builder.answer_selections, builder.submission_files, builder.answer_files
  TO builder_runtime, builder_maintenance;
GRANT INSERT ON builder.workspace_audit_events TO builder_runtime, builder_maintenance;
GRANT UPDATE, DELETE ON builder.workspace_audit_events TO builder_maintenance;
-- No TRUNCATE, schema CREATE, registry mutation, or legacy/global identity access is granted.
