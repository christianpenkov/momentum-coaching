-- Correctif de 20260904140000 : `name` non qualifie ne designait pas la bonne table
--
-- ⚠️ LE PIEGE, et il vaut bien au-dela de cette policy.
--
-- La policy posee quelques minutes plus tot contenait :
--
--   or exists (
--     select 1 from public.clients c
--     where c.coach_id::text = (storage.foldername(name))[1]   -- ← `name` NON QUALIFIE
--       and c.profile_id = auth.uid()
--   )
--
-- L'intention : `storage.objects.name`, le chemin du fichier.
-- La realite : `public.clients` possede AUSSI une colonne `name`, et PostgreSQL resout
-- un nom non qualifie au scope le PLUS INTERNE. La sous-requete comparait donc le
-- dossier proprietaire au *nom du client*, ce qui est toujours faux.
--
-- **La branche « eleve » n'a donc jamais rien autorise.** Elle avait l'air d'une
-- protection, elle n'en etait pas une.
--
-- ── Pourquoi ca ne s'est pas vu tout seul ────────────────────────────────────────
--
-- Trois raisons qui se combinent, et c'est le vrai enseignement :
--
-- 1. La branche COACH fonctionnait. Le test « le proprietaire voit ses 14 fichiers »
--    passait, donc la policy avait l'air bonne.
-- 2. Les eleves n'en ont pas besoin : ils lisent par URL publique, qui ne consulte
--    aucune policy. Rien ne serait jamais tombe en panne.
-- 3. Le test manuel du predicat, ecrit a la main, qualifiait la colonne (`o.name`) —
--    il CORRIGEAIT le defaut sans le voir. Un test qui reecrit ce qu'il verifie ne
--    verifie rien.
--
-- Ce qui l'a trouve : `explain`. Le plan montrait `InitPlan` — donc une sous-requete
-- NON correlee, alors qu'elle etait censee dependre de chaque ligne — et le filtre
-- `(coach_id)::text = (storage.foldername(name))[1]` applique sur un scan de `clients`.
--
-- **Regle a retenir : dans une policy, toujours qualifier les colonnes de la table
-- protegee.** Une sous-requete introduit un scope ou n'importe quel nom commun
-- (`name`, `id`, `created_at`, `profile_id`) peut etre capture en silence.

drop policy if exists "resources lisible par le coach proprietaire et ses eleves" on storage.objects;

create policy "resources lisible par le coach proprietaire et ses eleves"
on storage.objects for select
using (
  bucket_id = 'resources'
  and (
    -- le coach proprietaire du dossier
    (storage.foldername(objects.name))[1] = auth.uid()::text
    -- ou un eleve de ce coach
    or exists (
      select 1 from public.clients c
      where c.coach_id::text = (storage.foldername(objects.name))[1]
        and c.profile_id = auth.uid()
    )
  )
);
