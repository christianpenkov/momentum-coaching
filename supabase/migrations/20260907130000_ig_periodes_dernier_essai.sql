-- `analytics_ig_periodes.dernier_essai_le` — « quand a-t-on essayé », distinct de
-- « quand a-t-on mesuré ».
--
-- ── Le problème qu'elle ferme ───────────────────────────────────────────────
--
-- La règle de fraîcheur de `majPeriodesIg` (6 h) compare `mesure_le`. Elle ne peut
-- donc freiner que les périodes DÉJÀ MESURÉES. Deux cas lui échappaient, et tous
-- deux produisent une boucle d'appels à chaque passage du cron, soit 288 par jour et
-- par profil :
--
--   * aucune ligne          → rien à comparer  (fermé le même jour : on inscrit
--                             désormais la ligne avec des valeurs nulles) ;
--   * ligne présente mais PÉRIMÉE, et Meta ne sert toujours rien → `ecrire` renonce
--     sans rien réécrire, donc `mesure_le` reste vieux, donc on rappelle au passage
--     suivant. Et au suivant.
--
-- ── Pourquoi une colonne, et pas simplement rafraîchir `mesure_le` ──────────
--
-- ⚠️ C'est le piège que `AGENTS.md` documente déjà, sur `edge_sante_version` : une
-- date d'« état » réécrite à chaque passage cesse de dire ce qu'elle prétend, et
-- éteint l'alerte qui s'appuie dessus. Ici, avancer `mesure_le` sans mesure ferait
-- lire « mesurée il y a 5 minutes » à une période que Meta ne sert plus du tout —
-- la branche « période courante figée » de `ig_sante_periodes` ne se déclencherait
-- plus JAMAIS.
--
-- Les deux dates répondent à deux questions différentes, et doivent donc être deux
-- colonnes :
--
--   `mesure_le`        quand la portée a été RÉELLEMENT obtenue  → sert la surveillance
--   `dernier_essai_le` quand on a appelé Meta, succès ou non     → sert la cadence
--
-- ── Ce qui change dans le cron ──────────────────────────────────────────────
--
-- La fraîcheur se calcule désormais sur `greatest(mesure_le, dernier_essai_le)` :
-- un appel infructueux compte comme un passage, donc il n'y en a plus que quatre par
-- jour au lieu de 288. `mesure_le`, lui, garde exactement le sens qu'il avait — donc
-- aucune surveillance n'est affaiblie.
--
-- Nullable et sans valeur par défaut : les lignes déjà écrites n'ont jamais eu
-- d'essai infructueux enregistré, et leur `mesure_le` suffit à les dater. Inventer
-- une valeur reviendrait à affirmer un essai qui n'a pas eu lieu.

alter table public.analytics_ig_periodes
  add column if not exists dernier_essai_le timestamptz;

comment on column public.analytics_ig_periodes.dernier_essai_le is
  'Dernier appel à Meta pour cette période, succès OU échec. Sert uniquement à espacer '
  'les tentatives (règle de fraîcheur du cron). Ne jamais l''utiliser pour juger de la '
  'fraîcheur de la DONNÉE : c''est `mesure_le` qui dit quand la portée a réellement été '
  'obtenue, et c''est lui que lit ig_sante_periodes.';
