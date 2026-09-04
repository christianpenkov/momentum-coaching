-- Les suggestions du coach.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ LA PLATEFORME N'ENVOIE AUCUN MESSAGE DE COACH — décision produit          │
-- │                                                                           │
-- │ Le coach ne répond jamais à la place de son élève. Il rédige un texte,    │
-- │ l'élève l'envoie depuis Instagram. La raison n'est PAS technique : un     │
-- │ coach qui répond à la place engage l'élève sans avoir tout le contexte,   │
-- │ et plus personne ne peut dire qui a dit quoi. On supprime la classe de    │
-- │ problème au lieu de la gérer.                                            │
-- │                                                                           │
-- │ Effets : aucune fenêtre de 24 h à calculer, aucune permission             │
-- │ `human_agent` à demander à Meta, donc aucun moyen de perdre les quatre    │
-- │ permissions Instagram par une erreur d'implémentation.                    │
-- └───────────────────────────────────────────────────────────────────────────┘

create table if not exists public.ig_suggestions (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ig_conversations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  auteur_id       uuid not null,
  texte           text not null,
  cree_le         timestamptz not null default now(),
  copie_le        timestamptz,
  traite_le       timestamptz
);

create index if not exists ig_suggestions_fil
  on public.ig_suggestions (conversation_id, cree_le desc);
create index if not exists ig_suggestions_a_traiter
  on public.ig_suggestions (profile_id) where traite_le is null;

comment on column public.ig_suggestions.copie_le is
  '⚠️ NE PROUVE PAS qu''un message est parti. L''envoi a lieu dans Instagram, hors de notre portee : c''est un marqueur d''intention, pas un accuse. Le nommer envoye_le ferait affirmer a l''ecran quelque chose qu''il ne sait pas.';

comment on column public.ig_suggestions.traite_le is
  'L''eleve declare avoir traite la suggestion. Meme reserve que copie_le. La SEULE preuve d''envoi arrive toute seule : si le texte part vraiment, Instagram nous le renvoie en is_echo et il apparait dans le fil comme n''importe quel message.';

alter table public.ig_suggestions enable row level security;

-- L'élève lit ce qui le concerne.
drop policy if exists "eleve lit" on public.ig_suggestions;
create policy "eleve lit" on public.ig_suggestions for select
  using (profile_id = (select auth.uid()));

-- L'élève marque « copiée » / « traitée ».
--
-- ⚠️ Postgres ne sait PAS borner les colonnes qu'un update peut toucher : cette
-- politique laisse donc l'eleve reecrire `texte`. Le risque est faible (il ne se
-- ment qu'a lui-meme) mais il est borne cote route : l'ecriture de l'eleve passe
-- par un endpoint qui n'accepte que copie_le et traite_le. Ne pas ouvrir un
-- acces direct depuis le navigateur en croyant que la RLS suffit.
drop policy if exists "eleve marque" on public.ig_suggestions;
create policy "eleve marque" on public.ig_suggestions for update
  using (profile_id = (select auth.uid()));

-- Le coach ecrit et relit les siennes, si la lecture lui est accordee.
drop policy if exists "coach ecrit" on public.ig_suggestions;
create policy "coach ecrit" on public.ig_suggestions for all
  using (exists (
    select 1 from public.clients c
     where c.profile_id = ig_suggestions.profile_id
       and c.coach_id   = (select auth.uid())
       and c.ig_dm_lecture_accordee_le is not null
  ));
