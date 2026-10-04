-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Priority prospects: the ones Nordine imports himself or ticks in the
-- « Envoi manuel » tab (priority = 1) are taken by Chloé before the waiting
-- queue (3 000+ mairies), the roofs picked in the Toitures tab come next, then
-- the queue in import order.
alter table prospects add column if not exists priority smallint not null default 0;
create index if not exists idx_prospects_priority on prospects(status, priority desc, queue_pos);
