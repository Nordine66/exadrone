-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Instruction written by Nordine in the « Envoi manuel » tab: Chloé follows it
-- when she writes the first email to this prospect.
alter table prospects add column if not exists chloe_note text;
