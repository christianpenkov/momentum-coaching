-- Un message vocal reçu, mais jamais conservé.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POURQUOI CETTE VUE EXISTE                                                 │
-- │                                                                           │
-- │ Le premier vocal reçu après la mise en place de la capture n'a PAS été     │
-- │ stocké : Meta le sert avec `content-type: video/mp4`, que le bucket        │
-- │ refusait. L'échec était correctement journalisé — `webhook_debug_log`,     │
-- │ « vocal non stocké » — et c'est justement le problème : cette table n'est  │
-- │ lue par personne et se purge au bout de 14 jours.                          │
-- │                                                                           │
-- │ Or c'est une perte DÉFINITIVE. Meta ne ressert jamais un vocal : mesuré    │
-- │ sur un message vieux de trois heures, `is_unsupported: true` et zéro pièce │
-- │ jointe. Une capture ratée ne se rattrape pas le lendemain.                 │
-- │                                                                           │
-- │ La capture est volontairement NON BLOQUANTE — une exception ferait échouer │
-- │ l'événement, donc le DM1 qui suit. Le prix de ce choix est qu'elle peut    │
-- │ échouer en silence. Cette vue est ce qui le rend audible.                   │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ⚠️ La fenêtre est de 48 h, et ce n'est pas un réglage de confort. Une vue qui
--    regarderait les 30 jours de rétention listerait pour toujours les vocaux
--    perdus avant que la cause ne soit corrigée : une alerte qui crie tous les
--    jours est une alerte qu'on n'ouvre plus. À 48 h, un défaut nouveau est vu
--    par l'e-mail quotidien, et un défaut réparé se tait tout seul le
--    surlendemain. Aucune date écrite en dur, aucune liste d'exceptions à tenir.
--
-- ⚠️ Et une grâce de 15 minutes : la capture suit l'enregistrement du message de
--    quelques secondes. Sans elle, la vue signalerait chaque vocal reçu pendant
--    qu'il est en train d'être téléchargé.
--
-- ⚠️ Le chemin est RECALCULÉ ici avec la même formule qu'ailleurs. C'est la
--    quatrième implémentation de l'empreinte (SQL d'écriture, worker, route de
--    lecture, et celle-ci) : si l'une dérive, cette vue signalera des vocaux
--    « perdus » qui sont bien là — un faux positif, donc, jamais un silence.
--    `lib/igConversations.test.ts` gèle la valeur témoin.

create or replace view public.ig_vocaux_sante
with (security_invoker = true) as
select
  'ALERTE un message vocal n''a pas ete conserve'::text as etat,
  m.id            as message_id,
  m.profile_id,
  m.envoye_a,
  c.peer_username as prospect
from ig_messages m
join ig_conversations c on c.id = m.conversation_id
where m.type_piece_jointe = 'audio'
  and m.envoye_a > now() - interval '48 hours'
  and m.cree_le  < now() - interval '15 minutes'
  and not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'ig-vocaux'
       and o.name = m.profile_id::text || '/'
                 || encode(substring(extensions.digest(m.mid, 'sha256') from 1 for 16), 'hex')
                 || '.m4a'
  );

comment on view public.ig_vocaux_sante is
  'Les messages vocaux recus dans les 48 dernieres heures dont le fichier n''a pas ete conserve. Vide quand tout va bien. Une capture ratee est une perte DEFINITIVE : Meta ne ressert jamais un vocal, meme quelques heures apres.';
