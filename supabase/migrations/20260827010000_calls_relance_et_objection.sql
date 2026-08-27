-- Lot 2 de la refonte du pipeline leads (2026-08-27).
--
-- Deux champs que le rapport de vente va remplir, et qui n'existaient nulle part.
--
--   relance_at : quand recontacter ce lead. Saisi sur la branche « à recontacter »
--                du rapport. Le cycle de relance s'appuie dessus, mais ne le
--                stocke pas : le compteur vit dans prospect_events.cycle et la
--                sortie automatique est calculée (voir lib/pipelineStage.ts).
--
--   objection  : ce qui a bloqué. Six valeurs communes aux trois branches du
--                rapport (perdu, pas qualifié, à recontacter) — c'est la même
--                question posée à deux moments, seule la formulation change.
--                `objection_autre` porte le texte libre quand objection = 'autre'.
--
-- ── PAS DE BACKFILL, ET C'EST VOULU ───────────────────────────────────────────
--
-- La règle du projet veut qu'une nouvelle colonne parte avec son backfill dans la
-- même migration. Ici il n'y a rien à remplir : ni la date de relance ni
-- l'objection n'existent sous une autre forme dans les données passées. Les
-- déduire reviendrait à inventer. Un trou dit « on ne sait pas ».
--
-- ── AUCUNE CONTRAINTE À TOUCHER SUR outcome ───────────────────────────────────
--
-- Vérifié le 2026-08-27 : `calls.outcome` est un `text` sans CHECK. Les deux
-- nouvelles valeurs du chantier — 'lost' et 'not_qualified' — n'exigent donc
-- aucune migration de contrainte. Elles sont déclarées côté TypeScript dans
-- lib/rapportPatch.ts et traduites en issue par OUTCOME_TO_ISSUE.

alter table public.calls add column if not exists relance_at      timestamptz;
alter table public.calls add column if not exists objection       text;
alter table public.calls add column if not exists objection_autre text;

comment on column public.calls.relance_at is
  'Quand recontacter ce lead, saisi sur la branche « à recontacter » du rapport de vente. Le compteur de relances n''est PAS ici : il vit dans prospect_events (colonne cycle).';

comment on column public.calls.objection is
  'Ce qui a bloqué : une des six valeurs communes aux branches perdu / pas qualifié / à recontacter du rapport de vente. ''autre'' renvoie au texte libre de objection_autre.';

comment on column public.calls.objection_autre is
  'Texte libre saisi quand objection = ''autre''. Vide sinon.';

-- Retrouver rapidement les leads en attente de relance, sans scanner toute la table.
create index if not exists calls_relance_at_idx
  on public.calls (coach_id, relance_at)
  where (relance_at is not null and ignored is not true);
