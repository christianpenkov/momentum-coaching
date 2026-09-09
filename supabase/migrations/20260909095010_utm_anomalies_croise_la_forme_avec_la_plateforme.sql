-- utm_anomalies etait aveugle a ce qu'elle etait censee surveiller
--
-- La vue porte une COPIE SQL de la regle `isValidContentId` (lib/contentId.ts). Cette
-- regle accepte toute chaine de 11 caracteres dans [A-Za-z0-9_-] comme identifiant de
-- video YouTube — parce qu'un vrai identifiant YouTube EST exactement cela. La forme ne
-- peut donc pas separer un identifiant reel d'un pseudo de la meme longueur.
--
-- Constate le 2026-09-09 : le lien de DM `prendre-rdv-leroymerlin` porte
-- `utm_content=leroymerlin` — 11 caracteres, un pseudo de prospect d'avant la
-- nomenclature du 19 aout. Une reservation par ce lien aurait ecrit `leroymerlin` dans
-- `calls.utm_content`, et la vue censee le signaler l'aurait valide.
--
-- ⚠️ **Ce n'est pas une regex a resserrer, c'est une deduction a retirer.** Aucune
-- regle portant sur la seule chaine ne pourra jamais les separer. Le seul discriminant
-- est le CONTEXTE : la plateforme est dite par `source`, pas par la forme du contenu.
--
-- Trois regles ajoutees, croisant la forme avec la plateforme :
--   * un utm_content sur un lien de BIO — une bio ne vient d'aucun contenu, par nature ;
--   * une forme YouTube sur une source Instagram ;
--   * une forme Instagram sur une source YouTube.
--
-- Verifie AVANT d'appliquer sur les 47 rendez-vous reels (ignores compris) : zero
-- fausse alerte. Le seul utm_content de 11 caracteres en base, `EMvwzHVjNJg`, porte
-- bien `source = yt_description` — coherent, donc non signale.
--
-- ⚠️ La regle « id de post Instagram » reste `[0-9]{15,20}` ici alors que les trois
-- copies TypeScript utilisent `\d{10,}`. C'est VOLONTAIRE et ce n'est pas une derive a
-- corriger : un detecteur plus strict que l'ecrivain signale ce que l'ecrivain a laisse
-- passer. L'aligner sur `{10,}` reduirait la detection sans rien gagner.
--
-- ⚠️ `create or replace`, jamais `drop` + `create` : un `create view` rouvre l'ACL en
-- silence (mode de panne documente par 20260903170000). Les options et les droits sont
-- malgre tout reaffirmes explicitement en fin de fichier.

create or replace view public.utm_anomalies as
select
  id, coach_id, scheduled_at, invitee_name, revenue,
  source, utm_medium, utm_campaign, utm_content, utm_term,
  case
    when source like '%.%'
      then 'source contient un domaine au lieu de la plateforme'

    when utm_content is not null
     and utm_content !~ '^[0-9]{15,20}$'
     and utm_content !~ '^[A-Za-z0-9_-]{11}$'
     and utm_content !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then 'utm_content ne contient pas un identifiant de contenu'

    when utm_medium = 'bio' and utm_content is not null
      then 'utm_content pose sur un lien de bio, qui ne vient d aucun contenu'

    when split_part(coalesce(source, ''), '_', 1) = 'ig'
     and utm_content ~ '^[A-Za-z0-9_-]{11}$'
     and utm_content !~ '^[0-9]{15,20}$'
      then 'utm_content a la forme d un identifiant YouTube sur une source Instagram'

    when split_part(coalesce(source, ''), '_', 1) = 'yt'
     and utm_content ~ '^[0-9]{15,20}$'
      then 'utm_content a la forme d un identifiant Instagram sur une source YouTube'

    when utm_medium is not null
     and utm_medium <> all (array['bio','description','dm','story'])
      then 'utm_medium hors nomenclature : ' || utm_medium

    when source is not null
     and split_part(source, '_', 1) <> all (array['ig','yt'])
      then 'plateforme inconnue dans source : ' || split_part(source, '_', 1)

    when source is not null and utm_medium is not null
     and split_part(source, '_', 2) <> utm_medium
      then 'source et utm_medium se contredisent'

    else null
  end as anomalie
from calls c
where call_type = 'calendly';

alter view public.utm_anomalies set (security_invoker = true);
revoke select on public.utm_anomalies from anon, authenticated;
