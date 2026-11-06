-- Expansion only. Legacy definitions are current snapshots, never historical truth.
-- Run while legacy writers are paused. Source timestamp interpretation is UTC.
DO $$ DECLARE bad uuid; BEGIN
  SELECT id INTO bad FROM public.forms WHERE slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(btrim(title)) = 0 LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Legacy form % has an invalid slug/title; reconcile before migration', bad; END IF;
  SELECT id INTO bad FROM public.form_fields WHERE key !~ '^[a-zA-Z][a-zA-Z0-9_]*$'
    OR length(btrim(label)) = 0 OR jsonb_typeof(config) <> 'object' LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Legacy field % has invalid key/label/config; reconcile before migration', bad; END IF;
  SELECT id INTO bad FROM public.forms WHERE jsonb_typeof(settings) <> 'object' LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Legacy form % settings must be an object; reconcile before migration', bad; END IF;
END $$;
--> statement-breakpoint
DO $$ DECLARE owner record; form record; workspace_uuid uuid; version_uuid uuid; step_uuid uuid; previous_context text;
BEGIN
  previous_context := current_setting('app.workspace_id', true);
  FOR owner IN SELECT DISTINCT u.id, u.full_name FROM public.users u JOIN public.forms f ON f.owner_id = u.id LOOP
    workspace_uuid := md5('legacy_workspace:' || owner.id::text)::uuid;
    PERFORM set_config('app.workspace_id', workspace_uuid::text, true);
    INSERT INTO builder.workspaces (id, owner_user_id, name, slug)
      VALUES (workspace_uuid, owner.id, left(owner.full_name || ' workspace',160), 'legacy-' || owner.id::text);
    FOR form IN SELECT * FROM public.forms WHERE owner_id = owner.id LOOP
      version_uuid := md5('legacy_version:' || form.id::text)::uuid;
      step_uuid := md5('legacy_step:' || form.id::text)::uuid;
      INSERT INTO builder.forms (id, workspace_id, creator_user_id, slug, archived_at, created_at)
        VALUES (form.id, workspace_uuid, owner.id, form.slug, form.archived_at AT TIME ZONE 'UTC', form.created_at AT TIME ZONE 'UTC');
      INSERT INTO builder.form_versions (id, workspace_id, form_id, version_number, title, description, settings)
        VALUES (version_uuid, workspace_uuid, form.id, 1, form.title, form.description,
          jsonb_build_object('legacyImport', jsonb_build_object('source','public.forms','requiresReview',true)));
      INSERT INTO builder.form_steps (id, workspace_id, version_id, key, position) VALUES (step_uuid, workspace_uuid, version_uuid, 'main', 0);
      INSERT INTO builder.form_fields (id, workspace_id, version_id, step_id, key, type_code, label, help_text, required, position, configuration)
        SELECT id, workspace_uuid, version_uuid, step_uuid, key, type::text, label, help_text, required,
          (row_number() OVER (ORDER BY "order", id) - 1)::integer, config
        FROM public.form_fields WHERE form_id = form.id;
      -- Legacy options were JSON strings, with no stable relational IDs.
      INSERT INTO builder.field_options (workspace_id, version_id, field_id, key, label, position)
        SELECT workspace_uuid, version_uuid, f.id, 'option_' || option.ordinality::text, option.value #>> '{}', (option.ordinality - 1)::integer
        FROM public.form_fields f CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(f.config->'options') = 'array' THEN f.config->'options' ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS option(value, ordinality)
        WHERE f.form_id = form.id AND f.type::text IN ('SINGLE_SELECT','MULTI_SELECT','DROPDOWN')
          AND jsonb_typeof(option.value) = 'string' AND length(btrim(option.value #>> '{}')) > 0;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.workspace_id', COALESCE(previous_context, ''), true);
END $$;
-- Responses remain byte-for-byte in public.form_responses/form_response_answers.
-- Imported forms are unpublished drafts requiring review. Do not switch intake URLs
-- until an application cutover explicitly handles legacy settings and access controls.
