-- Alertes d'exploitation envoyees a l'administrateur, avec memoire anti-repetition.
--
-- Une alerte utile est une alerte qui n'arrive qu'une fois. Sans cette table, une
-- verification quotidienne enverrait le meme e-mail chaque matin pendant trois mois,
-- et il serait ignore des la troisieme fois — donc au moment ou il compte.
--
-- `cle` identifie le SEUIL, pas l'evenement : 'stockage_90j' et 'stockage_30j' sont deux
-- alertes distinctes, chacune envoyee une seule fois. Si la situation se resout (passage
-- au plan Pro, purge), la ligne est supprimee par la fonction elle-meme, ce qui rearme
-- l'alerte pour la prochaine fois. Aucun entretien manuel.
create table if not exists alertes_plateforme (
  cle          text primary key,
  envoyee_le   timestamptz not null default now(),
  contexte     text
);

alter table alertes_plateforme enable row level security;
-- Aucune politique : seule la clef de service (crons, routes serveur) y accede.
-- Ce n'est pas une donnee d'eleve, elle n'a rien a faire dans le navigateur.
