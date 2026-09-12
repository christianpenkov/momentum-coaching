-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ « NOUVELLES CONVERSATIONS » : POURQUOI UNE COLONNE STOCKÉE, ET PAS UN      │
-- │ COMPTAGE À LA LECTURE                                                     │
-- │                                                                           │
-- │ `purge_ig_messages()` efface chaque nuit les messages de plus de 30 jours │
-- │ (fil ordinaire) ou de 12 mois (fil de lead), puis supprime les fils       │
-- │ devenus vides. Un `count(*) … where cree_le::date = D` calculé au moment  │
-- │ de la lecture donnerait donc un nombre qui BAISSE avec le temps, sans que │
-- │ rien ne le signale : une semaine de juin afficherait 4 conversations en   │
-- │ juillet et 0 en septembre.                                                │
-- │                                                                           │
-- │ Exactement l'argument qui a fait naître `analytics_ig_periodes` pour la   │
-- │ portée dédupliquée : ce qui ne se reconstitue pas se MESURE puis se       │
-- │ STOCKE. Ici la mesure est locale — aucun appel Meta — mais elle est tout  │
-- │ aussi périssable.                                                         │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- Pourquoi « nouvelles » et pas « actives », et pourquoi une colonne JOURNALIÈRE :
-- un compte de fils DISTINCTS ne s'additionne pas. « Fils actifs cette semaine »
-- n'est pas la somme des « fils actifs chaque jour » — une personne qui écrit lundi
-- ET mardi compterait deux fois. Il aurait donc fallu un stockage par période, et la
-- métrique serait restée indisponible en granularité « jour ».
--
-- « Nouvelles » compte chaque fil UNE fois, le jour de sa première apparition. La
-- somme est donc juste à toutes les granularités, et la courbe cumulée du graphe
-- « depuis l'arrivée » a un sens — c'est un compte de PERSONNES, homogène avec
-- leads, calls bookés et ventes.

alter table public.analytics_daily_snapshots
  add column if not exists ig_conversations_nouvelles integer;

comment on column public.analytics_daily_snapshots.ig_conversations_nouvelles is
  'Fils de DM Instagram apparus CE JOUR-LÀ, comptés une seule fois chacun. Écrit par '
  'poll-leads à chaque passage horaire, pour aujourd''hui ET hier — un fil créé après '
  'le dernier passage de la veille serait sinon perdu pour toujours. '
  'NULL = non mesuré, jamais zéro : un élève qui n''a pas accordé la lecture de ses DM '
  'n''a pas « zéro conversation », il n''a pas de mesure. La colonne n''est donc pas '
  'écrite tant que `clients.ig_dm_lecture_accordee_le` est nul.';

-- Le comptage lit `ig_conversations` par profil sur une fenêtre de deux jours, à
-- chaque passage horaire et pour chaque élève. Sans index, c'est un balayage complet
-- de la table à chaque fois.
create index if not exists ig_conversations_profil_creation
  on public.ig_conversations (profile_id, cree_le);
