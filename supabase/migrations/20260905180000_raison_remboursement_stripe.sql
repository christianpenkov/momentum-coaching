-- Stripe EXIGE un motif de remboursement : autant le lire
--
-- Question de Chris apres son premier remboursement Stripe reel : « tu dois
-- mettre aussi une raison sur stripe qu'on peut recuperer ? ». Oui — la fenetre
-- de remboursement du dashboard rend le motif OBLIGATOIRE (« Doublon »,
-- « Frauduleux », « Demande par le client », « Autre »), donc l'information
-- existe toujours, et Momentum la jetait.
--
-- ── Pourquoi une colonne separee de `refund_reason` ──────────────────────────
--
-- `refund_reason` porte la taxonomie de MOMENTUM, choisie par l'eleve dans
-- l'ecran « Pourquoi ces X EUR sont-ils repartis ? » : geste_commercial,
-- retractation, erreur, autre. Elle repond a « qu'est-ce que ca veut dire pour
-- cette vente ».
--
-- Celle de Stripe repond a autre chose : ce que l'eleve a coche dans un
-- formulaire bancaire. Les deux listes ne se recouvrent pas — « frauduleux »
-- n'a aucun equivalent chez nous, et « doublon » ne dit pas si le client doit
-- encore la somme. Les fusionner obligerait a inventer une correspondance, donc
-- a transformer un fait en supposition. On garde donc les deux, et l'ecran
-- affiche le fait (« Stripe indique : demande par le client ») a cote de la
-- question qu'il pose.
--
-- NULL a deux sens ici, et c'est assume : soit le remboursement n'est pas passe
-- par Stripe, soit l'eleve a choisi « Autre » — que l'API ne transmet pas. Dans
-- les deux cas il n'y a rien a afficher, ce qui suffit a l'usage.
alter table public.deal_payments
  add column if not exists refund_reason_stripe text;

comment on column public.deal_payments.refund_reason_stripe is
  'Le motif saisi dans le DASHBOARD STRIPE au moment du remboursement '
  '(duplicate, fraudulent, requested_by_customer). Constate, jamais demande — a '
  'distinguer de `refund_reason`, qui porte la taxonomie de Momentum choisie par '
  'l''eleve. NULL = remboursement hors Stripe, ou motif « Autre » que l''API ne '
  'transmet pas.';
