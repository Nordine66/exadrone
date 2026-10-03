-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Contact search for the dashboard "Toitures" tab: website and published email
-- of the company to pitch, found by Claude (web search) and re-checked on the page.
alter table roof_leads add column if not exists website text;
alter table roof_leads add column if not exists contact_search jsonb;
alter table roof_leads add column if not exists contact_searched_at timestamptz;
