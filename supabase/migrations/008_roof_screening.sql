-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Quick AI screening of every big roof of a town (dashboard "Toitures" tab,
-- "Scanner toute la ville"): roofs are rated 9 at a time on a photo grid, and
-- only the dirty ones get the detailed analysis. Screened-only rows have
-- analyzed_at = null and are hidden from "Mes toitures".
alter table roof_leads add column if not exists screen_score integer;
alter table roof_leads add column if not exists screen_lichen boolean;
alter table roof_leads add column if not exists screened_at timestamptz;
create index if not exists idx_roof_leads_screen on roof_leads(screen_score desc nulls last);
