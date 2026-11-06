-- Read-only reconciliation report. Run with a privileged migration/reporting login.
-- Legacy response definitions cannot be reconstructed; every legacy response
-- remains in public, even when its field key still exists in today's draft.
SELECT
  (SELECT count(*) FROM public.forms) AS legacy_forms,
  (SELECT count(*) FROM builder.forms f JOIN public.forms old ON old.id = f.id) AS imported_forms,
  (SELECT count(*) FROM public.form_fields) AS legacy_fields,
  (SELECT count(*) FROM builder.form_fields f JOIN public.form_fields old ON old.id = f.id) AS imported_fields,
  (SELECT count(*) FROM public.form_responses) AS preserved_legacy_submissions,
  (SELECT count(*) FROM public.form_response_answers) AS preserved_legacy_answers;

SELECT a.id AS answer_id, r.form_id, a.response_id, a.field_key,
  CASE WHEN f.id IS NULL THEN 'missing_current_field'
       WHEN a.field_id IS NULL THEN 'unbound_legacy_answer'
       WHEN a.field_id <> f.id THEN 'field_id_key_mismatch'
       ELSE 'historical_definition_unverified' END AS reconciliation_reason
FROM public.form_response_answers a
JOIN public.form_responses r ON r.id = a.response_id
LEFT JOIN public.form_fields f ON f.form_id = r.form_id AND f.key = a.field_key
ORDER BY a.response_id, a.id;

-- Current-draft choices omitted by strict string/label conversion require review.
SELECT f.form_id, f.id AS field_id, f.key,
  jsonb_typeof(f.config->'options') AS legacy_options_type,
  (SELECT count(*) FROM builder.field_options o WHERE o.field_id = f.id) AS imported_options
FROM public.form_fields f
WHERE f.type::text IN ('SINGLE_SELECT','MULTI_SELECT','DROPDOWN')
ORDER BY f.form_id, f.id;
