-- Inbound message deduplication.
-- Messaging providers (including WhatsApp) may deliver the same message more than once.
-- Each provider message id is recorded once; a repeat delivery is detected and ignored.

create table public.processed_messages (
  provider_message_id  text primary key check (length(provider_message_id) between 1 and 255),
  user_id              uuid references public.users (id) on delete cascade,
  received_at          timestamptz not null default now()
);

-- Supports periodic cleanup of old rows (dedup only matters for recent deliveries).
create index processed_messages_received_idx on public.processed_messages (received_at);

alter table public.processed_messages enable row level security;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on table public.processed_messages from %I', api_role);
    end if;
  end loop;
end;
$$;
