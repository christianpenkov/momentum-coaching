-- Le bucket `resources` n'est plus enumerable par n'importe qui
--
-- ⚠️ POURQUOI — audit d'isolation du 2026-09-04 (docs/isolation-multi-coach.md)
--
-- La policy `public_read_resources` ne portait AUCUNE condition de proprietaire :
--
--   for select using (bucket_id = 'resources')
--
-- Mesure, en simulant un utilisateur qui ne possede rien : il listait les 14 fichiers,
-- soit la totalite. Les buckets prives, eux, rendaient bien 0.
--
-- Sans consequence tant qu'il n'y a qu'UN coach : les 14 fichiers sont les siens. Le
-- jour ou un deuxieme coach existe, n'importe quel coach et n'importe quel eleve de
-- n'importe quel coach peut enumerer puis telecharger ses supports de cours —
-- c'est-a-dire le produit qu'il vend.
--
-- Ce n'etait pas un oubli : le bucket est public volontairement (docs/security-notes.md,
-- « contenu deja destine a etre visible largement »). Mais cette decision a ete prise
-- quand il n'y avait qu'un coach. Elle n'a jamais ete un arbitrage multi-locataire.
--
-- C'est le mode de panne caracteristique du locataire unique : un filtre oublie est
-- INVISIBLE tant qu'il n'y a qu'un locataire, parce que tout ce qu'on voit nous
-- appartient de toute facon.
--
-- ── Ce que ce correctif ferme, et ce qu'il ne ferme PAS ───────────────────────────
--
-- ✅ Il ferme l'ENUMERATION : on ne peut plus demander « quels fichiers existent ? ».
-- ❌ Il ne ferme PAS l'acces par URL connue : le bucket reste PUBLIC, donc
--    `/storage/v1/object/public/resources/<coach>/<fichier>` continue de servir le
--    fichier sans authentification. Fermer cela suppose de passer le bucket en prive
--    et de basculer sur des URL signees (comme `chat-medias`), ce qui casserait les
--    lignes de `resources.file_url` qui portent une URL absolue.
--    DEUX CHANTIERS DISTINCTS — ne pas croire celui-ci plus large qu'il n'est.
--
-- ── Pourquoi ca ne casse rien ────────────────────────────────────────────────────
--
-- L'application n'enumere JAMAIS ce bucket. Verifie : elle n'en fait que deux usages,
-- `getPublicUrl` (construction d'URL cote client, qui ne consulte aucune policy
-- puisque le bucket est public) et `remove` (couvert par `coaches_delete_own_resources`,
-- deja cloisonnee). La policy de lecture ne servait donc qu'a l'enumeration.
--
-- La branche « eleve » est conservee par prudence : les eleves lisent par URL publique
-- et n'en ont pas besoin aujourd'hui, mais la retirer rendrait le correctif plus strict
-- que necessaire, donc plus susceptible de casser un usage futur legitime.
--
-- ⚠️ Structure des chemins, mesuree et non supposee : `<uuid du coach>/<fichier>`.
-- Les 14 objets la respectent, et l'uuid correspond bien a un profil existant.

drop policy if exists "public_read_resources" on storage.objects;

create policy "resources lisible par le coach proprietaire et ses eleves"
on storage.objects for select
using (
  bucket_id = 'resources'
  and (
    -- le coach proprietaire du dossier
    (storage.foldername(name))[1] = auth.uid()::text
    -- ou un eleve de ce coach
    or exists (
      select 1 from public.clients c
      where c.coach_id::text = (storage.foldername(name))[1]
        and c.profile_id = auth.uid()
    )
  )
);
