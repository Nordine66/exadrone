-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Solar panels in the dashboard "Toitures" tab: the same photo analysis now
-- also rates the PV panels (presence, area, soiling), ground-mounted solar
-- farms are scanned too, and a roof can be pitched for its roof or its panels.
alter table roof_leads add column if not exists kind text not null default 'batiment';
alter table roof_leads add column if not exists solar boolean;
alter table roof_leads add column if not exists solar_area_m2 integer;
alter table roof_leads add column if not exists solar_score integer;
alter table roof_leads add column if not exists solar_priority text;
alter table roof_leads add column if not exists solar_diagnostic text;
alter table roof_leads add column if not exists screen_solar boolean;
alter table roof_leads add column if not exists screen_solar_score integer;
alter table roof_leads add column if not exists prospect_offer text;
create index if not exists idx_roof_leads_solar on roof_leads(solar_score desc nulls last);
