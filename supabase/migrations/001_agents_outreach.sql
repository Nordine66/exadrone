-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Adds the schema needed for the 4-agent dashboard (Victoria, Marco, Chloé, Hugo).

-- ── Agents registry (drives the dashboard cards) ──────────────────────────────
create table if not exists agents (
  slug text primary key,
  name text not null,
  role text not null,
  status text not null default 'active' check (status in ('active','paused')),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into agents (slug, name, role, config) values
  ('victoria', 'Victoria', 'Chat commercial — visiteurs du site', '{}'::jsonb),
  ('marco', 'Marco', 'Rédaction blog SEO', '{}'::jsonb),
  ('chloe', 'Chloé', 'Prospection B2B à froid', '{"daily_limit": 25}'::jsonb),
  ('hugo', 'Hugo', 'Relances automatiques', '{"followup_delay_days": 4}'::jsonb)
on conflict (slug) do nothing;

-- ── Prospects (Chloé's CSV imports) ───────────────────────────────────────────
create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text,
  email text not null unique,
  industry text,
  website text,
  status text not null default 'pending'
    check (status in ('pending','contacted','followup1_sent','followup2_sent','replied','unsubscribed','bounced')),
  csv_batch text,
  created_at timestamptz not null default now()
);
create index if not exists idx_prospects_status on prospects(status);

-- ── Outreach send log (Chloé + Hugo) ───────────────────────────────────────────
create table if not exists outreach_emails (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  agent_slug text not null,
  sequence_step int not null default 0,
  subject text,
  body_html text,
  resend_message_id text,
  email_message_id text, -- our own RFC822 Message-ID header, used to thread Hugo's follow-ups
  status text not null default 'sent' check (status in ('sent','bounced','failed')),
  sent_at timestamptz not null default now()
);
create index if not exists idx_outreach_prospect on outreach_emails(prospect_id, sent_at desc);

-- ── Permanent unsubscribe list ─────────────────────────────────────────────────
create table if not exists unsubscribes (
  email text primary key,
  unsubscribed_at timestamptz not null default now()
);

-- ── Inbound reply log (from the Resend inbound webhook) ────────────────────────
create table if not exists email_replies (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references prospects(id) on delete set null,
  from_email text,
  subject text,
  snippet text,
  received_at timestamptz not null default now(),
  raw jsonb
);

-- ── Per-agent dashboard chat history ────────────────────────────────────────────
create table if not exists agent_conversations (
  id uuid primary key default gen_random_uuid(),
  agent_slug text not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_conv_slug on agent_conversations(agent_slug, created_at);

-- ── Global settings singleton (pause-all, test-mode) ───────────────────────────
create table if not exists settings (
  id boolean primary key default true,
  paused_all boolean not null default false,
  test_mode boolean not null default true,
  constraint settings_singleton check (id = true)
);
insert into settings (id) values (true) on conflict (id) do nothing;

-- ── Reuse the existing leads table for contact-form submissions ───────────────
alter table leads add column if not exists organization_type text;
