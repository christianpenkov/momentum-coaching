-- La date de premiere connexion doit survivre a une deconnexion.
--
-- ── Le probleme ────────────────────────────────────────────────────────────
-- Debrancher une integration SUPPRIME sa ligne (components/onboarding/
-- IntegrationConnectCard.tsx, PageSettings.tsx, PageClientSettings.tsx) et emporte
-- `first_connected_at` avec elle. Au rebranchement, les 7 callbacks font
-- `existing?.first_connected_at || now` : sans ligne existante, la date repart a
-- aujourd'hui.
--
-- Or cette date borne des choses qui n'ont rien a voir avec le branchement :
--   • la navigation arriere dans Mes Stats (maxIndex de PeriodPill) — l'eleve perd
--     l'acces a tout son historique de periodes, alors que la donnee est intacte ;
--   • le plancher d'ingestion Calendly (`first_connected_at - 48 h`) — les
--     rendez-vous anterieurs cessent d'etre rafraichis.
--
-- Autrement dit : « debrancher puis rebrancher », le geste reflexe quand quelque
-- chose semble bloque, degradait la plateforme sans rien signaler.
--
-- ── Pourquoi PAS « ne plus supprimer la ligne » ────────────────────────────
-- Parce que 133 lectures de `integrations` dans le code testent la connexion par
-- l'EXISTENCE de la ligne (releve du 2026-09-02). Garder une ligne sans jeton les
-- ferait toutes mentir. C'aurait ete une refonte, pas une correction.
--
-- ── Pourquoi PAS `clients.integrations_ready_at` ───────────────────────────
-- Elle est PAR ELEVE et marque le moment ou TOUTES les integrations requises sont
-- la ; celle-ci est PAR INTEGRATION. Elles divergent fortement : sur le profil de
-- test, integrations_ready_at vaut le 2026-06-09, la premiere integration date du
-- 2026-05-19 (21 jours avant) et la derniere du 2026-08-18 (70 jours apres) — la
-- liste des fournisseurs obligatoires s'etant allongee entre-temps, sans que la
-- date, ecrite une seule fois, ne bouge.
--
-- ── La solution : une memoire hors de la ligne ─────────────────────────────
-- Une table minuscule que rien ne supprime, alimentee et relue par deux
-- declencheurs. Le code applicatif ne change PAS D'UNE LIGNE : ni les 133 lectures,
-- ni les 7 ecrivains, ni les 4 lecteurs de la colonne. La colonne cesse simplement
-- d'etre perdue.
--
-- VERIFIE en SQL, cycle complet (2026-09-02) : connexion il y a 100 jours ->
-- memorisee ; suppression de la ligne -> memoire intacte ; reinsertion avec
-- `now()` -> la base restaure la date d'origine. Verdict : DATE PRESERVEE.
--
-- Effet de bord assume : la date devient definitive par (profil, fournisseur), meme
-- si l'eleve rebranche un compte DIFFERENT. Consequence reelle : le plancher
-- d'ingestion remonte plus loin que necessaire, donc on collecte un peu plus large.
-- Jamais l'inverse. C'est le bon sens de l'erreur.

create table if not exists public.integrations_premiere_connexion (
  profile_id uuid not null,
  provider   text not null,
  le         timestamptz not null,
  primary key (profile_id, provider)
);

alter table public.integrations_premiere_connexion enable row level security;
-- Aucune policy : table de service, jamais lue depuis le client. Les declencheurs
-- sont SECURITY DEFINER et passent outre.

-- 1. MEMORISER — jamais ecraser : la premiere valeur vue est la bonne.
create or replace function public.memoriser_premiere_connexion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.first_connected_at is not null then
    insert into public.integrations_premiere_connexion (profile_id, provider, le)
    values (new.profile_id, new.provider, new.first_connected_at)
    on conflict (profile_id, provider) do nothing;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_memoriser_premiere_connexion on public.integrations;
create trigger trg_memoriser_premiere_connexion
  after insert or update of first_connected_at on public.integrations
  for each row execute function public.memoriser_premiere_connexion();

-- 2. RESTAURER — a la reinsertion apres une deconnexion.
-- BEFORE INSERT : la valeur memorisee prime sur celle que le callback vient de
-- calculer (`now`), puisqu'elle est forcement anterieure ou egale.
create or replace function public.restaurer_premiere_connexion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v timestamptz;
begin
  select le into v from public.integrations_premiere_connexion
   where profile_id = new.profile_id and provider = new.provider;
  if v is not null then
    new.first_connected_at := least(v, coalesce(new.first_connected_at, v));
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_restaurer_premiere_connexion on public.integrations;
create trigger trg_restaurer_premiere_connexion
  before insert on public.integrations
  for each row execute function public.restaurer_premiere_connexion();

-- Amorcage : memoriser ce qui existe deja, avant toute deconnexion future.
insert into public.integrations_premiere_connexion (profile_id, provider, le)
select profile_id, provider, first_connected_at
from public.integrations
where first_connected_at is not null
on conflict (profile_id, provider) do nothing;
