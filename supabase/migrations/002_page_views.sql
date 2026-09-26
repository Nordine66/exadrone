-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Adds self-hosted, consent-gated pageview tracking (see api/track.js and the
-- "Visiteurs" tab in the admin dashboard). No third party involved, no IP stored —
-- only what's needed to answer "who's on the site and what are they looking at".

create table if not exists page_views (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  referrer text,
  visitor_id text,   -- pseudonymous id, localStorage, only set once analytics consent is given
  session_id text,   -- per-tab session id, sessionStorage
  device_type text check (device_type in ('mobile','tablet','desktop')),
  country text,      -- derived from Vercel's geo headers, no IP is persisted
  created_at timestamptz not null default now()
);
create index if not exists idx_page_views_created on page_views(created_at desc);
create index if not exists idx_page_views_path on page_views(path);
