-- 20 new topics for Marco (blog-writer agent), queued behind whatever is
-- already `pending` in blog_topics (the weekly cron picks the oldest pending
-- row first via `order by created_at asc`, so these just need created_at to
-- default to now() — no manual ordering needed).
--
-- Chosen from the 2026-09-26 SEO audit's "keyword families with no page" gap:
-- 2 broad head-terms (the site only ever targeted the "... drone" long-tail,
-- never the generic term itself — e.g. "nettoyage toiture" pulls 9 900
-- searches/mo vs 1 000 for "nettoyage toiture drone"), 8 purchase-intent /
-- commercial queries (the highest-CPC, zero-coverage segment — "devis
-- nettoyage toiture" 13,51€/clic, "entreprise démoussage toiture" 11,31€,
-- "devis nettoyage façade" 10,70€), 1 gap on an already-priced service with
-- zero content (vitrage en hauteur), and 9 underserved sector/trust topics.
-- Run this once in the Supabase SQL editor against the production project.

insert into blog_topics (topic, target_keyword, status) values
('Nettoyage de toiture professionnel : ce qu''il faut savoir avant de choisir un prestataire', 'nettoyage toiture', 'pending'),
('Nettoyage de façade professionnel : méthodes, prix et choix du bon prestataire', 'nettoyage façade', 'pending'),
('Devis nettoyage toiture : comment obtenir une estimation fiable pour un bâtiment professionnel', 'devis nettoyage toiture', 'pending'),
('Devis nettoyage façade : les éléments qui font varier le prix pour les professionnels', 'devis nettoyage façade', 'pending'),
('Entreprise de démoussage de toiture : comment choisir un prestataire pour un patrimoine bâti important', 'entreprise démoussage toiture', 'pending'),
('Devis démoussage toiture pour collectivités : ce que doit contenir une proposition sérieuse', 'devis démoussage toiture', 'pending'),
('Entreprise de nettoyage de façade pour professionnels : critères de sélection et certifications', 'entreprise nettoyage façade', 'pending'),
('Tarif nettoyage façade au m² : comprendre la grille de prix d''un prestataire professionnel', 'tarif nettoyage façade', 'pending'),
('Devis nettoyage panneaux solaires : comment estimer le coût pour une toiture ou une centrale', 'devis nettoyage panneaux solaires', 'pending'),
('Prix démoussage toiture au m² : la grille tarifaire pour un bâtiment professionnel ou communal', 'prix démoussage toiture m2', 'pending'),
('Nettoyage de vitrages en hauteur par drone : une alternative à la nacelle pour les immeubles tertiaires', 'nettoyage vitrage hauteur drone', 'pending'),
('Nettoyage et entretien par drone des écoles et gymnases municipaux', 'nettoyage drone école gymnase municipal', 'pending'),
('Drone pour la maintenance des entrepôts et plateformes logistiques', 'maintenance drone entrepôt logistique', 'pending'),
('Nettoyage de façade et toiture par drone pour EHPAD et établissements de santé', 'nettoyage drone EHPAD établissement santé', 'pending'),
('Drone et infrastructures portuaires : nettoyage et inspection des ouvrages en zone maritime', 'drone nettoyage inspection port maritime', 'pending'),
('Inspection de château d''eau et d''ouvrages hydrauliques par drone', 'inspection château d''eau drone', 'pending'),
('Nettoyage de parkings silos et ouvrages en béton par drone', 'nettoyage drone parking silo béton', 'pending'),
('Certification et réglementation drone en France : ce qu''un maître d''ouvrage doit vérifier avant de choisir un prestataire', 'certification drone DGAC prestataire', 'pending'),
('Assurance et responsabilité civile professionnelle drone : ce que doit couvrir votre prestataire', 'assurance responsabilité civile drone professionnel', 'pending'),
('Thermographie de façade par drone : détecter les déperditions thermiques avant travaux de rénovation énergétique', 'thermographie façade drone rénovation énergétique', 'pending');
