-- ─────────────────────────────────────────────────────────────────────────────
-- La date de première détection d'un lead ne bouge plus jamais
--
-- `instagram_leads.detected_at` dit QUAND cette personne est entrée dans le
-- pipeline. Elle sert au tri « le plus ancien », à l'âge affiché sur une carte,
-- et à toute fenêtre de période qui filtre sur l'arrivée d'un lead.
--
-- ── CE QUI EST ARRIVÉ ────────────────────────────────────────────────────────
--
-- Un upsert du webhook réécrivait la ligne entière à chaque nouvelle prise, y
-- compris cette date. Deux fiches ont dérivé sur le profil de test :
--
--   rdjdkzjd        portait le 6 juillet — la date de sa 7e prise sur 8,
--                   alors qu'il est arrivé le 28 juin
--   incogniton.734  portait une date qui ne correspondait à AUCUNE de ses
--                   prises, exactement deux jours après la vraie
--
-- Le symptôme est passé inaperçu longtemps, puis a fait rater un lead au taux
-- d'activation des lead magnets — corrigé là-bas, pas ici.
--
-- Les deux chemins d'écriture ont été réparés le 2026-08-19 (commit 1a55345) :
-- ils font désormais `existingLead?.detected_at ?? maintenant`, donc ils
-- préservent. Les deux lignes fausses ont été remises d'aplomb le 2026-09-03.
--
-- ── POURQUOI CE GARDE MALGRÉ TOUT ────────────────────────────────────────────
--
-- Parce que la garantie vit dans le code applicatif, RÉPÉTÉE à deux endroits.
-- Elle tient à ce que quelqu'un ait pensé à écrire `?? existant` — et un
-- cinquième chemin d'écriture (un import, une reprise, une nouvelle source de
-- leads) qui l'oublierait ramènerait le défaut EN SILENCE, exactement comme la
-- première fois.
--
-- Une règle en base, elle, ne s'oublie pas et ne se contourne pas depuis le
-- code. C'est ce que demande l'objectif du projet : zéro maintenance, donc rien
-- qui repose sur la vigilance de quelqu'un dans deux ans.
--
-- ── POURQUOI EN SILENCE, ET NON UNE ERREUR ───────────────────────────────────
--
-- Lever une exception ferait échouer TOUT l'upsert du webhook — une nouvelle
-- prise de lead magnet ne serait plus enregistrée du tout, à cause d'une colonne
-- qu'on voulait simplement laisser tranquille. Le remède serait pire que le mal.
-- On garde donc l'ancienne valeur et on laisse le reste de l'écriture passer.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.figer_detected_at()
returns trigger
language plpgsql
as $$
begin
  -- `is distinct from` et non `<>` : `<>` rend NULL quand un côté est NULL, et la
  -- condition ne se déclencherait pas sur une tentative de mise à NULL.
  if OLD.detected_at is not null
     and NEW.detected_at is distinct from OLD.detected_at
     -- L'échappement pour une correction délibérée, voir plus bas.
     and coalesce(current_setting('app.detected_at_modifiable', true), 'off') <> 'on'
  then
    NEW.detected_at := OLD.detected_at;
  end if;
  return NEW;
end;
$$;

comment on function public.figer_detected_at() is
  'Empeche toute modification de instagram_leads.detected_at une fois posee. Pour corriger une date deliberement : set local app.detected_at_modifiable = ''on'' dans la meme transaction.';

drop trigger if exists instagram_leads_fige_detected_at on public.instagram_leads;

-- BEFORE UPDATE couvre aussi les UPSERT : un `insert … on conflict do update`
-- declenche bien ce trigger sur la branche de mise a jour.
create trigger instagram_leads_fige_detected_at
  before update on public.instagram_leads
  for each row
  execute function public.figer_detected_at();

-- ── CORRIGER UNE DATE DELIBEREMENT ───────────────────────────────────────────
--
--   begin;
--     set local app.detected_at_modifiable = 'on';
--     update instagram_leads set detected_at = '…' where id = '…';
--   commit;
--
-- `set local` meurt avec la transaction : l'echappement ne peut pas rester
-- ouvert par megarde.
--
-- Aucun backfill ici : les deux lignes concernees ont deja ete remises d'aplomb.
