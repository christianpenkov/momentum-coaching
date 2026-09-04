-- Les messages d'un fil, avec l'état réel de leur vocal.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POURQUOI L'ÉCRAN DOIT LE SAVOIR AVANT LE CLIC                             │
-- │                                                                           │
-- │ Un vocal non conservé n'est pas « à afficher », il n'existe plus. Proposer │
-- │ « Afficher » puis répondre « ce vocal n'a pas été conservé » fait payer un │
-- │ aller-retour pour une déception, et laisse croire à une panne.             │
-- │                                                                           │
-- │ Vérifié le 2026-09-04 par DEUX chemins d'API indépendants — l'objet        │
-- │ message et l'expansion du fil — sur trois vocaux dont un vieux d'une       │
-- │ heure : `is_unsupported: true`, `attachments: null`. La charge utile du    │
-- │ webhook est la seule fenêtre, et elle ne se rouvre pas.                     │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ⚠️ `vocal_conserve` est DÉRIVÉ, jamais stocké. Une colonne écrite à la capture
--    serait vraie le jour même et fausse trente jours plus tard, quand la purge
--    emporte le fichier sans que personne ne pense à la mettre à jour. C'est la
--    même règle que la visibilité d'un fil dans ce chantier, et que la leçon
--    d'`instagram_leads` : une copie que personne ne confronte à sa source finit
--    par mentir.
--
-- ⚠️ `security_invoker = true` : la RLS d'`ig_messages` continue de décider quelles
--    lignes sortent. La vue n'élargit RIEN, elle ajoute une colonne.

/**
 * Le fichier d'un vocal est-il encore là ?
 *
 * ⚠️ SECURITY DEFINER, et c'est OBLIGATOIRE ici. `storage.objects` porte sa
 * propre RLS, et le bucket `ig-vocaux` n'a volontairement aucune politique :
 * personne d'autre que le rôle de service n'y voit quoi que ce soit. Une vue en
 * `security_invoker` interrogerait donc `storage.objects` avec les droits du
 * coach, ne verrait jamais rien, et répondrait « non conservé » pour TOUS les
 * vocaux — une panne silencieuse qui aurait l'air d'un fonctionnement normal.
 *
 * Ce qu'elle divulgue, dans le pire des cas : l'existence d'un fichier pour un
 * identifiant de message que l'appelant devrait déjà connaître. Un uuid ne
 * s'énumère pas, et la réponse est un booléen sans contenu.
 */
create or replace function public.vocal_ig_conserve(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from ig_messages m
      join storage.objects o
        on o.bucket_id = 'ig-vocaux'
       and o.name = m.profile_id::text || '/'
                 || encode(substring(extensions.digest(m.mid, 'sha256') from 1 for 16), 'hex')
                 || '.m4a'
     where m.id = p_message_id
  );
$$;

revoke execute on function public.vocal_ig_conserve(uuid) from public, anon;
grant execute on function public.vocal_ig_conserve(uuid) to authenticated, service_role;

create or replace view public.ig_messages_visibles
with (security_invoker = true) as
select
  m.id,
  m.conversation_id,
  m.profile_id,
  m.sortant,
  m.texte,
  m.type_piece_jointe,
  m.envoye_a,
  m.note,
  m.note_le,
  -- ⚠️ `null` pour tout ce qui n'est pas un vocal : c'est « la question ne se
  -- pose pas », pas « le fichier est absent ». Un `false` ferait afficher
  -- « non récupérable » sur une photo, qui elle se redemande très bien à Meta.
  case when m.type_piece_jointe = 'audio'
       then public.vocal_ig_conserve(m.id)
       else null end as vocal_conserve
from ig_messages m;

comment on view public.ig_messages_visibles is
  'Les messages, plus `vocal_conserve` : le fichier du vocal est-il encore la ? Derive a la lecture, jamais stocke — une colonne ecrite a la capture deviendrait fausse le jour de la purge a 30 jours. null = ce n''est pas un vocal.';
