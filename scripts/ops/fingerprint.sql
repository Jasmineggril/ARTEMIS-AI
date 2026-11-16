-- Data fingerprint used to prove a migration preserved every row and value.
-- Timestamps compared as UTC epoch; floats rounded to 6 decimals (float4 -> float8 widening).
select 'users', count(*), md5(string_agg(id||':'||extract(epoch from created_at)::bigint, ',' order by id)) from users
union all select 'organizations', count(*), md5(string_agg(id||':'||name, ',' order by id)) from organizations
union all select 'monitored_areas', count(*), md5(string_agg(id||':'||coalesce(round(latitude::numeric,4)::text,'-')||':'||coalesce(round(longitude::numeric,4)::text,'-')||':'||extract(epoch from created_at)::bigint, ',' order by id)) from monitored_areas
union all select 'risk_analyses', count(*), md5(string_agg(id||':'||score||':'||level||':'||coalesce(area_id::text,'-')||':'||extract(epoch from created_at)::bigint, ',' order by id)) from risk_analyses
union all select 'alerts', count(*), md5(string_agg(id||':'||status||':'||extract(epoch from created_at)::bigint, ',' order by id)) from alerts
union all select 'alert_events', count(*), md5(string_agg(id::text, ',' order by id)) from alert_events
union all select 'import_batches', count(*), md5(string_agg(id||':'||total_rows||':'||visibility, ',' order by id)) from import_batches
union all select 'fire_occurrences', count(*), md5(string_agg(id||':'||coalesce(occurrence_date,'-')||':'||coalesce(round(latitude::numeric,4)::text,'-'), ',' order by id)) from fire_occurrences
union all select 'audit_logs', count(*), md5(string_agg(id||':'||action||':'||extract(epoch from created_at)::bigint, ',' order by id)) from audit_logs
union all select 'organization_members', count(*), md5(string_agg(id||':'||role, ',' order by id)) from organization_members
order by 1;
