-- Moneta v1: one atomic, schema-versioned finance document per authenticated user.
-- Calculations remain in the client; Postgres provides cross-device persistence and isolation.

create table if not exists public.finance_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null default 1 check (schema_version > 0),
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_states_set_updated_at on public.finance_states;
create trigger finance_states_set_updated_at
before update on public.finance_states
for each row execute function public.set_updated_at();

alter table public.finance_states enable row level security;

drop policy if exists "Users read their finance state" on public.finance_states;
create policy "Users read their finance state"
on public.finance_states for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users create their finance state" on public.finance_states;
create policy "Users create their finance state"
on public.finance_states for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their finance state" on public.finance_states;
create policy "Users update their finance state"
on public.finance_states for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete their finance state" on public.finance_states;
create policy "Users delete their finance state"
on public.finance_states for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.finance_states to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read their receipts" on storage.objects;
create policy "Users read their receipts"
on storage.objects for select to authenticated
using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users upload their receipts" on storage.objects;
create policy "Users upload their receipts"
on storage.objects for insert to authenticated
with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users update their receipts" on storage.objects;
create policy "Users update their receipts"
on storage.objects for update to authenticated
using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users delete their receipts" on storage.objects;
create policy "Users delete their receipts"
on storage.objects for delete to authenticated
using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
