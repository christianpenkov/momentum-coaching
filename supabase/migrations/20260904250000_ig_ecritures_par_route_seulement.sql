-- Personne n'écrit en direct dans les conversations. Ni l'élève, ni le coach.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ DEUX DÉFAUTS TROUVÉS PAR L'AUDIT DU 2026-09-04, EN PRODUCTION             │
-- │                                                                           │
-- │ 1. L'ÉLÈVE POUVAIT RÉÉCRIRE LES NOTES DE SON COACH. La politique          │
-- │    « owner access » était `for all` : elle lui donnait l'écriture sur      │
-- │    TOUTES les colonnes de ses lignes, dont `note`, qui appartient au       │
-- │    coach. Un élève pouvait donc fabriquer des notes de coaching.           │
-- │                                                                           │
-- │ 2. LE COACH NE POUVAIT PAS ÉCRIRE DE NOTE DU TOUT. Il n'avait qu'une       │
-- │    politique de LECTURE. La fonctionnalité était simplement cassée, et     │
-- │    aucun test au navigateur ne l'avait exercée — j'avais vérifié           │
-- │    l'affichage, jamais l'écriture.                                        │
-- │                                                                           │
-- │ La cause est commune : Postgres ne sait pas borner les COLONNES qu'un      │
-- │ `update` peut toucher. Une politique d'écriture est donc toujours plus     │
-- │ large que ce qu'on veut autoriser — ouvrir `note` au coach lui ouvrirait   │
-- │ aussi `texte`, c'est-à-dire le pouvoir de réécrire ce qu'un prospect a dit.│
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- La règle posée ici : **aucune écriture directe depuis le navigateur.** La
-- lecture passe par la RLS, l'écriture par une route qui n'accepte qu'un champ
-- nommé. C'est déjà le motif retenu pour `ig_suggestions.copie_le`.
--
-- ⚠️ Ne pas « débloquer » un jour en rajoutant une politique `for update` : elle
--    rouvrira les deux trous d'un coup, et rien ne le signalera.

-- ── ig_conversations : lecture seule pour tout le monde ─────────────────────
drop policy if exists "owner access" on public.ig_conversations;
create policy "owner lit" on public.ig_conversations for select
  using (profile_id = (select auth.uid()));

-- ── ig_messages : idem ──────────────────────────────────────────────────────
drop policy if exists "owner access" on public.ig_messages;
create policy "owner lit" on public.ig_messages for select
  using (profile_id = (select auth.uid()));

-- ── ig_suggestions ──────────────────────────────────────────────────────────
-- L'élève lisait ET pouvait modifier : la même faille, sur le texte que son
-- coach a écrit. La route `/api/client/ig-suggestion` fait déjà le travail.
drop policy if exists "eleve marque" on public.ig_suggestions;

-- Le coach : lecture + création. Pas `for all` — cela lui donnait aussi
-- l'écriture sur des suggestions déjà posées, et la suppression.
drop policy if exists "coach ecrit" on public.ig_suggestions;
create policy "coach lit les suggestions" on public.ig_suggestions for select
  using (exists (
    select 1 from public.clients c
     where c.profile_id = ig_suggestions.profile_id
       and c.coach_id   = (select auth.uid())
       and c.ig_dm_lecture_accordee_le is not null
  ));
create policy "coach cree une suggestion" on public.ig_suggestions for insert
  with check (exists (
    select 1 from public.clients c
     where c.profile_id = ig_suggestions.profile_id
       and c.coach_id   = (select auth.uid())
       and c.ig_dm_lecture_accordee_le is not null
  ));
