-- `auto` se lit « choix automatique » autant que « prelevements automatiques »
--
-- Releve par Chris dans l'heure qui a suivi la migration precedente : « fais
-- gaffe avec auto qu'il ne croit pas que c'est auto en mode choix auto et que
-- c'est prelevements auto ».
--
-- Le mot est lu par des humains — en SQL, dans les vues de sante, dans les
-- journaux — loin du code qui lui donne son sens. Un moyen d'encaissement nomme
-- `auto` invite a comprendre « la plateforme a choisi toute seule », c'est-a-dire
-- l'exact contraire de ce que la colonne enregistre : un choix DELIBERE de
-- l'eleve.
--
-- Corrige maintenant parce qu'aucun code applicatif n'a encore ecrit cette
-- valeur — seule une ligne rattrapee par le backfill la portait. Dans une
-- semaine, la renommer aurait demande de retrouver tous les lecteurs.
--
-- ⚠️ L'ordre compte : la contrainte doit tomber AVANT la mise a jour, sinon
-- `prelevement` est refuse par l'ancienne liste de valeurs.
alter table public.deals drop constraint if exists deals_moyen_encaissement_check;

update public.deals set moyen_encaissement = 'prelevement'
 where moyen_encaissement = 'auto';

alter table public.deals
  add constraint deals_moyen_encaissement_check
  check (moyen_encaissement in ('lien', 'prelevement', 'offline'));

comment on column public.deals.moyen_encaissement is
  'PAR QUEL MOYEN cette vente s''encaisse, tel que l''eleve l''a CHOISI : `lien` '
  '(lien de paiement), `prelevement` (prelevements automatiques), `offline` (hors '
  'Stripe). NULL = jamais choisi, et non « aucun moyen » — un ecran qui lit NULL '
  'doit proposer de choisir. Complement de `payment_plan`, qui repond a COMBIEN DE '
  'FOIS. ⚠️ La valeur s''appelait `auto` pendant une heure le 2026-09-05 : elle se '
  'lisait « choix automatique », soit l''inverse de ce que la colonne enregistre.';
