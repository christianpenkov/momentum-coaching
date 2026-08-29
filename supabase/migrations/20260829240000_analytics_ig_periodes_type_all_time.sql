-- Troisieme type de periode : `all_time`.
--
-- Pourquoi elle ne peut pas se deduire des autres : la deduplication de Meta ne
-- s'additionne PAS d'une periode a l'autre. Mesure sur le profil de test :
-- juin (120) + juillet (143) + aout (122) = 385, alors que la mesure reelle sur la
-- fenetre complete 09/06 -> 29/08 rend 207. Une somme de mois surestime donc de
-- 86 %, et une somme de JOURS de 142 % (502 contre 207) — c'est ce dernier chiffre
-- que l'entonnoir affichait.
--
-- Elle est mesurable en UN appel : Meta accepte une fenetre de 81 jours (teste
-- contre l'API reelle le 2026-08-29). La vraie limite n'est pas la longueur mais la
-- retention d'environ 12 mois de la ventilation abonnes/non-abonnes — d'ou le
-- plafond de 366 jours cote cron.
--
-- L'index unique porte sur (profile_id, type, debut). Le `debut` d'une ligne
-- all_time GLISSE des que le plafond de 12 mois se deplace : viser un `debut`
-- precis pour la remplacer laisserait une ligne orpheline de plus chaque jour. Le
-- cron supprime donc TOUTES les lignes all_time du profil avant d'inserer.
alter table analytics_ig_periodes
  drop constraint if exists analytics_ig_periodes_type_check;

alter table analytics_ig_periodes
  add constraint analytics_ig_periodes_type_check
  check (type = any (array['semaine'::text, 'mois'::text, 'all_time'::text]));
