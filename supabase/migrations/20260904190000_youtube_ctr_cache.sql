-- Le CTR YouTube était recalculé à chaque affichage des stats, contre un quota tendu.
--
-- ── Ce qui a motivé cette table ────────────────────────────────────────────────────
--
-- Alerte Google Cloud du 2026-09-04 à 18:42 UTC : `FreeQuotaRequestsPerMinutePerProject`
-- sur `youtubereporting.googleapis.com`, observée à **1,0667 — soit 64 requêtes/minute
-- pour un quota de 60**. C'est le seul quota tendu de toute la pile YouTube ; les deux
-- autres (Data API 10 000/jour, Analytics 100 000/jour) sont sous les 1 %.
--
-- La cause n'était PAS un cron. `fetchCtrByVideo`, dans `app/api/youtube/stats/route.ts`,
-- émet à chaque affichage de l'écran de statistiques :
--
--     1 appel   /v1/jobs
--     1 appel   /v1/jobs/{id}/reports
--    30 téléchargements EN PARALLÈLE   (`.slice(0, 30)` + `Promise.all`)
--   ──────────────────────────────────
--    32 requêtes Reporting par chargement de page
--
-- Deux chargements dans la même minute donnent 64. La valeur de l'alerte tombe au
-- chiffre près.
--
-- ⚠️ Le bornage posé le 2026-09-02 (6 rapports par passage, 2 téléchargements
-- simultanés) existe bien dans `supabase/functions/poll-leads/index.ts` ET dans sa
-- jumelle `lib/yt-fetch.ts` — mais **jamais dans cette route de lecture**. C'est
-- exactement le « chemin qui a échappé à la borne » que le runbook de l'alerte
-- anticipait. Un garde-fou posé sur les chemins d'écriture ne couvre pas les chemins de
-- lecture, et rien ne le signalait.
--
-- ── Pourquoi une table, alors qu'un cache existait déjà ────────────────────────────
--
-- La route porte déjà un cache mémoire de 5 minutes (`cacheParProfil`), posé pour le
-- quota de la Data API. Il ne pouvait pas empêcher ceci, et son propre commentaire le
-- dit : « le cache est PAR INSTANCE serverless. Il ne garantit rien, il écrête ».
--
-- Deux chargements servis par deux instances Vercel différentes paient donc chacun leurs
-- 32 appels, et un démarrage à froid aussi. Pour un quota exprimé PAR MINUTE et PAR
-- PROJET Google — donc partagé par tous les élèves — un cache local ne borne rien.
--
-- Celui-ci est partagé et persistant : une seule instance paie le calcul, toutes les
-- autres le lisent.
--
-- ── Pourquoi 6 heures, et pourquoi ça ne coûte aucune fraîcheur ────────────────────
--
-- Les rapports Reporting sont JOURNALIERS et arrivent avec ~2 jours de retard (« CTR,
-- ~J-2 », runbook de l'alerte). Une valeur recalculée 4 fois par jour est donc déjà
-- huit fois plus fraîche que la donnée elle-même. Un TTL plus court ne rendrait rien
-- plus juste : il repaierait 32 appels pour relire le même rapport de la veille.
--
-- ⚠️ Ce qui N'EST PAS fait, volontairement : on ne change RIEN au calcul. Toujours les
-- 30 rapports les plus récents, même agrégation, même valeur affichée. Réduire la
-- fenêtre à 6 rapports — la borne des chemins d'écriture — aurait corrigé le quota en
-- faussant une métrique auditée : les impressions sont SOMMÉES sur la fenêtre, donc
-- moins de rapports donne moins d'impressions. On corrige le nombre d'appels, jamais le
-- résultat.
--
-- ── Risque résiduel, assumé et mesurable ───────────────────────────────────────────
--
-- Un coach qui ouvre les statistiques de K élèves « à froid » dans la même minute paie
-- K × 32 appels. Le cache n'y peut rien — c'est K premiers calculs distincts. La borne
-- de concurrence posée dans la route (3 téléchargements simultanés au lieu de 30) étale
-- chaque calcul, ce qui réduit la pointe sans la supprimer.
--
-- Aller plus loin supposerait un agrégat incrémental (ne télécharger que les rapports
-- pas encore repliés), ce qui ferait glisser la fenêtre des « 30 derniers » vers « tout
-- l'historique » et changerait donc la valeur. Ne pas s'y lancer sans une mesure qui le
-- justifie : le cas observé le 2026-09-04 était un rechargement répété du MÊME écran,
-- que ce cache supprime entièrement.

create table if not exists public.youtube_ctr_cache (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  payload    jsonb not null,
  calcule_a  timestamptz not null default now()
);

comment on table public.youtube_ctr_cache is
  'Cache PARTAGE du CTR par video, alimente par app/api/youtube/stats. Une ligne par '
  'eleve, ecrasee. Existe parce que le quota Reporting (60 requetes/minute, PAR PROJET '
  'Google donc partage par tous les eleves) etait sature par des rechargements de page : '
  '32 appels par affichage. La donnee source a ~2 jours de latence, un TTL de 6 h ne '
  'perime donc rien. Ne jamais y stocker autre chose que le resultat exact du calcul de '
  'la route : c''est un cache, pas une source.';

comment on column public.youtube_ctr_cache.payload is
  'Le Record<video_id, ctr_moyen_en_%> rendu tel quel par fetchCtrByVideo. Forme libre '
  'et volontairement non contrainte : si le calcul de la route change, une entree '
  'perimee est simplement remplacee au prochain passage.';
comment on column public.youtube_ctr_cache.calcule_a is
  'Instant du calcul, pas de la derniere lecture. C''est lui qui porte le TTL.';

-- ── Fermeture des accès ────────────────────────────────────────────────────────────
--
-- Cette table n'est JAMAIS lue par le navigateur : seule la route serveur y touche, avec
-- la clé de service, qui contourne la RLS. On n'a donc besoin d'AUCUNE politique — et
-- une table sans politique ne rend aucune ligne à qui n'est pas `service_role`.
--
-- ⚠️ Les deux lignes ci-dessous sont nécessaires ENSEMBLE, et c'est le motif déjà posé
-- ailleurs dans ce dépôt. Les privilèges par défaut de Supabase sur le schéma `public`
-- accordent `ALL` à `anon` et `authenticated` sur toute table NOUVELLE, sans qu'aucun
-- `grant` n'apparaisse dans la migration : sans le `revoke`, la table serait accessible.
-- Et sans la RLS, elle apparaîtrait immédiatement dans `acces_sante_lecture`, qui alerte
-- par e-mail. Le `revoke` seul ne suffit pas non plus : il ne se maintient pas, alors que
-- l'invariant « toute relation lisible applique la RLS », lui, tient tout seul.
alter table public.youtube_ctr_cache enable row level security;
revoke all on public.youtube_ctr_cache from anon, authenticated;
