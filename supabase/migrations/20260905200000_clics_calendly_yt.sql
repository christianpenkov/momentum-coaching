-- ─────────────────────────────────────────────────────────────────────────────
-- Les clics sur les liens Calendly YouTube — le seul haut d'entonnoir qu'on ait
--
-- ── POURQUOI CETTE COLONNE NE PEUT PAS CONTENIR DE GENS ──────────────────────
--
-- Un lien Calendly de bio ou de description YouTube est PARTAGÉ : tout le monde
-- clique le même. Le clic est donc anonyme, et le restera — on n'apprend le nom
-- de quelqu'un qu'au moment où il remplit le formulaire Calendly, c'est-à-dire
-- en réservant.
--
-- Ce n'est pas un trou de collecte qu'on pourrait combler : c'est la nature du
-- lien. Côté Instagram, le pipeline connaît les gens avant la réservation parce
-- qu'ils sont passés par un commentaire ou un DM, qui portent une identité.
-- YouTube n'a aucun équivalent.
--
-- Vérifié en base le 2026-09-05 : zéro lien de suivi YouTube cliqué, zéro
-- prospect YouTube ayant cliqué sans réserver. La colonne « Lien cliqué » de
-- l'onglet YouTube était donc vide par construction, pas par manque de données.
--
-- Décision de Chris : elle reste, mais comme un COMPTEUR — une colonne repliée
-- qui ne s'ouvre pas, portant le nombre de clics. Le supprimer ferait commencer
-- l'entonnoir YouTube à « RDV pris », en cachant la seule mesure d'acquisition
-- qu'il possède.
--
-- ── UN AGRÉGAT, PAS UNE LISTE ────────────────────────────────────────────────
--
-- Cette fonction rend UNE ligne. Sans elle, l'écran rapatrierait un relevé
-- quotidien par lien et par jour — quelques centaines de lignes à chaque
-- ouverture du pipeline — pour n'en afficher que la somme. Le coût de l'egress
-- se paie au nombre de requêtes (voir AGENTS.md), mais rapatrier des lignes pour
-- les additionner côté navigateur reste du travail fait deux fois.
--
-- ── CE QU'ELLE COMPTE, ET CE QU'ELLE N'AFFIRME PAS ───────────────────────────
--
-- `human_clicks` : les clics dont Short.io a écarté les robots. Ce sont des
-- CLICS, pas des personnes — la même personne qui clique deux fois compte deux
-- fois, et rien ne permet de la reconnaître. L'écran doit donc écrire « clics »,
-- jamais afficher un nombre nu à côté de colonnes qui, elles, comptent des gens.
--
-- ⚠️ `depuis` n'est PAS décoratif. Les relevés commencent au 2026-07-19 : avant
-- cette date, on ne sait rien. Un total présenté comme « depuis toujours »
-- affirmerait que rien ne s'est passé avant, ce qui est faux — c'est le piège
-- déjà documenté pour « Lead magnet reçu » (0 face à 412). L'écran porte donc la
-- date, et elle vient d'ici plutôt que d'une constante écrite en dur qui
-- deviendrait fausse le jour d'une purge ou d'un backfill.
--
-- Les deux catégories sont celles de `lib/shortio-link-category.ts` — bio ET
-- description, décision de Chris : les deux mènent au même Calendly.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.clics_calendly_yt(p_profile_id uuid)
returns table (clics bigint, depuis date)
language sql
stable
as $$
  select coalesce(sum(s.human_clicks), 0)::bigint,
         min(s.date)
  from public.shortio_link_daily_snapshots s
  where s.profile_id = p_profile_id
    and s.link_category in ('calendly_desc_yt', 'calendly_bio_yt');
$$;

comment on function public.clics_calendly_yt(uuid) is
  'Somme des clics humains sur les liens Calendly YouTube (bio + description) d''un profil, et le premier jour couvert par les releves. Des CLICS, pas des personnes : un lien partage ne porte aucune identite.';

-- Supabase accorde EXECUTE a `anon` par defaut sur toute fonction nouvelle (voir
-- AGENTS.md, « un revoke ne se maintient pas »). Rien ici n'a de raison d'etre
-- appele sans session : la fonction prend un profile_id en parametre, donc sans
-- ce revoke n'importe qui pourrait sonder les clics d'un profil devine.
revoke execute on function public.clics_calendly_yt(uuid) from anon;
