-- Le dépôt des messages vocaux Instagram.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POURQUOI ON STOCKE, ALORS QUE LE PROJET NE STOCKE RIEN D'AUTRE            │
-- │                                                                           │
-- │ Toutes les autres pièces jointes d'un DM sont relues à la demande chez     │
-- │ Meta, sans rien garder : c'est le bon choix, ça ne coûte rien et rien ne   │
-- │ périme. Les vocaux sont la seule exception, et pas par confort — l'URL     │
-- │ d'un audio expire, et Meta ne la resert pas après coup. Le message         │
-- │ devient alors définitivement inaudible. C'était mesuré, pas supposé :      │
-- │ 4 messages sur 254 remontent `is_unsupported` et ne peuvent plus être      │
-- │ relus du tout.                                                            │
-- │                                                                           │
-- │ Décision de Chris le 2026-09-04 : capturer au passage du webhook, garder   │
-- │ 30 jours, et passer au plan supérieur le jour où le gigaoctet est plein.   │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ⚠️ AUCUNE politique n'est posée sur ce bucket, et c'est délibéré. Sans
--    politique, `anon` et `authenticated` ne peuvent rien y lire : seul le rôle
--    de service y accède, donc uniquement `/api/coach/ig-piece-jointe`, qui
--    vérifie d'abord que le coach est bien celui de l'élève et rend une URL
--    signée de 10 minutes. Une politique de lecture ouverte au coach aurait
--    dupliqué cette règle d'accès à un deuxième endroit, où elle aurait dérivé.
--
-- ⚠️ Le chemin est `<profile_id de l'élève>/<empreinte du mid>.m4a`. Le premier
--    segment est ce qui permet à la révocation d'accord de supprimer les
--    fichiers d'UN élève sans toucher aux autres — la cascade des clés
--    étrangères n'atteint pas le stockage, il faut lister et supprimer à la
--    main (`app/api/client/ig-dm-consentement/route.ts`).
--
-- ⚠️ L'empreinte est un SHA-256 tronqué à 16 octets, calculé à l'identique à
--    TROIS endroits : ici (rien), le worker qui écrit, la route qui lit. Un
--    `mid` Meta contient des caractères que le stockage refuse dans un nom de
--    fichier, d'où l'empreinte plutôt que le `mid` brut. Les trois
--    implémentations sont gelées par un test (`lib/igConversations.test.ts`) :
--    si elles divergent, la route cherche un fichier que le worker n'a pas
--    écrit sous ce nom, et le vocal est muet sans qu'aucune erreur ne parte.
--
-- La purge des 30 jours n'est PAS un job SQL : supprimer une ligne de
-- `storage.objects` ne supprime pas les octets. Elle vit dans
-- `app/api/instagram/purger-vocaux/route.ts`, appelée par poll-leads à 8 h.
-- Le plafond, lui, est surveillé par `stockage_fichiers_sante`.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ig-vocaux',
  'ig-vocaux',
  false,
  26214400,  -- 25 Mo : Meta plafonne un vocal bien en dessous, c'est une borne de sûreté
  array[
    'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/ogg', 'audio/webm',
    -- Meta sert parfois l'audio sans type déclaré : sans cette entrée, l'envoi
    -- serait refusé et le vocal perdu pour de bon.
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;
