-- La liste des libellés passe de sept entrées à quatre.
--
-- Arbitrage de Chris, quelques heures après la première version : deux mots qui
-- décrivent la MÊME vente ne doivent pas faire deux entrées. « Accompagnement »
-- et « Coaching » sont réunis, « Prestation » et « Services » deviennent
-- « Prestation de service », « Consultation » devient « Consulting », et
-- « Programme » disparaît — il ne dit pas ce qui est vendu.
--
-- ⚠️ Pourquoi cette migration existe alors que le code retombe déjà sur le
-- défaut quand la valeur lue n'est pas dans la liste : parce que ce repli
-- MASQUE l'écart au lieu de le corriger. Les lignes garderaient « Accompagnement »
-- en base pendant que l'application affiche et envoie « Accompagnement /
-- Coaching ». Deux vérités pour un même champ, dont une invisible — c'est
-- exactement ce qui produit les écarts qu'on ne comprend plus six mois après.
--
-- On réécrit donc les lignes existantes avec la valeur que le nouveau code
-- produit, et on aligne le défaut de la colonne. Aucun libellé retiré n'était
-- utilisé : la colonne existe depuis quelques heures et ne porte que le défaut.

alter table public.profiles
  alter column libelle_produit set default 'Accompagnement / Coaching';

update public.profiles
   set libelle_produit = 'Accompagnement / Coaching'
 where libelle_produit in ('Accompagnement', 'Coaching', 'Programme');

update public.profiles
   set libelle_produit = 'Prestation de service'
 where libelle_produit in ('Prestation', 'Services');

update public.profiles
   set libelle_produit = 'Consulting'
 where libelle_produit = 'Consultation';
