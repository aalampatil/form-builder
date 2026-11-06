-- Streaming, read-only JSONL export. Access contains personal data: restrict output.
-- Example: psql -X --set=ON_ERROR_STOP=on "$MIGRATION_DATABASE_URL" -f operations/legacy-export.sql > legacy.jsonl
-- Public legacy FK/indexes support the correlated answer lookup.
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\set FETCH_COUNT 1000
-- Unaligned psql output preserves JSON escapes; COPY text would escape them again.
  SELECT jsonb_build_object(
    'source', 'legacy_unversioned',
    'submission', to_jsonb(r),
    'answers', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)
      FROM public.form_response_answers a WHERE a.response_id = r.id), '[]'::jsonb)
  )
  FROM public.form_responses r
  ORDER BY r.id;
