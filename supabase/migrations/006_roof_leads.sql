-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- 1. Roofs found and analysed from the dashboard "Toitures" tab (lib/roofs.js).
-- 2. prospects.context: what Chloé should mention in her first email (e.g. the
--    aerial diagnosis of a roof sent from the "Toitures" tab).

-- ── 1. Roof leads ───────────────────────────────────────────────────────────────
create table if not exists roof_leads (
  id uuid primary key default gen_random_uuid(),
  osm_id text not null unique,          -- OpenStreetMap building, e.g. way/81686295
  name text,
  usage text,
  area_m2 integer,
  lat double precision not null,
  lon double precision not null,
  rings jsonb not null,                 -- building outline(s) [[lon,lat],…]
  address text,
  commune text,
  parcels jsonb not null default '[]'::jsonb,
  owners jsonb not null default '[]'::jsonb,     -- DGFiP owners (personnes morales) + company details
  occupants jsonb not null default '[]'::jsonb,  -- companies registered at the building
  score integer,                        -- dirt score 1-10 (IGN orthophoto + Claude)
  lichen boolean,
  roof_type text,
  priority text check (priority in ('HAUTE','MOYENNE','BASSE')),
  diagnostic text,
  model text,
  analyzed_at timestamptz,
  status text not null default 'nouveau'
    check (status in ('nouveau','a_contacter','contacte','rdv','devis','gagne','perdu','ignore')),
  notes text,
  contact_company text,
  contact_name text,
  contact_email text,
  contact_phone text,
  prospect_id uuid references prospects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_roof_leads_score on roof_leads(score desc nulls last);
create index if not exists idx_roof_leads_status on roof_leads(status);

-- ── 2. Context line for Chloé ───────────────────────────────────────────────────
alter table prospects add column if not exists context text;
