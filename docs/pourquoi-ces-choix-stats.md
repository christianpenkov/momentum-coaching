# Pourquoi ces choix — le raisonnement derrière les statistiques

Écrit le 2026-09-02, à la fin du chantier qui a produit le Parcours des leads,
l'attribution par rôles, le Click ID et les douze contrôles de santé.

**Ce document ne dit pas ce que fait la plateforme.** Ça, c'est dans
`perimetre-stats-referentiel.md` pour les règles, dans `AGENTS.md` pour l'exploitation,
et dans les commentaires du code pour le détail. Il dit **pourquoi ces décisions plutôt
que d'autres** — et surtout ce qu'on a failli faire à la place.

Il existe parce que dans six mois le résultat sera visible et le chemin invisible. Une
règle sans son motif se fait supprimer par la première personne qui la trouve gênante,
y compris son auteur.

---

## La question de départ était mal posée, et c'est ce qui a tout déclenché

La question initiale : **un prospect prend plusieurs lead magnets — lequel créditer ?**

Le réflexe est de trancher entre *premier touch* et *dernier touch*. On a passé du temps
sur ce débat avant de comprendre qu'il n'avait pas de bonne réponse, parce qu'il
répondait à une question que personne ne se pose vraiment.

Le cas réel qui l'a montré (profil de test, vente de 500 € du 08/07/2026) :

> Le prospect entre par le **post A** le 28/06. Il prend le lead magnet de **GUIDE** le
> 05/07. Il reprend celui de A le 06/07. Il répond enfin au hook de **A** le 08/07. Puis
> il réserve en rouvrant l'ancien lien Calendly de **GUIDE** qui traînait dans la
> conversation.

*Premier touch* dit A. *Dernier touch* dit GUIDE. Les deux sont défendables et les deux
sont inutiles, parce qu'un élève ne veut pas savoir « à qui attribuer cette vente ». Il
veut savoir **quoi refaire**. Et là, la réponse est double et précise : **A fait
parler**, **GUIDE fait réserver**. Ce sont deux informations différentes, toutes deux
vraies, et aucune ne mérite d'être écrasée par l'autre.

D'où les **trois rôles** — Acquisition, Activation, Conversion — qui ne s'additionnent
jamais. La règle vit dans `lib/attribution-roles.ts`.

**Ce qu'on a refusé :** un chiffre unique par contenu. C'est ce que tout le monde
attend, et c'est précisément ce qui aurait fait perdre l'information. Un contenu peut ne
faire entrer personne et produire des rendez-vous — quand des gens déjà présents
réservent par son lien. Un chiffre unique ne peut pas dire ça.

---

## Le premier vrai bug est venu d'un chiffre refusé, pas d'un test

Un écran affichait **5 clics et 7 calls bookés** pour un même lien. Chris a refusé le
chiffre : on ne peut pas réserver plus souvent qu'on ne clique.

Aucun test ne pouvait attraper ça. Chaque fonction était juste. Ce qui était faux, c'est
que le numérateur et le dénominateur ne portaient pas sur la même population — les
clics venaient d'une fenêtre, les calls d'une autre.

**Le réflexe qui en est sorti, et qui a servi tout le reste du chantier :** un taux qui
dépasse 100 % n'est jamais une erreur d'arrondi. C'est toujours deux populations
différentes présentées comme une seule. Trois des quatre pièges nommés du référentiel
ont été trouvés en tirant ce fil.

---

## Deux tableaux, parce que ce sont deux questions

**Parcours des leads** suit des **personnes**, en cohortes : de ceux qui sont entrés par
cette porte, combien sont allés jusqu'au bout. **Ce que fait chaque contenu** compte des
**événements** : qu'est-ce que ce contenu a produit au total, y compris pour des gens
arrivés par ailleurs.

La tentation était d'en faire un seul tableau. On ne l'a pas fait, et le motif est
visuel autant que logique : **en colonnes adjacentes, l'œil lit un enchaînement.** Mettre
« leads entrés » à côté de « conversations déclenchées » fait croire que les secondes
sont celles des premiers. Elles ne le sont pas. C'est la raison d'être des cartes de
rôles, où les trois chiffres sont empilés sans flèche ni pourcentage entre eux.

**Conséquence assumée :** les deux tableaux affichent des nombres différents pour ce qui
ressemble à la même chose. Ce n'est pas une incohérence à corriger, c'est la différence
entre compter des gens et compter des faits.

---

## Le no-show garde un grain différent de tous les autres compteurs, et c'est voulu

C'est la décision la moins intuitive de la plateforme, celle qu'on aura le plus envie de
« corriger » un jour.

- **« Rendez-vous »** = tous les créneaux posés. Ne sert **que** de dénominateur au
  no-show.
- **« Calls bookés » et « Calls honorés »** = des **opportunités**. Un 2ᵉ rendez-vous qui
  prolonge la même vente en est exclu.

Pourquoi cette exception : le no-show mesure la **fiabilité d'un créneau**. Un 2ᵉ
rendez-vous posé et non honoré est un créneau perdu, quelle que soit sa place dans le
parcours — et c'est la pratique du secteur, le show rate se calcule sur les créneaux
posés.

Alors que « calls bookés » mesure **ce que le contenu produit**. Un 2ᵉ rendez-vous n'est
produit par aucun nouveau clic. Le compter ferait passer le taux clics → calls au-dessus
de 100 % **structurellement et pour toujours** — le bug ci-dessus, réintroduit par
principe.

**Ce qui rend ce choix tenable :** le dénominateur du no-show est **écrit à côté du
taux**, il ne se déduit pas des calls bookés. Sans ça, deux chiffres de la même page se
contrediraient sans explication.

---

## Deux dates sur le même écran, volontairement

Un rendez-vous **réservé le 29 août pour le 2 septembre** compte dans les **calls bookés
d'août** et dans le **cash de septembre**.

C'est la décision qui a l'air d'une erreur et qui n'en est pas. Un rendez-vous booké se
produit **au moment de la réservation** — c'est la production commerciale du mois. Une
vente se produit **au rendez-vous**. Deux faits, deux moments.

**Ce qu'on a essayé et abandonné :** tout aligner sur une date unique. Ça daterait la
vente **avant** le rendez-vous qui l'a produite — faux en permanence, là où le cas
inverse est rare.

Et une distinction que le code lui-même avait ratée : **rattacher un rendez-vous à une
porte d'entrée n'est pas la même question que dater son argent.** La première se répond à
la **réservation** (un lead magnet pris après coup ne peut pas avoir produit une
réservation déjà faite), la seconde à la **tenue**. Un commentaire du code affirmait le
contraire ; c'est ce qui a fait renommer le champ en `dateDeRattachement`, pour que le
nom porte la question et non sa provenance.

---

## Deux colonnes ignorent le sélecteur de période, volontairement

**Vues / call** et **Cash / vue** sont en all-time, depuis la publication du contenu.
Elles ne bougent pas quand on change de période. C'est le troisième choix
contre-intuitif de l'écran, et il aura l'air d'un bug.

Le motif : **les vues d'un contenu sont cumulatives.** Vérifié en base sur 64
instantanés — le compteur d'un post ne fait que monter, un post de juin en gagne encore
aujourd'hui. Les diviser par les rendez-vous d'une seule semaine compare un **total** à
un **extrait** : le chiffre bougerait à chaque changement de période sans que le contenu
ait rien fait de différent.

Ce que ça remplace était pire, et différemment selon la plateforme : côté Instagram, le
cumul du post à la fin de la période ÷ les calls de la période ; côté YouTube, les
**30 derniers jours** de vues (fixes, quelle que soit la période affichée) ÷ les calls de
la période. Sur une semaine, YouTube divisait donc 30 jours de vues par 7 jours de
rendez-vous. Deux incohérences différentes sous un même libellé — et **aucune ne
produisait un nombre absurde**, seulement un nombre plausible et faux.

**La règle qui en sort :** une colonne qui ignore le sélecteur de période doit
l'annoncer dans son en-tête. Sans ça, elle se lit comme ses voisines.

---

## Le cash vient de `deals`, jamais de `calls.revenue`

Les deux champs existent toujours et portent **deux faits différents** :
`calls.revenue` est ce que l'élève a **déclaré** dans son rapport, `deals.amount_total`
est ce qui est **contracté**.

Cas réel : le rendez-vous `TestBIO` porte 3 000 € d'un côté et 1 200 € de l'autre.

**Ce qu'on a refusé :** supprimer le champ redondant. L'écart entre les deux est
lui-même une information — c'est ce que surveille `ventes_sante_montants`. On ne
supprime rien, on lit le bon champ.

---

## Un trou, jamais un zéro

Règle générale de la plateforme : **un `0` affirme quelque chose, un trou dit « on ne
sait pas ».**

Appliquée partout où une mesure a commencé après le début de la période affichée : la
collecte Short.io, l'appui sur le bouton du DM1, les statistiques d'un compte Instagram
avant son passage en professionnel.

Le coût de l'erreur inverse est asymétrique, et c'est tout l'argument : afficher un tiret
là où la vraie valeur était zéro fait perdre une information mineure. Afficher un zéro là
où on ne mesurait pas fait prendre une **décision produit fausse** — « ce lead magnet ne
convertit pas, je le supprime », alors qu'on ne le mesurait simplement pas.

---

## Sur un lien partagé, l'unité utile est le clic, pas la personne

Un lien de bio ou de description est cliqué par des anonymes. On a construit un **Click
ID** : un identifiant par clic, transmis à Calendly, restitué au webhook, écrit sur le
rendez-vous.

**Ce qu'on a explicitement refusé de faire :**

- **Identifier la personne.** Le même humain qui clique deux fois produit deux
  identifiants, et c'est voulu. Le but est de relier un clic à une réservation, pas de
  reconstituer un visiteur.
- **Poser un cookie.** Depuis 2026, les navigateurs purgent le stockage d'un domaine qui
  n'apparaît que dans des chaînes de redirection. Un domaine de redirection pure est
  exactement ce cas. Un identifiant dans l'URL n'est pas concerné.
- **Reconstruire l'historique.** Il reste anonyme définitivement. On n'a pas cherché à
  inventer rétroactivement ce qui n'a pas été mesuré.

**Et un principe de conception qui vaut au-delà :** la redirection part **toujours**,
même si l'écriture en base échoue. Une panne de la base ne doit jamais empêcher un
prospect de réserver. La mesure ne passe jamais devant ce qu'elle mesure.

---

## Les journaux, jamais les fiches

`instagram_leads` porte une ligne par personne, et trois de ses champs sont **écrasés** à
chaque interaction. Ce n'est pas un défaut : ils décrivent un **état courant**, dont le
pipeline a besoin.

Le défaut est de s'en servir comme **compteur cumulé**. Mesuré : GUIDE affichait 1 call
et 500 € avec 0 commentaire et 0 conversation, parce qu'un commentaire ultérieur sur un
autre post l'avait effacé de la fiche.

**La règle qui en découle :** toute statistique cumulée lit un journal immuable
(`instagram_lead_lm_history`, `prospect_events`), jamais une fiche. Et
`lib/attribution-roles.ts` refuse **par construction** de recevoir une fiche — parce
qu'une règle qu'on peut contourner par inadvertance finit par l'être.

---

## Une surveillance vérifie une conséquence, jamais la règle

Onze contrôles de santé, et aucun ne réimplémente la règle qu'il surveille.

`ventes_sante_date` ne refait pas le calcul de la date de vente. Il vérifie une propriété
que le résultat doit nécessairement avoir : la date doit tomber **pile** sur la tenue
d'un rendez-vous du prospect. Un instant de saisie de rapport ne tombe jamais pile sur un
créneau.

**Pourquoi ce détour :** une surveillance écrite dans un second langage devient une
seconde source de vérité, et deux sources finissent toujours par diverger. Une
surveillance qui a dérivé est pire que pas de surveillance — elle rassure.

**Corollaire découvert le dernier jour :** quand la cause d'un échec se répare toute
seule, il ne faut pas la journaliser. 58 incidents s'étaient accumulés sans qu'aucune
donnée ne manque, et le journal en était devenu illisible. On surveille alors la
conséquence, avec un seuil exprimé en **nombre de cycles de réparation ratés**.

---

## Une fois où j'avais tort, et où le résultat l'a tranché

J'ai recommandé de servir YouTube depuis le Breakdown par source plutôt que depuis le
Parcours des leads, au motif qu'un tableau annonçant « personnes uniques » ne devait pas
héberger deux règles de comptage. Chris a demandé l'onglet YouTube dans le Parcours
quand même — « et si c'est vide, bah c'est vide ».

Il n'était pas vide : **3 rendez-vous et 1 000 €** y sont apparus.

Ce qu'il faut en retenir n'est pas que j'avais tort sur la cohérence du tableau — la
tension était réelle, et elle a été résolue en donnant à YouTube sa propre chaîne, plus
courte, avec un filet infranchissable entre les clics anonymes et les personnes. C'est
que **« ce sera probablement vide » n'est pas un argument**. Le construire coûtait une
demi-heure ; ne pas le construire rendait un canal entier invisible.

---

## Ce qu'il faut garder en tête avant de changer quoi que ce soit ici

1. **Un taux au-dessus de 100 % est toujours deux populations, jamais un arrondi.**
2. **Deux chiffres qui doivent s'accorder, dont un seul est visible depuis l'autre** —
   c'est la famille dont relèvent les quatre pièges nommés du référentiel. Aucun n'est
   visible à la relecture d'une fonction, parce qu'aucune fonction n'est fausse.
3. **Une règle recopiée est une règle qui divergera.** Dix des onze écarts corrigés le
   2026-08-19 venaient d'une règle déjà écrite ailleurs.
4. **Un commentaire qui justifie un choix est une hypothèse datée**, pas une preuve. Deux
   d'entre eux affirmaient l'inverse de la vérité au moment où on les a relus.
