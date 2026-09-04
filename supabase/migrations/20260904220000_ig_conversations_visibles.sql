-- La vue que lit l'écran des conversations, côté coach comme côté élève.
--
-- ⚠️ LA JOINTURE SUR instagram_leads EST ÉCRITE ICI, PAS LAISSÉE À LA RLS.
--
-- La RLS d'`ig_conversations` porte déjà la même condition, et elle suffirait à
-- rendre le résultat correct. Elle ne suffit pas à le rendre RAPIDE : à 40 élèves,
-- un élève peut porter 2 000 conversations dont 300 seulement sont des leads. Si
-- la lecture s'en remet à la RLS pour filtrer, Postgres parcourt les fils par date
-- décroissante et en rejette la grande majorité avant d'en trouver trente à
-- afficher — et c'est de pire en pire à mesure que la quarantaine se remplit.
--
-- Écrite ici, la condition peut attaquer l'index partiel
-- `instagram_leads_visibles` posé par la migration `conversations_instagram`.
--
-- **La RLS garde, la requête filtre.** Les deux, jamais l'un à la place de
-- l'autre : ne pas retirer ce join en constatant que la RLS fait déjà le travail
-- (elle le fait correctement et lentement), ni retirer la RLS en constatant que
-- le join filtre déjà (il ne protège rien contre une requête écrite autrement).
--
-- ⚠️ `security_invoker = true` : sans lui, la vue s'exécuterait avec les droits de
-- son propriétaire et contournerait la RLS — `acces_sante_lecture` le signalerait,
-- à raison. Les privilèges par défaut de Supabase rendent toute vue nouvelle
-- lisible par `anon` ; c'est `security_invoker` qui fait que `anon` n'en tire
-- aucune ligne.
--
-- Les colonnes dérivées évitent une requête par fil à l'affichage :
--   attend_reponse  — le prospect a écrit APRÈS le dernier message de l'élève.
--                     C'est le seul signal d'urgence de l'écran.
--   nb_notes        — pour la pastille, sans charger les messages.
--   dernier_texte / dernier_type — l'extrait de la liste.

create or replace view public.ig_conversations_visibles
with (security_invoker = true) as
select cv.id,
       cv.profile_id,
       cv.peer_id,
       -- Le pseudo du fil, ou celui du lead si le webhook n'a pas encore résolu.
       coalesce(cv.peer_username, l.ig_username) as peer_username,
       -- La photo vient du lead : le bucket `instagram-avatars` est déjà alimenté
       -- par le webhook, aucune colonne ni aucun appel de plus.
       l.avatar_url                              as peer_avatar_url,
       cv.first_message_at,
       cv.last_message_at,
       cv.last_inbound_at,
       cv.note,
       cv.note_le,
       l.detected_at                             as lead_depuis,
       l.source                                  as lead_source,
       (cv.last_inbound_at is not null
        and cv.last_inbound_at >= cv.last_message_at) as attend_reponse,
       (select count(*) from public.ig_messages m where m.conversation_id = cv.id) as nb_messages,
       (select count(*) from public.ig_messages m
         where m.conversation_id = cv.id and m.note is not null)                   as nb_notes,
       (select m.texte from public.ig_messages m
         where m.conversation_id = cv.id order by m.envoye_a desc limit 1)         as dernier_texte,
       (select m.type_piece_jointe from public.ig_messages m
         where m.conversation_id = cv.id order by m.envoye_a desc limit 1)         as dernier_type
  from public.ig_conversations cv
  join public.instagram_leads l
    on l.profile_id  = cv.profile_id
   and l.ig_user_id  = cv.peer_id
   and l.not_a_lead  = false
   and l.archived_at is null
 where cv.archived_at is null;

comment on view public.ig_conversations_visibles is
  'Les fils qu''un coach peut voir. La jointure sur instagram_leads est ECRITE ICI, pas laissee a la RLS : la RLS garde, la requete filtre. security_invoker = true, donc la RLS de ig_conversations s''applique quand meme.';
