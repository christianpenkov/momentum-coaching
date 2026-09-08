-- Le verrou d'intégrations s'applique aussi aux COACHS
--
-- ⚠️ POURQUOI — demande du 2026-09-08
--
-- `integrations_ready_at` existait sur `clients` uniquement, donc le verrou ne
-- concernait que les élèves. Un coach entrait dans sa plateforme sans aucune
-- intégration, et les écrans de stats calculaient alors sur des sources vides —
-- exactement le défaut que le verrou existe pour empêcher côté élève
-- (docs/integrations-ready-at-vs-onboarding-completed-at.md : la date est la borne de
-- départ de TOUTES les stats).
--
-- ── Le choix : la même définition, pas une deuxième ──────────────────────────────
--
-- La liste des providers obligatoires ne devait surtout PAS être recopiée. Elle vit
-- dans `integrations_obligatoires()`, une seule fois, et le déclencheur existant la lit
-- déjà. On étend donc **la fonction du déclencheur**, on n'en crée pas une seconde :
-- une deuxième définition dériverait de la première le jour où la liste changerait,
-- et la divergence serait silencieuse.
--
-- Résultat : une seule liste, un seul déclencheur, deux emplacements de stockage qui
-- reflètent les deux tables de rôle —
--
--   élève  → `clients.integrations_ready_at`   (inchangé)
--   coach  → `profiles.integrations_ready_at`  (nouveau)
--
-- ⚠️ La colonne est posée sur `profiles`, donc elle sera aussi renseignée pour les
-- ÉLÈVES. C'est voulu et sans effet : le verrou élève continue de lire `clients`.
-- Avoir la même information des deux côtés coûte une colonne et évite un cas
-- particulier dans le déclencheur.
--
-- ⚠️ Sémantique conservée à l'identique : posée une seule fois, à la première fois où
-- les 7 sont réunies, et **ne redescend jamais** (`where … is null`). Une déconnexion
-- ultérieure relève du mécanisme B (bandeau de reconnexion), pas du verrou.

alter table public.profiles
  add column if not exists integrations_ready_at timestamptz;

comment on column public.profiles.integrations_ready_at is
  'Posée une seule fois quand les 7 intégrations obligatoires sont réunies pour ce profil. Ne redescend jamais. Sert de verrou d''accès aux COACHS ; pour un élève, c''est clients.integrations_ready_at qui fait foi. Voir docs/integrations-ready-at-vs-onboarding-completed-at.md.';

-- ⚠️ `security invoker` et `search_path = public` : les attributs d'origine, preserves
-- volontairement. Un `create or replace` qui les oublierait changerait le contexte
-- d'execution du declencheur sans que rien ne le signale.
create or replace function public.recalc_integrations_ready_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  required_providers text[] := array(select provider from integrations_obligatoires());
  connected_count int;
begin
  select count(distinct provider) into connected_count
  from integrations
  where profile_id = new.profile_id and provider = any(required_providers);

  if connected_count >= array_length(required_providers, 1) then
    -- Élève : inchangé.
    update clients set integrations_ready_at = now()
    where profile_id = new.profile_id and integrations_ready_at is null;

    -- Coach (et élève, sans conséquence) : le nouvel emplacement.
    update profiles set integrations_ready_at = now()
    where id = new.profile_id and integrations_ready_at is null;
  end if;
  return new;
end;
$$;

-- ── Rattrapage de l'existant ─────────────────────────────────────────────────────
--
-- Deux sources, dans cet ordre de priorité :
--   1. la date deja connue cote eleve — on ne REINVENTE pas une date qui existe ;
--   2. sinon, `now()` si les 7 sont deja reunies aujourd'hui.
--
-- ⚠️ On ne pose RIEN pour un profil qui n'a pas ses 7 : c'est precisement le cas que
-- le verrou doit attraper. Poser une date « pour ne bloquer personne » viderait la
-- mesure de son sens.

update profiles p
   set integrations_ready_at = c.integrations_ready_at
  from clients c
 where c.profile_id = p.id
   and c.integrations_ready_at is not null
   and p.integrations_ready_at is null;

update profiles p
   set integrations_ready_at = now()
 where p.integrations_ready_at is null
   and (
     select count(distinct i.provider)
       from integrations i
      where i.profile_id = p.id
        and i.provider in (select provider from integrations_obligatoires())
   ) >= (select count(*) from integrations_obligatoires());
