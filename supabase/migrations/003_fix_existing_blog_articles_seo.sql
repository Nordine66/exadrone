-- Backfill for the SEO audit run on 2026-09-26 (Organikk):
-- 1) 13/13 published blog_articles had a <title> tag far past 65 characters
--    (the raw generated H1 was reused as the meta <title> with no length cap).
--    This shortens the `title` column only — the on-page <h1> inside
--    content_html is untouched, so the article body doesn't change.
-- 2) 10/13 articles had an empty meta_description (the generation step
--    sometimes skipped the META: line and nothing caught it before insert —
--    see the fallback added in api/blog/content.js and api/agents/tasks.js).
-- Run this once in the Supabase SQL editor against the production project.

update blog_articles set title = 'Photogrammétrie drone : relevé 3D précis de façade',
  meta_description = 'Comment un relevé photogrammétrique par drone produit un modèle 3D précis d''une façade pour fiabiliser vos diagnostics de bâtiment.'
  where slug = 'photogrammetrie-par-drone-comment-obtenir-un-releve-3d-preci';

update blog_articles set title = 'Démoussage toiture par drone : fréquence et ROI',
  meta_description = 'Fréquence recommandée et retour sur investissement du démoussage de toiture par drone pour les bailleurs sociaux et gestionnaires de patrimoine.'
  where slug = 'demoussage-de-toiture-par-drone-frequence-recommandee-et-ret';

update blog_articles set title = 'Nettoyage de façade par drone pour mairies',
  meta_description = 'Cadre réglementaire et avantages du nettoyage de façade par drone pour les mairies et communes : marché public, sécurité, coût maîtrisé.'
  where slug = 'nettoyage-de-facades-pour-les-mairies-et-communes-cadre-regl';

update blog_articles set title = 'Toitures inaccessibles : la solution drone',
  meta_description = 'Pour les toitures inaccessibles ou dangereuses, le drone est la seule solution de nettoyage sans risque pour les équipes au sol.'
  where slug = 'toitures-inaccessibles-le-drone-comme-seule-solution-de-nett';

update blog_articles set title = 'Rénovation BTP : sous-traiter le bardage au drone',
  meta_description = 'Pourquoi les entreprises BTP sous-traitent le nettoyage de bardage à un opérateur drone lors de leurs chantiers de rénovation immobilière.'
  where slug = 'renovation-immobiliere-pourquoi-les-entreprises-btp-sous-tra';

update blog_articles set title = 'Nettoyage de façades commerciales par drone',
  meta_description = 'La solution drone pour nettoyer façades commerciales et vitrines en hauteur, sans nacelle ni fermeture, pour les gérants d''immeubles.'
  where slug = 'nettoyage-de-facades-commerciales-et-vitrines-en-hauteur-la-';

update blog_articles set title = 'Drone et maintenance copropriété : intégrer au contrat'
  where slug = 'drone-nettoyage-maintenance-copropriete-contrat';

update blog_articles set title = 'Nettoyage haute pression par drone : façades',
  meta_description = 'Applications du nettoyage haute pression par drone pour les façades en pierre, béton et bardage métallique, sans échafaudage.'
  where slug = 'nettoyage-haute-pression-par-drone-applications-pour-les-fac';

update blog_articles set title = 'Drone toiture copropriété : alternative à la nacelle'
  where slug = 'drone-nettoyage-toiture-copropriete-nacelle';

update blog_articles set title = 'Nettoyage de façade des bâtiments publics',
  meta_description = 'Pourquoi les collectivités locales choisissent le nettoyage de façade par drone pour leurs bâtiments publics : coût, sécurité, rapidité.'
  where slug = 'nettoyage-de-facades-de-batiments-publics-par-drone-le-choix';

update blog_articles set title = 'Nettoyage de bardage par drone pour le BTP'
  where slug = 'nettoyage-bardage-drone-btp-entreprises';

update blog_articles set title = 'Nettoyage toiture drone : budget maintenance',
  meta_description = 'Comment les gestionnaires d''actifs immobiliers réduisent leur budget maintenance grâce au nettoyage de toiture par drone.'
  where slug = 'nettoyage-de-toiture-par-drone-comment-les-gestionnaires-dac';

update blog_articles set title = 'Façade drone vs échafaudage : coût et délai',
  meta_description = 'Comparatif coût et délai entre nettoyage de façade par drone et échafaudage traditionnel, pour les syndics de copropriété.'
  where slug = 'nettoyage-de-facade-par-drone-vs-echafaudage-comparatif-cout';
