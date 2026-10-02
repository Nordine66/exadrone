-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- 1. Shared activity journal so every agent knows what happened on the site
--    (sends, relances, replies, articles, devis, Nordine's dashboard actions).
-- 2. Custom devis generated from the dashboard "Devis" tab.
-- 3. Database-level guard against sending the same email twice to a prospect.

-- ── 1. Activity journal ─────────────────────────────────────────────────────────
create table if not exists agent_activity (
  id uuid primary key default gen_random_uuid(),
  agent_slug text,            -- victoria / marco / chloe / hugo / null for site/admin events
  kind text not null,         -- e.g. outreach_batch, followup_run, reply_received, quote_saved
  summary text not null,      -- one human-readable line, injected into the agents' context
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_activity_created on agent_activity(created_at desc);
create index if not exists idx_agent_activity_slug on agent_activity(agent_slug, created_at desc);

-- ── 2. Custom devis (dashboard "Devis" tab) ─────────────────────────────────────
create table if not exists custom_quotes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  client text,
  title text,
  data jsonb not null,        -- full devis model rendered by admin/devis-template.js
  total_ht numeric(12,2),
  total_ttc numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_custom_quotes_updated on custom_quotes(updated_at desc);

-- ── 3. Duplicate-send guard ─────────────────────────────────────────────────────
-- Records which address an email actually went to (the prospect row can change).
alter table outreach_emails add column if not exists recipient_email text;

-- One successfully sent email per prospect and per sequence step. Created only if
-- the existing history is clean — otherwise it would fail on the past duplicates;
-- the application-level guards in api/agents/tasks.js protect in both cases.
do $$
begin
  if not exists (
    select 1 from outreach_emails where status = 'sent'
    group by prospect_id, sequence_step having count(*) > 1
  ) then
    create unique index if not exists uniq_outreach_sent_step
      on outreach_emails(prospect_id, sequence_step) where status = 'sent';
  else
    raise notice 'Doublons déjà présents dans outreach_emails : index unique non créé (les garde-fous applicatifs restent actifs).';
  end if;
end $$;

-- Same address imported twice with different case/spaces would bypass the
-- existing unique(email); enforce it case-insensitively when history allows.
do $$
begin
  if not exists (
    select 1 from prospects group by lower(trim(email)) having count(*) > 1
  ) then
    create unique index if not exists uniq_prospects_email_ci on prospects (lower(trim(email)));
  else
    raise notice 'Adresses en double (casse/espaces) dans prospects : index non créé.';
  end if;
end $$;
