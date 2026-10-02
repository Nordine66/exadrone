// Reference devis (the Seysses salle polyvalente + boulodrome quote, October 2026)
// expressed in the data model rendered by admin/devis-template.js. It is the
// few-shot example the dashboard "Devis" AI follows, so every generated devis
// keeps the same structure, tone and level of detail as the four hand-made ones.
// Figures (photos / Google Earth captures) are left out: they are uploaded in
// the dashboard, never generated.

module.exports = {
  number: 'EXA-2026-1002-SEY',
  date: '2026-10-02',
  validityDays: 90,
  client: {
    name: 'Commune de Seysses',
    attention: "À l'attention de Monsieur le Maire",
    address: ['Mairie — 10 place de la Libération', '31600 Seysses'],
    site: "Lieux d'intervention : Salle polyvalente — 2 allée Marcel Pagnol (Service des sports) · Boulodrome de La Bourdette — Parc de la Bourdette, 31600 Seysses"
  },
  objet: {
    title: 'Nettoyage complet par drone — toitures et façades de la Salle polyvalente et du Boulodrome de La Bourdette',
    sub: '2 bâtiments communaux traités en une seule intervention · personne ne monte sur les toitures · sans échafaudage ni nacelle · produits Guard Industrie® fabriqués en France'
  },
  kpis: [
    { v: '5,90 € HT/m²', k: 'Nettoyage des toitures (1 152 m² mesurés)' },
    { v: '6,90 € HT/m²', k: 'Nettoyage des façades (≈ 865 m²)' },
    { v: '−3 155 €', k: 'Remise « Collectivité » 2 bâtiments (≈ 24 %)' },
    { v: '9 900 € HT', k: 'Prix global tout compris, remise déduite (11 880 € TTC)' }
  ],
  garantie: {
    objet: 'les toitures et les façades des deux bâtiments',
    OBJ: 'TOITURES ET FAÇADES PROPRES',
    mairie: 'Seysses',
    limites: "tuiles fêlées, cassées ou poreuses, fissures d'enduit (dont la fissure en tête de mur de la salle polyvalente), enduits farinants ou décollés, différences de teinte d'origine entre soubassement et façade, taches de rouille, graffitis, peintures, ainsi que toute salissure nouvelle survenue après la réception."
  },
  highlight: null,
  why: {
    title: 'Pourquoi le drone sur ces deux équipements',
    items: [
      '<strong>Personne ne marche sur les toitures</strong> : aucune tuile cassée ni déplacée, aucun risque d\'infiltration créé par le chantier.',
      '<strong>Aucun échafaudage, aucune nacelle</strong> : pas de montage autour du gymnase de 7 à 8 m de hauteur, pas d\'emprise prolongée sur les parkings et cheminements.',
      '<strong>Sécurité des usagers</strong> : aucun travail en hauteur, seul un périmètre temporaire est balisé.',
      '<strong>Équipements disponibles</strong> : intervention en dehors des créneaux d\'utilisation, sans fermeture prolongée.',
      '<strong>Basse pression adaptée</strong> aux tuiles, aux enduits et aux panneaux translucides : on nettoie sans user les supports.',
      '<strong>Deux bâtiments, une seule intervention</strong> : une installation, un déplacement — d\'où la remise accordée à la Commune.'
    ]
  },
  etatDesLieux: [
    {
      title: 'Bâtiment A — Salle polyvalente / Service des sports',
      items: [
        'Toiture <strong>820 m²</strong> (mesure Google Earth) en tuiles terre cuite à faible pente : encrassement généralisé, lichens et dépôts sombres.',
        'Façades en enduit beige, hauteur ≈ 7 à 8 m : salissures atmosphériques, coulures sous les égouts et descentes ; soubassement de teinte différente.',
        'Grands châssis en panneaux translucides : nettoyés à pression réduite, sans projection directe.',
        '<strong>Fissure horizontale en tête de mur</strong> visible sur plusieurs façades : signalée à la Commune, travail à pression réduite à proximité, hors champ de la prestation.',
        'Équipements à protéger : unité extérieure de climatisation, boîtiers électriques, éclairages, panneaux d\'affichage, conteneur de tri, rideau métallique.'
      ]
    },
    {
      title: 'Bâtiment B — Boulodrome de La Bourdette',
      items: [
        'Toiture <strong>332 m²</strong> (mesure Google Earth, annexe comprise) en tuiles canal, sous de grands chênes : feuilles, mousses et lichens favorisés par l\'ombre et l\'humidité.',
        'Façades en enduit rosé : <strong>traces verdâtres et noires de micro-organismes</strong> sur le pignon, coulures sous les appuis de fenêtres.',
        'Éléments décoratifs à préserver : encadrements en briques et lettrage « Boulodrome La Bourdette ».',
        'Terrain de pétanque et cheminements attenants protégés des eaux de ruissellement.'
      ]
    }
  ],
  etatDesLieuxNote: 'Surfaces de toiture mesurées sur Google Earth ; surfaces de façade calculées à partir du périmètre mesuré et de la hauteur relevée sur site (Salle polyvalente ≈ 650 m², Boulodrome ≈ 215 m², hors baies).',
  figures: [],
  lots: [
    {
      title: 'Lot 0 — Préparation, sécurité & installation de chantier (2 sites)',
      lines: [
        { d: 'Visite technique, métrés & diagnostic des deux bâtiments', x: 'Inspection aérienne par drone et relevé photographique des toitures et façades ; métrés contradictoires ; repérage des tuiles fêlées ou cassées et des fissures (signalées à la Commune avant travaux) ; réalisation d\'une <strong>zone témoin</strong> par type de support (tuile, enduit) validée par la Commune.', unit: 'Forfait', qty: 1, pu: 0, mode: 'offert' },
        { d: 'Préparation réglementaire des vols', x: 'Analyse de l\'espace aérien, déclaration d\'opération en catégorie spécifique (scénario standard européen) auprès de la DGAC, plan de vol et étude de sécurité propres à chaque site.', unit: 'Forfait', qty: 1, pu: 0, mode: 'offert' },
        { d: 'Installation de chantier, balisage & protections — 2 sites', x: 'Balisage des périmètres de sécurité ; filtres en tête des descentes d\'eaux pluviales ; protection des équipements (climatisation, boîtiers électriques, éclairages, affichages, menuiseries, panneaux translucides) ; protection du terrain de pétanque attenant au boulodrome.', unit: 'Forfait', qty: 1, pu: 290, mode: 'price' }
      ]
    },
    {
      title: 'Lot 1 — Bâtiment A : Salle polyvalente / Service des sports',
      lines: [
        { d: 'Nettoyage & démoussage de la toiture par drone — pré-traitement Stop\'Alg® Guard inclus', x: '<strong>a)</strong> Pulvérisation par drone sur couverture sèche du traitement biosourcé Stop\'Alg® Guard (1 L / 10 m²) qui décolle et détruit mousses, lichens et dépôts verts. <strong>b)</strong> Lavage intégral à l\'eau claire, basse pression calibrée sur la zone témoin, du faîtage vers l\'égout dans le sens de la pose ; rinçage des faîtages, arêtiers et rives.', unit: 'm²', qty: 820, pu: 5.9, mode: 'price' },
        { d: 'Nettoyage des façades par drone — pré-traitement Stop\'Alg® Guard inclus', x: 'Pré-traitement des salissures biologiques puis lavage des façades enduites à l\'eau claire, basse pression, de haut en bas par bandes successives ; élimination des coulures, salissures atmosphériques et dépôts ; pression réduite sur les panneaux translucides et à proximité de la fissure en tête de mur. Surface estimée hors baies.', unit: 'm²', qty: 650, pu: 6.9, mode: 'price' }
      ]
    },
    {
      title: 'Lot 2 — Bâtiment B : Boulodrome de La Bourdette',
      lines: [
        { d: 'Nettoyage & démoussage de la toiture par drone — pré-traitement Stop\'Alg® Guard inclus', x: 'Toiture en tuiles canal et annexe attenante : pré-traitement biosourcé, lavage basse pression dans le sens de la pose, évacuation des feuilles et débris accumulés sous les chênes.', unit: 'm²', qty: 332, pu: 5.9, mode: 'price' },
        { d: 'Nettoyage des façades par drone — pré-traitement Stop\'Alg® Guard inclus', x: 'Traitement ciblé des traces vertes et noires du pignon, puis lavage basse pression de l\'ensemble des façades enduites ; préservation des encadrements en briques et du lettrage.', unit: 'm²', qty: 215, pu: 6.9, mode: 'price' }
      ]
    },
    {
      title: 'Lot 3 — Finitions, réception & garanties (2 bâtiments)',
      lines: [
        { d: 'Nettoyage des gouttières, chéneaux & descentes d\'eaux pluviales', x: 'Évacuation des mousses, feuilles et débris, rinçage, retrait des filtres et contrôle de l\'écoulement de chaque descente.', unit: 'Forfait', qty: 1, pu: 0, mode: 'inclus' },
        { d: 'Repli, nettoyage des abords & dossier de fin de chantier', x: 'Ramassage des débris tombés au sol, évacuation des déchets en filière agréée ; rapport photographique avant / après, relevé des désordres constatés (tuiles, fissures), FT et FDS du produit, conseils d\'entretien.', unit: 'Forfait', qty: 1, pu: 0, mode: 'inclus' },
        { d: 'Réception contradictoire & GARANTIE DE RÉSULTAT', x: 'Constat avec les services techniques sur la base de vues aériennes avant / après ; toute zone en deçà de la zone témoin est <strong>reprise autant de fois que nécessaire, sans aucune facturation complémentaire</strong>, jusqu\'à validation écrite par la Commune.', unit: 'Forfait', qty: 1, pu: 0, mode: 'offert' }
      ]
    }
  ],
  remise: { label: 'Remise commerciale « Collectivité » — 2 bâtiments traités en une seule intervention (≈ 24 %)', amountHT: 3155.3 },
  tvaRate: 20,
  totalsNote: 'Toitures à 5,90 € HT/m², façades à 6,90 € HT/m², produit inclus.',
  methodo: {
    rows: [
      { step: 'En amont', content: 'Visite technique et métrés, zones témoins, préparation réglementaire des vols, calage des dates avec les services techniques et le Service des sports (hors créneaux d\'utilisation).', duration: '1 demi-journée' },
      { step: 'Jour 1', content: '<strong>Salle polyvalente :</strong> balisage et protections, pré-traitement Stop\'Alg® de la toiture et des façades, nettoyage basse pression de la toiture puis des façades, gouttières et descentes.', duration: '1 journée' },
      { step: 'Jour 2', content: '<strong>Boulodrome de La Bourdette :</strong> mêmes opérations sur la toiture, l\'annexe et les façades ; repli et nettoyage des abords des deux sites ; réception contradictoire.', duration: '1 journée' },
      { step: 'Si besoin', content: '<strong>Reprises au titre de la garantie de résultat</strong> sur les zones signalées, autant que nécessaire et sans surcoût, jusqu\'à validation écrite de la Commune.', duration: 'Jusqu\'à validation' }
    ],
    note: 'Le dossier de fin de chantier (photos avant / après, relevé des désordres, FT, FDS, conseils d\'entretien) est remis sous 15 jours.'
  },
  conditions: {
    comprend: [
      'La main-d\'œuvre de télépilotes certifiés et l\'ensemble du matériel (drones, pompe, réserves, consommables).',
      'Le produit Guard Industrie® nécessaire, en quantité suffisante.',
      'Le nettoyage des gouttières et descentes, les reprises de la garantie de résultat, le dossier de fin de chantier.',
      'Les déplacements et frais de transport de l\'équipe.'
    ],
    prix: 'Prix global, ferme et non révisable pendant la validité de l\'offre. Surfaces confirmées lors de la visite technique ; <strong>le montant ne pourra pas dépasser le total indiqué</strong> sans avenant accepté par la Commune.',
    nonCompris: 'remplacement de tuiles, reprise de fissures ou d\'enduits, travaux de peinture.',
    chargeCommune: [
      'Un point d\'eau et une prise électrique 230 V à proximité de chaque bâtiment.',
      'L\'accès aux sites et, le cas échéant, la neutralisation temporaire des places de stationnement au pied des façades.',
      'L\'information des usagers et associations sur les dates d\'intervention.',
      'Un interlocuteur des services techniques pour la réception.'
    ],
    meteo: 'Vols réalisés uniquement par vent modéré, sur supports secs, sans pluie annoncée dans les 24 h suivant la pulvérisation. Un report pour raison météo n\'entraîne <strong>aucun frais</strong> pour la Commune.'
  },
  products: ['stopalg']
}
