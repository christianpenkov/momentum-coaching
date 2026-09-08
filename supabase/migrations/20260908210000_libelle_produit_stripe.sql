-- Le libellé du produit affiché sur la page de paiement Stripe.
--
-- Il était écrit en dur — « Accompagnement » — dans cinq fichiers. C'est
-- pourtant le mot que lit l'acheteur au moment de payer, puis chaque mois sur
-- son relevé bancaire, et il n'est plus modifiable une fois le paiement passé.
-- Tous les coachs ne vendent pas un accompagnement : un consultant vend une
-- prestation, un formateur une formation.
--
-- NOT NULL avec valeur par défaut plutôt que nullable : un libellé absent
-- partirait vide chez Stripe, et le client verrait une ligne sans nom sur son
-- relevé. Le défaut vaut aussi backfill — toutes les lignes existantes
-- reçoivent « Accompagnement », qui est exactement ce qu'elles produisaient.
--
-- Liste fermée côté application (lib/libelleProduit.ts) et non CHECK ici : la
-- liste est un choix produit qui bougera, et une contrainte en base
-- demanderait une migration à chaque mot ajouté. Le lecteur retombe de toute
-- façon sur le défaut si la valeur ne fait pas partie de la liste.

alter table public.profiles
  add column if not exists libelle_produit text not null default 'Accompagnement';

comment on column public.profiles.libelle_produit is
  'Nom du produit affiché au client sur la page de paiement Stripe et sur son relevé bancaire. Choisi dans Réglages parmi la liste de lib/libelleProduit.ts.';
