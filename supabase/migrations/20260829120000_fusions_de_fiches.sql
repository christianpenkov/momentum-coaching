-- ─────────────────────────────────────────────────────────────────────────────
-- Fusionner deux fiches qui sont la même personne
--
-- Une même personne peut occuper DEUX fiches dans le pipeline :
--   • une fiche Instagram — elle a commenté, donc `instagram_leads` existe ;
--   • une fiche e-mail — elle a réservé depuis une bio ou une description, donc
--     seulement un `call` rattaché à un `prospect`.
--
-- Rien ne les relie : `instagram_leads` n'a AUCUNE colonne e-mail, et un pseudo
-- Instagram n'a aucun champ commun avec une adresse. Le seul pont est indirect —
-- quand un lead Instagram réserve, son call porte à la fois `ig_lead_id` ET
-- `invitee_email`. C'est par cet e-mail qu'on peut soupçonner un doublon.
--
-- Cette table retient les DÉCISIONS prises sur ces soupçons. Une ligne par paire,
-- deux états possibles.
--
-- ── POURQUOI UNE SEULE TABLE POUR DEUX CHOSES ────────────────────────────────
--
-- « fusionnée » et « refusée » sont la même information sous deux formes : ce que
-- l'élève a répondu à « est-ce la même personne ? ». Deux tables auraient demandé
-- de chercher dans les deux avant d'afficher quoi que ce soit, et de les garder
-- cohérentes — une paire ne peut pas être à la fois fusionnée et refusée.
-- L'index unique sur la paire le garantit ici, gratuitement.
--
-- ── POURQUOI RETENIR UN REFUS ────────────────────────────────────────────────
--
-- Sans mémoire, la question reviendrait à chaque chargement du pipeline sur un cas
-- déjà tranché. Une question qui revient sur une décision prise est du bruit
-- permanent, et le bruit permanent est l'inverse de l'objectif du projet : zéro
-- maintenance après livraison. Deux colonnes suffisent, et elles ne demandent
-- aucun entretien.
--
-- ── POURQUOI `call_ids` ──────────────────────────────────────────────────────
--
-- Fusionner = poser `ig_lead_id` sur les calls de la fiche e-mail. Pour SÉPARER à
-- nouveau, il faut savoir lesquels ont bougé : un lead Instagram a en général déjà
-- ses propres calls, et les remettre tous à `null` casserait sa fiche. On garde
-- donc la liste exacte de ce qu'on a déplacé, et c'est elle seule qu'on défait.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.fusions_fiches (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,

  -- Les deux côtés de la paire. Le sens de la fusion est toujours le même :
  -- les calls du prospect rejoignent le lead Instagram, qui est la fiche la plus
  -- riche des deux (pseudo, photo, historique de DM).
  ig_lead_id    uuid not null references public.instagram_leads(id) on delete cascade,
  prospect_id   uuid not null references public.prospects(id) on delete cascade,

  statut        text not null check (statut in ('fusionnee', 'refusee')),

  -- Les calls réellement déplacés par CETTE fusion. Vide pour un refus.
  call_ids      uuid[] not null default '{}',

  decided_at    timestamptz not null default now()
);

-- Une paire, une décision. C'est cet index qui interdit qu'elle soit à la fois
-- fusionnée et refusée, et qui rend l'upsert possible quand l'élève change d'avis.
create unique index if not exists fusions_fiches_paire_uidx
  on public.fusions_fiches (profile_id, ig_lead_id, prospect_id);

-- Le pipeline lit toutes les décisions d'un profil à chaque chargement pour taire
-- les paires déjà tranchées.
create index if not exists fusions_fiches_profil_idx
  on public.fusions_fiches (profile_id);

alter table public.fusions_fiches enable row level security;

-- Même règle que le reste du pipeline : l'élève propriétaire, et son coach.
create policy "fusions_fiches_owner"
  on public.fusions_fiches for all
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.clients
      where clients.profile_id = fusions_fiches.profile_id
        and clients.coach_id = auth.uid()
    )
  )
  with check (
    profile_id = auth.uid()
    or exists (
      select 1 from public.clients
      where clients.profile_id = fusions_fiches.profile_id
        and clients.coach_id = auth.uid()
    )
  );

comment on table public.fusions_fiches is
  'Décisions prises sur les doublons soupçonnés entre une fiche Instagram et une fiche e-mail : fusionnée (avec la liste des calls déplacés, pour pouvoir séparer) ou refusée (pour ne plus reposer la question).';

-- ── AUCUN BACKFILL ───────────────────────────────────────────────────────────
-- Rien à reprendre : le mécanisme n'existait pas, aucune fusion n'a jamais été
-- faite. La table part vide, et c'est correct — elle n'enregistre que des
-- décisions humaines à venir, jamais un état déduit des données.
