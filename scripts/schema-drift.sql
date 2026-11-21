-- ZNLY-353: normalised snapshot of the public schema, one line per fact:  kind|key|detail
-- Read-only (pure catalog SELECTs). Run by scripts/schema-drift.sh against two databases; the two outputs are diffed.
-- Lines are made comparable across databases: object names are kept only where the NAME is the fact (tables, columns,
-- triggers, policies, functions); constraints and indexes are emitted BOTH by name (kind *-name) and by definition with the
-- name stripped (kind constraint / index), so a renamed-but-identical index matches on definition and only shows as a note.
-- Output: sorted, no header, '|' separated, newlines inside definitions collapsed to one space.
SET search_path = pg_catalog, public;   -- the same type / function qualification on both sides

WITH
tbl AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
),
lines AS (
  SELECT 'table' AS kind, t.relname AS key, t.relkind::text AS detail FROM tbl t
  UNION ALL
  SELECT 'column', t.relname || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'null' END
         || ' default ' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-')
         || CASE WHEN a.attgenerated <> '' THEN ' generated' ELSE '' END
  FROM tbl t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  UNION ALL
  -- constraints by definition (name stripped) ...
  SELECT 'constraint', t.relname, k.contype::text || ' ' || regexp_replace(pg_get_constraintdef(k.oid), '\s+', ' ', 'g')
  FROM tbl t JOIN pg_constraint k ON k.conrelid = t.oid
  UNION ALL
  -- ... and by name (informational: a rename alone is a note, not a failure)
  SELECT 'constraint-name', t.relname || '.' || k.conname, k.contype::text
  FROM tbl t JOIN pg_constraint k ON k.conrelid = t.oid
  UNION ALL
  SELECT 'index', t.relname, regexp_replace(regexp_replace(pg_get_indexdef(i.indexrelid), '\s+', ' ', 'g'), 'INDEX \S+ ON', 'INDEX ON')
  FROM tbl t JOIN pg_index i ON i.indrelid = t.oid
  UNION ALL
  SELECT 'index-name', t.relname || '.' || ic.relname, ''
  FROM tbl t JOIN pg_index i ON i.indrelid = t.oid JOIN pg_class ic ON ic.oid = i.indexrelid
  UNION ALL
  -- triggers: by name; detail = timing/events/function from the definition with the name stripped
  SELECT 'trigger', t.relname || '.' || g.tgname,
         regexp_replace(regexp_replace(pg_get_triggerdef(g.oid), '\s+', ' ', 'g'), '^CREATE (CONSTRAINT )?TRIGGER \S+ ', '') || CASE WHEN g.tgenabled = 'O' THEN '' ELSE ' enabled=' || g.tgenabled::text END
  FROM tbl t JOIN pg_trigger g ON g.tgrelid = t.oid WHERE NOT g.tgisinternal
  UNION ALL
  -- functions: signature is the key; detail = result type, security, volatility, md5 of the body
  SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         pg_get_function_result(p.oid) || ' ' || CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END || ' ' || p.provolatile::text
         || ' ' || l.lanname || ' md5=' || md5(p.prosrc)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'rls', t.relname, CASE WHEN t.relrowsecurity THEN 'enabled' ELSE 'disabled' END || CASE WHEN t.relforcerowsecurity THEN ' forced' ELSE '' END
  FROM tbl t
  UNION ALL
  SELECT 'policy', pol.tablename || '.' || pol.policyname,
         pol.cmd || ' roles=' || array_to_string(pol.roles, ',') || ' permissive=' || pol.permissive
         || ' using=' || COALESCE(regexp_replace(pol.qual, '\s+', ' ', 'g'), '-')
         || ' check=' || COALESCE(regexp_replace(pol.with_check, '\s+', ' ', 'g'), '-')
  FROM pg_policies pol WHERE pol.schemaname = 'public'
  UNION ALL
  SELECT 'view', c.relname, c.relkind::text || ' md5=' || md5(pg_get_viewdef(c.oid))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'enum', ty.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
  FROM pg_type ty JOIN pg_namespace n ON n.oid = ty.typnamespace JOIN pg_enum e ON e.enumtypid = ty.oid
  WHERE n.nspname = 'public' GROUP BY ty.typname
  UNION ALL
  SELECT 'extension', x.extname, ''
  FROM pg_extension x
)
SELECT replace(replace(kind || '|' || key || '|' || detail, E'\n', ' '), E'\r', ' ')
FROM lines ORDER BY 1;
