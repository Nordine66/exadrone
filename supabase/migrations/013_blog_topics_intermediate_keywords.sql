-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- « Intermediate » keywords for Marco: searches made by future clients who are
-- not looking for a drone yet (perche, nacelle, cordiste, mousse, tuiles
-- noircies, panneaux sales…). Marco writes them neutrally and brings the
-- drone in the second half (rule in api/agents/tasks.js).
--
-- Priority: Marco takes the oldest pending topic first (order by created_at),
-- so these are dated in the past to go before everything already queued,
-- in the order below. His rhythm (one article a week) does not change.

insert into blog_topics (topic, target_keyword, status, created_at) values
('Perche télescopique de nettoyage : jusqu''où peut-on aller pour une toiture ou une façade ?', 'perche télescopique nettoyage', 'pending', '2020-01-01 00:00:01+00'),
('Lance perche à eau pure : avantages et limites pour le nettoyage en hauteur', 'lance perche nettoyage', 'pending', '2020-01-01 00:00:02+00'),
('Location de nacelle pour nettoyer une façade : coûts cachés et alternatives', 'location nacelle nettoyage façade', 'pending', '2020-01-01 00:00:03+00'),
('Cordiste pour nettoyage de façade : quand y faire appel et à quel prix', 'cordiste nettoyage façade', 'pending', '2020-01-01 00:00:04+00'),
('Traitement anti-mousse de toiture : quand et comment l''appliquer', 'traitement anti-mousse toiture', 'pending', '2020-01-01 00:00:05+00'),
('Tuiles noircies : causes, risques et solutions de nettoyage', 'tuiles noircies', 'pending', '2020-01-01 00:00:06+00'),
('Lichen sur la toiture : pourquoi il faut l''enlever et comment', 'lichen toiture', 'pending', '2020-01-01 00:00:07+00'),
('Nettoyer une toiture sans monter dessus : les méthodes possibles', 'nettoyer toiture sans monter dessus', 'pending', '2020-01-01 00:00:08+00'),
('Nettoyeur haute pression sur une toiture : bonne ou mauvaise idée ?', 'nettoyeur haute pression toiture', 'pending', '2020-01-01 00:00:09+00'),
('Hydrofuge de toiture : utilité, durée et prix au m²', 'hydrofuge toiture prix m2', 'pending', '2020-01-01 00:00:10+00'),
('Façade noircie ou verdie : causes et solutions de nettoyage', 'façade noircie nettoyage', 'pending', '2020-01-01 00:00:11+00'),
('Hydrogommage ou nettoyage basse pression : que choisir pour une façade ?', 'hydrogommage façade', 'pending', '2020-01-01 00:00:12+00'),
('Nettoyage de bardage métallique : méthode, fréquence et prix', 'nettoyage bardage métallique', 'pending', '2020-01-01 00:00:13+00'),
('Nettoyage de gouttières et chéneaux en hauteur : comment faire en sécurité', 'nettoyage chéneaux hauteur', 'pending', '2020-01-01 00:00:14+00'),
('Nettoyer des panneaux solaires soi-même : risques et bonnes pratiques', 'nettoyer panneaux solaires soi-même', 'pending', '2020-01-01 00:00:15+00'),
('Eau osmosée pour panneaux solaires : pourquoi elle est indispensable', 'eau osmosée panneaux solaires', 'pending', '2020-01-01 00:00:16+00'),
('Robot ou nettoyage manuel des panneaux solaires : comparatif', 'robot nettoyage panneaux solaires', 'pending', '2020-01-01 00:00:17+00'),
('Entretien des ombrières photovoltaïques de parking', 'entretien ombrière photovoltaïque', 'pending', '2020-01-01 00:00:18+00'),
('Travail en hauteur et nettoyage : ce que dit la réglementation pour les donneurs d''ordre', 'travail en hauteur nettoyage réglementation', 'pending', '2020-01-01 00:00:19+00'),
('Entretien de la toiture d''un gymnase ou d''une école : planning et budget pour une mairie', 'entretien toiture gymnase', 'pending', '2020-01-01 00:00:20+00');
