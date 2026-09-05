-- La capture des vocaux est-elle cassée MAINTENANT ?
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POURQUOI CETTE VUE CHANGE DE QUESTION                                     │
-- │                                                                           │
-- │ Première version : « un vocal des 48 dernières heures n'a pas de fichier ».│
-- │ Elle a envoyé son premier e-mail le 2026-09-05 à 08:00, pour deux vocaux   │
-- │ perdus AVANT que la cause ne soit corrigée. Techniquement juste. Pour son  │
-- │ lecteur, inutile : le mail annonçait un problème déjà réglé, sur lequel il │
-- │ n'y avait rien à faire — le mail le disait lui-même, « le vocal déjà perdu │
-- │ ne se rattrape pas ».                                                      │
-- │                                                                           │
-- │ ⚠️ Une alerte sans action possible est le début d'une alerte qu'on n'ouvre  │
-- │ plus. C'est la règle que ce dépôt applique partout ailleurs, et cette vue  │
-- │ la violait dès son premier envoi.                                          │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- La question devient donc : **le DERNIER vocal reçu par ce compte a-t-il été
-- conservé ?**
--
--   - Dernier vocal capturé  → la chaîne fonctionne à l'instant. Les pertes
--                              antérieures sont de l'histoire : rien à faire,
--                              donc rien à envoyer. L'écran les montre déjà,
--                              une par une, en « Non récupérable ».
--   - Dernier vocal manquant → la cause est encore active, le prochain vocal
--                              sera perdu aussi. Là, il y a quelque chose à
--                              faire, et l'e-mail se justifie.
--
-- ⚠️ Un défaut INTERMITTENT reste détecté, et c'est ce qui rend la règle
--    acceptable. Il ne se cache pas : tôt ou tard le dernier vocal est un vocal
--    manqué, et l'alerte part à ce moment-là. On perd la trace des échecs
--    isolés déjà rattrapés, jamais celle d'un défaut qui dure.
--
-- ⚠️ Par PROFIL, pas globalement. Le compte cassé d'un élève ne doit pas être
--    masqué par le compte qui marche d'un autre — c'est le même piège que les
--    partitions à corriger des deux côtés.
--
-- ⚠️ La fenêtre passe de 48 h à 7 jours. Elle ne sert plus à limiter le bruit
--    (c'est « le dernier » qui s'en charge), mais à éviter qu'un compte dont le
--    dernier vocal date de six mois alerte pour l'éternité.
--
-- ⚠️ La grâce de 15 minutes reste : la capture suit l'enregistrement du message
--    de quelques secondes, et sans elle la vue signalerait un vocal en cours de
--    téléchargement.

-- ⚠️ `drop` puis `create`, et non `create or replace` : Postgres refuse de
--    renommer une colonne de vue en place. La consequence est connue et
--    surveillee — un `drop` reapplique les privileges PAR DEFAUT du schema, ce
--    qui a deja rouvert des vues de sante par le passe. `security_invoker = true`
--    reste donc obligatoire, et `acces_sante_lecture` verifie l'invariant juste
--    apres. Aucun `grant` n'est pose a la main : ce serait le geste qui, cru
--    protecteur, avait elargi l'acces.
drop view if exists public.ig_vocaux_sante;

create view public.ig_vocaux_sante
with (security_invoker = true) as
with dernier_vocal as (
  select distinct on (m.profile_id)
         m.id, m.profile_id, m.mid, m.envoye_a, m.conversation_id
    from ig_messages m
   where m.type_piece_jointe = 'audio'
     and m.envoye_a > now() - interval '7 days'
     and m.cree_le  < now() - interval '15 minutes'
   order by m.profile_id, m.envoye_a desc
)
select
  'ALERTE la capture des messages vocaux ne fonctionne plus'::text as etat,
  d.message_id,
  d.profile_id,
  d.envoye_a as dernier_vocal_le,
  d.prospect
from (
  select v.id as message_id, v.profile_id, v.envoye_a, c.peer_username as prospect, v.mid
    from dernier_vocal v
    join ig_conversations c on c.id = v.conversation_id
) d
where not exists (
  select 1 from storage.objects o
   where o.bucket_id = 'ig-vocaux'
     and o.name = d.profile_id::text || '/'
               || encode(substring(extensions.digest(d.mid, 'sha256') from 1 for 16), 'hex')
               || '.m4a'
);

comment on view public.ig_vocaux_sante is
  'La capture des vocaux est-elle cassee MAINTENANT ? Une ligne par profil dont le DERNIER vocal recu n''a pas de fichier — donc dont la cause est encore active et le prochain vocal sera perdu aussi. Les pertes deja rattrapees ne sont pas signalees : elles n''appellent aucune action, et l''ecran les montre deja en « Non recuperable ».';
