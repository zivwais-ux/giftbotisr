-- GiftBot initial schema.
--
-- Access model: only the backend (service role / direct Postgres connection) reads and writes.
-- Row Level Security is enabled on every table with NO policies, so Supabase's public API roles
-- (anon, authenticated) can't read or write anything, even if a key leaks to a client.
--
-- Enumerations use CHECK constraints rather than Postgres ENUM types: they are easier to evolve
-- in later migrations. Allowed values must stay in sync with src/domain/types.ts.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- stores: where products come from, and whether we're allowed to use them
-- ---------------------------------------------------------------------------

create table public.stores (
  id                              uuid primary key default gen_random_uuid(),
  slug                            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name                            text not null check (length(trim(name)) > 0),
  country                         char(2) not null check (country ~ '^[A-Z]{2}$'),
  default_currency                text not null check (default_currency in ('ILS', 'USD', 'EUR', 'GBP')),
  website_url                     text check (website_url like 'https://%'),
  data_source                     text not null check (length(trim(data_source)) > 0),
  -- Only 'approved' stores feed recommendations. Approval means affiliate/data terms were reviewed.
  approval_status                 text not null default 'pending'
                                    check (approval_status in ('pending', 'approved', 'rejected', 'suspended')),
  -- Terms review results. NULL = not yet checked (treated as "not allowed" by the app).
  allows_messaging_links          boolean,
  allows_product_images           boolean,
  requires_affiliate_disclosure   boolean,
  terms_url                       text check (terms_url like 'https://%'),
  terms_notes                     text,
  terms_reviewed_at               timestamptz,
  is_sample                       boolean not null default false,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  -- Approval requires a recorded terms review that confirmed links may be sent over messaging apps.
  constraint approved_store_terms_checked check (
    approval_status <> 'approved' or (terms_reviewed_at is not null and allows_messaging_links is true)
  )
);

create trigger stores_set_updated_at
  before update on public.stores
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

create table public.products (
  id                          uuid primary key default gen_random_uuid(),
  store_id                    uuid not null references public.stores (id) on delete restrict,
  -- The product's id in the source feed/API; used for idempotent imports.
  external_id                 text not null check (length(external_id) > 0),
  name                        text not null check (length(trim(name)) > 0),
  description                 text not null default '',
  price_amount                numeric(12, 2) not null check (price_amount > 0),
  price_currency              text not null check (price_currency in ('ILS', 'USD', 'EUR', 'GBP')),
  image_url                   text check (image_url like 'https://%'),
  product_url                 text not null check (product_url like 'https://%'),
  affiliate_url               text check (affiliate_url like 'https://%'),
  -- Reporting only. Must never be used for ranking.
  affiliate_commission_rate   numeric(5, 4) check (affiliate_commission_rate between 0 and 1),
  availability                text not null check (availability in ('in_stock', 'out_of_stock', 'unknown')),
  -- Countries the product ships to; empty = unknown.
  ships_to                    char(2)[] not null default '{}',
  delivery_min_days           integer check (delivery_min_days >= 0),
  delivery_max_days           integer check (delivery_max_days >= 0),
  last_verified_at            timestamptz not null,
  data_source                 text not null check (length(trim(data_source)) > 0),
  is_sample                   boolean not null default false,
  -- Soft delete: inactive products are kept so past recommendations stay auditable.
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint products_store_external_unique unique (store_id, external_id),
  constraint products_delivery_range check (
    delivery_min_days is null or delivery_max_days is null or delivery_min_days <= delivery_max_days
  )
);

create index products_store_idx on public.products (store_id);
create index products_active_idx on public.products (is_active) where is_active;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- product_attributes: categories, interests, occasions, recipients
-- ---------------------------------------------------------------------------

create table public.product_attributes (
  product_id  uuid not null references public.products (id) on delete cascade,
  kind        text not null check (kind in ('category', 'interest', 'occasion', 'recipient')),
  -- Normalized (lowercase, trimmed). 'any' is allowed for occasion/recipient.
  value       text not null check (value = lower(trim(value)) and length(value) between 1 and 60),
  -- Order within the kind; position 0 of 'category' is the primary category.
  position    smallint not null default 0 check (position >= 0),
  primary key (product_id, kind, value),
  constraint product_attributes_occasion_values check (
    kind <> 'occasion' or value in (
      'birthday', 'anniversary', 'wedding', 'birth', 'holiday', 'housewarming',
      'graduation', 'thank_you', 'other', 'any'
    )
  ),
  constraint product_attributes_recipient_values check (
    kind <> 'recipient' or value in (
      'partner', 'parent', 'grandparent', 'sibling', 'child', 'teen', 'baby',
      'friend', 'colleague', 'other', 'any'
    )
  )
);

-- "Which products have interest X?" — used for catalog gap analysis and future SQL prefiltering.
create index product_attributes_lookup_idx on public.product_attributes (kind, value);

-- ---------------------------------------------------------------------------
-- users: the minimum needed to reply on WhatsApp
-- ---------------------------------------------------------------------------

create table public.users (
  id              uuid primary key default gen_random_uuid(),
  -- WhatsApp ID (the user's phone number in international format, digits only). Personal data.
  whatsapp_id     text not null unique check (whatsapp_id ~ '^[0-9]{6,20}$'),
  locale          text not null default 'he',
  -- Set when the user asks to stop; the bot must not message them afterwards.
  opted_out_at    timestamptz,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- conversations: where each WhatsApp conversation stands
-- ---------------------------------------------------------------------------

create table public.conversations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  status            text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  -- The next thing the bot needs (e.g. 'ask_recipient', 'ask_budget'); defined by the conversation layer.
  step              text not null default 'start',
  -- Details collected so far (recipient, occasion, budget...), before they form a full request.
  collected         jsonb not null default '{}'::jsonb check (jsonb_typeof(collected) = 'object'),
  last_message_at   timestamptz not null default now(),
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index conversations_user_idx on public.conversations (user_id, last_message_at desc);
-- At most one active conversation per user.
create unique index conversations_one_active_per_user on public.conversations (user_id) where status = 'active';

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- recommendation_sessions: one gift request and the engine run that answered it
-- ---------------------------------------------------------------------------

create table public.recommendation_sessions (
  id                            uuid primary key default gen_random_uuid(),
  conversation_id               uuid references public.conversations (id) on delete set null,
  user_id                       uuid references public.users (id) on delete set null,
  recipient                     text not null check (recipient in (
                                  'partner', 'parent', 'grandparent', 'sibling', 'child', 'teen', 'baby',
                                  'friend', 'colleague', 'other'
                                )),
  occasion                      text not null check (occasion in (
                                  'birthday', 'anniversary', 'wedding', 'birth', 'holiday', 'housewarming',
                                  'graduation', 'thank_you', 'other'
                                )),
  budget_min                    numeric(12, 2) check (budget_min >= 0),
  budget_max                    numeric(12, 2) not null check (budget_max > 0),
  budget_currency               text not null check (budget_currency in ('ILS', 'USD', 'EUR', 'GBP')),
  interests                     text[] not null default '{}',
  avoid                         text[] not null default '{}',
  needed_by                     timestamptz,
  delivery_country              char(2) not null check (delivery_country ~ '^[A-Z]{2}$'),
  allow_international_shipping  boolean not null,
  -- Exactly how results were produced, so they can be reproduced and compared over time.
  engine_version                text not null,
  engine_options                jsonb not null default '{}'::jsonb,
  exchange_rates_as_of          timestamptz,
  evaluated_count               integer not null check (evaluated_count >= 0),
  excluded_count                integer not null check (excluded_count >= 0),
  below_threshold_count         integer not null check (below_threshold_count >= 0),
  -- Count per exclusion reason, e.g. {"over_budget": 12} — reveals catalog gaps.
  exclusion_stats               jsonb not null default '{}'::jsonb,
  result_count                  integer not null check (result_count >= 0),
  created_at                    timestamptz not null default now(),
  constraint recommendation_sessions_budget_range check (budget_min is null or budget_min <= budget_max)
);

create index recommendation_sessions_conversation_idx on public.recommendation_sessions (conversation_id);
create index recommendation_sessions_user_idx on public.recommendation_sessions (user_id, created_at desc);
create index recommendation_sessions_created_idx on public.recommendation_sessions (created_at);

-- ---------------------------------------------------------------------------
-- recommendation_items: what was shown, exactly as shown
-- ---------------------------------------------------------------------------

create table public.recommendation_items (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references public.recommendation_sessions (id) on delete cascade,
  product_id            uuid not null references public.products (id) on delete restrict,
  rank                  smallint not null check (rank >= 1),
  score                 numeric(5, 4) not null check (score between 0 and 1),
  score_components      jsonb not null,
  -- Snapshot of what the user saw; product data may change later.
  shown_price_amount    numeric(12, 2) not null check (shown_price_amount > 0),
  shown_price_currency  text not null check (shown_price_currency in ('ILS', 'USD', 'EUR', 'GBP')),
  matched_interests     text[] not null default '{}',
  warnings              text[] not null default '{}',
  created_at            timestamptz not null default now(),
  constraint recommendation_items_rank_unique unique (session_id, rank),
  constraint recommendation_items_product_unique unique (session_id, product_id)
);

create index recommendation_items_product_idx on public.recommendation_items (product_id);

-- ---------------------------------------------------------------------------
-- analytics_events: funnel measurement
-- ---------------------------------------------------------------------------

create table public.analytics_events (
  id                    bigint generated always as identity primary key,
  event_type            text not null check (event_type in (
                          'conversation_started',
                          'conversation_completed',
                          'conversation_abandoned',
                          'recommendations_shown',
                          'no_results',
                          'link_clicked',
                          'feedback_submitted',
                          'conversion_reported'
                        )),
  user_id               uuid references public.users (id) on delete set null,
  conversation_id       uuid references public.conversations (id) on delete set null,
  session_id            uuid references public.recommendation_sessions (id) on delete set null,
  recommendation_item_id uuid references public.recommendation_items (id) on delete set null,
  -- Event details. Never put personal data (phone numbers, message text) here.
  properties            jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
  occurred_at           timestamptz not null default now()
);

create index analytics_events_type_time_idx on public.analytics_events (event_type, occurred_at);
create index analytics_events_session_idx on public.analytics_events (session_id);
create index analytics_events_item_idx on public.analytics_events (recommendation_item_id);

-- ---------------------------------------------------------------------------
-- Security: deny-by-default for Supabase API roles
-- ---------------------------------------------------------------------------

alter table public.stores                  enable row level security;
alter table public.products                enable row level security;
alter table public.product_attributes      enable row level security;
alter table public.users                   enable row level security;
alter table public.conversations           enable row level security;
alter table public.recommendation_sessions enable row level security;
alter table public.recommendation_items    enable row level security;
alter table public.analytics_events        enable row level security;

-- On Supabase, also revoke direct table privileges from the public API roles (defense in depth).
-- These roles don't exist on plain Postgres, so this is skipped there.
do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on all tables in schema public from %I', api_role);
      execute format('revoke all on all sequences in schema public from %I', api_role);
      execute format('revoke execute on function public.set_updated_at() from %I', api_role);
    end if;
  end loop;
end;
$$;
