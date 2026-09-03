-- Fermer l'insertion anonyme dans sw_logs.
--
-- La policy « anon insert sw_logs » (WITH CHECK true) laissait n'importe qui,
-- avec la clé anon publique du bundle, insérer sans limite dans une table de
-- debug — plus vite que la purge quotidienne n'efface, jusqu'au plafond des
-- 500 Mo du plan gratuit où la base passe en LECTURE SEULE : toute la
-- plateforme gelée par une table de logs (constat de l'audit PWA du
-- 2026-09-02, déjà documenté dans docs/pastille-et-sauts-accueil.md).
--
-- Le service worker v16 n'écrit plus en direct : il passe par /api/client-log
-- (cookie de session obligatoire, tailles bornées), qui insère en service role.
-- Un vieux SW v15 encore en place chez un élève voit simplement ses logs
-- refusés en silence (le fetch porte un catch vide) — les logs sont un confort,
-- jamais une condition — et il sera remplacé à la prochaine ouverture de l'app
-- (sw.js est servi en no-store).

drop policy if exists "anon insert sw_logs" on public.sw_logs;
revoke insert on public.sw_logs from anon, authenticated;
