-- Le filigrane du CTR YouTube sautait des rapports, en silence, depuis juin.
--
-- ── Le défaut ──────────────────────────────────────────────────────────────────────
--
-- `syncYtCtr` (poll-leads, et sa jumelle `lib/yt-fetch.ts`) retenait UN identifiant,
-- `last_report_id`, et reprenait « tout ce qui suit » dans une liste triée par `endTime` :
--
--     const lastIdx  = allReports.findIndex(r => r.id === lastReportId);
--     const enRetard = allReports.slice(lastIdx + 1);
--
-- Ça suppose que les rapports APPARAISSENT dans l'ordre de leurs données. **YouTube ne
-- garantit pas ça**, et ne le fait pas. Mesuré sur l'API réelle le 2026-09-04 :
--
--     données jusqu'au 30/08 → rapport créé le 02/09 13:18
--     données jusqu'au 31/08 → rapport créé le 01/09 22:16   ← créé AVANT
--
-- Le rapport du 31/08 est donc traité en premier, le filigrane se pose dessus, puis
-- celui du 30/08 apparaît — et se range AVANT le filigrane dans le tri par `endTime`.
-- `slice(lastIdx + 1)` ne le voit jamais. Il est perdu définitivement.
--
-- ⚠️ Le commentaire du code prévoyait déjà qu'un filigrane ne doit pas enjamber un
-- rapport EN ÉCHEC. Ce n'est pas le même mécanisme : ici le rapport n'a pas échoué, il
-- est arrivé en retard. Une garde écrite contre un mode de panne n'en couvre pas un autre.
--
-- ── L'ampleur, mesurée et non déduite ─────────────────────────────────────────────
--
-- L'algorithme est déterministe dès qu'on connaît l'ordre d'apparition — et `createTime`
-- le donne. Rejoué sur les 63 rapports réellement servis par l'API, le rejeu reconstruit
-- EXACTEMENT le filigrane observé en base (`20398779682`), ce qui valide le modèle.
--
-- Il révèle **7 rapports jamais traités** :
--
--     données 23/06 (créé 11/08)   données 30/06 (créé 07/07)
--     données 16/07 (créé 20/07)   données 27/07 (créé 29/07)
--     données 05/08 (créé 14/08)   données 26/08 (créé 30/08)
--     données 30/08 (créé 02/09)
--
-- Soit 7 journées d'impressions et de clics manquantes sur 63, ~11 % du CTR.
--
-- ⚠️ Et les deux chemins DIVERGEAIENT : `/api/youtube/stats` relit les 30 derniers
-- rapports directement chez Google, donc il les incluait. La même métrique valait deux
-- choses selon l'écran.
--
-- ── Le nouveau modèle ─────────────────────────────────────────────────────────────
--
-- On retient l'ENSEMBLE des identifiants traités, plus une position. « Ce rapport a-t-il
-- déjà été compté ? » est alors une question à laquelle on répond exactement, sans
-- dépendre d'un ordre que le fournisseur ne garantit pas.
--
-- ⚠️ C'est indispensable parce que `upsert_yt_ctr` **ADDITIONNE**
-- (`impressions + EXCLUDED.impressions`). Un rapport compté deux fois est une erreur
-- silencieuse et permanente. Le modèle positionnel avait d'ailleurs un second défaut du
-- même genre : filigrane introuvable (job recréé, ligne perdue) ⇒ `enRetard = tous les
-- rapports` ⇒ **60 rapports recomptés d'un coup**. L'ensemble supprime les deux.
--
-- ── L'amorçage, et pourquoi il est sûr ────────────────────────────────────────────
--
-- On inscrit les 56 rapports que le rejeu prouve traités — donc PAS les 7 sautés, qui
-- seront rattrapés tout seuls au prochain passage (bornés à 6 par passage : deux
-- passages suffisent).
--
-- Les deux profils YouTube pointent le même job (`a81fdf7b-…`, créé le 29/05/2026,
-- vérifié via l'API avec chacun des deux jetons) : c'est la même chaîne connectée deux
-- fois, donc la même liste de rapports et le même ensemble d'amorçage. On cible par
-- `last_report_id` plutôt que par identifiant de profil, ce qui rend l'amorçage
-- inopérant — et non faux — si l'état avait changé entre la mesure et l'application.
--
-- Les lignes NON amorcées (ici `dc6f6aec`, dont l'intégration YouTube n'existe plus)
-- sont traitées par le code : ensemble vide + ancien filigrane ⇒ il reconstitue un
-- ensemble prudent au premier passage, sans jamais recompter.

alter table public.youtube_ctr_sync_state
  add column if not exists rapports_traites text[] not null default '{}';

comment on column public.youtube_ctr_sync_state.rapports_traites is
  'Identifiants des rapports Reporting DEJA COMPTES. Remplace le filigrane positionnel '
  '`last_report_id`, qui sautait tout rapport cree hors de l''ordre de ses donnees — '
  '7 rapports perdus entre juin et septembre 2026. Ne JAMAIS y retirer un identifiant '
  'sans certitude : upsert_yt_ctr ADDITIONNE, donc un identifiant retire a tort fait '
  'recompter le rapport. `last_report_id` reste ecrit, pour le diagnostic seulement.';

-- Amorçage : les 56 rapports que le rejeu prouve traités. Les 7 sautés en sont absents
-- volontairement — c'est ce qui les fera rattraper.
update public.youtube_ctr_sync_state
set rapports_traites = array[
  '17491275563','17494847048','17498549551','17512444165','17518734077','17520656116',
  '17535049349','17539822485','17544883383','17545430218','17555370307','17557800961',
  '17561233705','17565150120','17566883966','17569151057','17571173461','17586245183',
  '17588703050','17592076476','20180937853','20186285100','20194085603','20201828315',
  '20206724095','20221003531','20224453873','20227126984','20237545909','20251055271',
  '20253749496','20257394783','20262939124','20266218972','20273585215','20278789762',
  '20281824305','20291923904','20294592917','20299520039','20302776756','20309811746',
  '20312377269','20316817300','20325234600','20334184902','20341467691','20348379885',
  '20355057036','20364442942','20375245306','20377274157','20383984778','20384684621',
  '20398779682','9904223426'
]
where last_report_id = '20398779682'
  and cardinality(rapports_traites) = 0;
