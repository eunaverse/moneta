-- Publish per-user finance state changes to authenticated Realtime subscribers.
-- Existing RLS policies continue to restrict each client to its own row.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'finance_states'
  ) then
    alter publication supabase_realtime add table public.finance_states;
  end if;
end
$$;
