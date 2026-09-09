# Campagne de tests paiements en PRODUCTION — CLOSE le 2026-09-09

> Session des 8-9 septembre 2026. **Les quatre modes de paiement sont éprouvés en
> production réelle.** Ce document garde le pourquoi ; le quoi vit dans le code.
> Coût total : environ 1,80 € de frais Stripe.

---

## 1. Ce qui a été éprouvé, et ce qui ne le sera pas

| Mode | Éprouvé | Preuve |
|---|---|---|
| **A** — Prélèvement automatique (3×) | ✅ | Incogniton, `sub_1UDSqaGT…`, 1/3 encaissée le 8 sept |
| **B** — Comptant par lien | ✅ | Chris Penkov, payé puis remboursé |
| **C** — Un lien PAR ÉCHÉANCE (2×) | ✅ | Test Description, 2 liens distincts, 1/2 payée, 2/2 en attente |
| **D** — Hors Stripe (2×, 1 000 €) | ✅ | TestStory, versements partiels 500 + 480 + 20 |
| **Remboursement d'échéance d'abonnement** | ✅ | Incogniton, rattaché sous `ch_3UDSqX…` |
| Litiges | ❌ **volontairement** | Éprouvés en TEST dans les deux sens. En réel ils coûtent des frais non remboursables et incrémentent le **taux de litiges**, l'indicateur qui peut faire restreindre un compte Connect |
| `unexpected_payment_at` | ❌ inéprouvable | Demanderait une horloge de test Stripe |

### Le test qui comptait le plus

Le remboursement d'une échéance d'abonnement (`dd2b588c`) n'avait jamais été joué
autrement que sur une réparation SQL. **Il est validé sur le chemin réel.**

La difficulté est réelle et vaut d'être retenue : Momentum enregistre un paiement
d'abonnement sous un identifiant de **facture** (`in_…`), le remboursement arrive
sous une **charge** (`ch_…`), et **Stripe a retiré le lien charge ↔ facture**
(mesuré le 2026-08-31). Le rattachement ne tient qu'à la résolution du correctif.

---

## 2. Ce que la campagne a trouvé, et qui n'était pas cherché

Six défauts, tous découverts **en regardant l'écran** plutôt qu'en lisant le code.

### Le modèle des fins de vie était faux

`statutDeal` rendait `canceled` pour tout remboursement intégral. Le motif d'origine
(commit `91f74504`, 28 août) est juste — ne pas retomber en « en attente » et
relancer un client qu'on vient de rembourser — mais **`canceled` était une réponse
plus forte que le motif ne l'exigeait** : il efface aussi la vente du cash contracté
et devrait déclasser l'appel.

> « un remboursement intégral c'est pas une annulation de la vente […] tu peux pas
> annuler une vente si y a de l'encaissé, à ce moment-là c'est CLÔTURER une vente,
> et là ça reste dans le closing » — Chris, 2026-09-09

Trois états, trois causes, et le discriminant est une **intention** :

| Cas | Statut | Cash contracté | Closing |
|---|---|---|---|
| Annuler, rien encaissé | `canceled` | exclu | sort |
| Annuler **puis** rembourser | `canceled` | exclu | sort |
| Rembourser **sans** annuler | `ended` | compté | reste |
| Rembourser, **abonnement encore en vol** | `open` | compté | reste |

`deals.cancel_requested_at` est posée **au clic** sur « Annuler la vente », avant
tout remboursement. L'intention existait déjà ; elle n'était stockée nulle part, et
le webhook qui constatait le remboursement quelques minutes plus tard ne pouvait
pas la retrouver.

⚠️ **Le dernier cas est le moins évident.** En prélèvement automatique, Momentum ne
relance JAMAIS (`installment-reminders` écarte explicitement `installments_auto`,
l'échéancier vit chez Stripe). Le motif de la règle est donc sans objet, et son
coût bien réel : une vente figée en `ended` aurait signalé le prélèvement suivant
comme « paiement reçu sur une vente terminée ». La vente se termine d'elle-même
quand l'abonnement s'arrête — `customer.subscription.deleted`.

### Quatre écrans affirmaient ce qu'ils ne pouvaient pas savoir

Tous par la même forme : **un texte écrit d'avance au-dessus d'un groupe qui
mélange deux états.** Un en-tête est une affirmation universellement quantifiée sur
son contenu, alors qu'on l'écrit en pensant au cas typique.

- Fiche client : « le remboursement l'explique » et, six lignes plus bas, « 0,50 €
  encore à expliquer ». Le correctif de la veille avait appris `venteAnnulee` au
  bandeau et pas à la ligne du dessous.
- Relances, « En attente de paiement » : « Le lien est parti » au-dessus d'une ligne
  disant « à envoyer le 9 octobre », case *Envoyé* décochée.
- Relances, « Carte refusée » : « Stripe réessaie tout seul » — vrai uniquement en
  prélèvement automatique, alors que le groupe se remplit sur `cash.aEchoue`, qui ne
  regarde pas le mode. **La forme de mensonge la plus coûteuse : celle qui fait ne
  RIEN faire.**
- Relances, « Échéance à traiter » : promettait un envoi à des lignes hors Stripe
  qui n'ont aucun lien à envoyer.

La pastille de l'onglet comptait en plus les groupes dont le bandeau dit lui-même
« rien à faire pour l'instant ».

**La règle qui en sort** : un bandeau ne peut affirmer que ce qui est vrai de CHAQUE
ligne qu'il coiffe. Un groupe qui mélange deux états se scinde, ou son texte se
déduit de son contenu.

---

## 3. Les réflexes que cette campagne a validés

1. **Vérifier POURQUOI une règle existe avant de la corriger.** La règle du
   remboursement intégral avait l'air d'un oubli ; le commit qui l'a posée en donnait
   le motif, et supprimer la ligne aurait rouvert le défaut qu'elle fermait. La
   correction juste conserve le motif et retire seulement le surplus.

2. **Rendre obligatoire ce qui change la sémantique.** Le nouveau paramètre de
   `statutDeal` est requis, pas optionnel : le compilateur a énuméré les six
   appelants. Il en a désigné un que personne n'aurait cherché —
   `sync-stripe-payments` ne LISAIT pas la règle, il testait son RÉSULTAT
   (`=== 'canceled'`) pour déclencher ses effets de bord. Le nouvel état serait tombé
   hors de cette condition : liens de paiement restés payables pour toujours.
   **Élargir l'ensemble des valeurs de retour d'une règle casse tous ses lecteurs qui
   comparent à une valeur précise, sans qu'aucun ne mentionne la règle.**

3. **Le test réel trouve ce qu'aucune garde ne voit.** Les 788 tests passaient, `tsc`
   était propre, et le premier passage en production a montré `status = 'ended'`
   écrit sans `ended_by` / `ended_at` / `ended_reason` — la migration et le code
   vivant écrivaient deux états différents pour le même fait.

4. **Un avis extérieur se mappe sur le code avant d'être arbitré.** Cinq des huit
   recommandations d'une IA tierce existaient déjà sous d'autres noms, une aurait
   créé un second enum de statut, une était factuellement fausse sur ce dépôt. Une
   seule était neuve — et bonne : le **taux d'annulation croisé avec la source
   d'entrée**, qui reste à construire (voir §5).

---

## 4. Ce que Chris doit faire, et que personne d'autre ne peut faire

**Résilier les deux abonnements de test dans Stripe**, sinon ils prélèveront le
8 octobre (sans conséquence comptable, mais autant ne pas les laisser tourner) :

- `sub_1UDSqaGTiDefreGmzb1vdmb8` — Incogniton
- `sub_1UDWLEGTiDefreGmuqMAabXO` — TestYT

Le libellé est **« Résilier l'abonnement »** depuis la liste des abonnements,
**« Annuler »** depuis la fiche. Momentum passera les deux ventes en `ended` tout
seul en recevant `customer.subscription.deleted` — c'est le chemin nominal, et le
voir se produire vaut confirmation de plus.

**Répondre à « Dire pourquoi »** sur les trois ventes remboursées (Incogniton,
TestYT, Chris Penkov). Ce n'est pas une corvée : c'est la question que la plateforme
doit poser, et y répondre éprouve le dernier écran non testé de la chaîne.

---

## 5. Ce qui reste ouvert, et qui n'appartient plus à ce chantier

- **Le taux d'annulation par source d'entrée.** `deals.first_touch_content_id` et
  `attribution_source` sont déjà remplis. Aucun coach ne sait quelles ventes se
  rétractent, sur quelle source, sur quel contenu — et Momentum a déjà toute la
  donnée. C'est la seule idée neuve sortie de cette session.
- **`sync-calendly` tourne du code périmé** (constaté le 2026-09-09) : le commit
  `1f35b5f2` d'une autre session l'a modifié sans redéployer l'Edge Function.
  `select * from edge_sante_version;` le signale. Une Edge Function ne part pas avec
  `git push` — `npm run deployer-edge sync-calendly`.
- **La migration Quennel** — mémoire `project_roadmap_quennel`, et
  `docs/transfert-de-compte.md` §0 ter en premier.

---

## 6. Contraintes de travail — toujours valables

- **Français, toujours.**
- **Chris agit lui-même sur son Stripe.** Ne jamais créer, modifier ou annuler un
  objet Stripe sans une autorisation explicite pour ce geste précis.
- **Déploiement : `git push origin main`**, jamais `vercel deploy --prod`.
- **Vérifier la branche, committer avec un pathspec** — `git add` puis `git commit`
  a embarqué 9 fichiers d'une autre session le 8 septembre.
- **D'autres sessions travaillent sur le dépôt en parallèle.** Ne pas toucher à leurs
  fichiers ni corriger leur code cassé — le signaler à Chris.
- **Toute requête SQL sur `calls`** : `ignored is not true` **et** `call_type`
  explicite (`calendly` = vente, `google` = coaching).
- **Ne pas investiguer par les logs** — écrire en base et interroger en SQL.
- **Edge Functions** : `npm run deployer-edge`, vérifier par le **contenu du bundle**,
  puis `npm run empreintes-edge -- --depuis-head` et commiter le fichier.
- **`npm test` et `npx tsc --noEmit` avant chaque commit.**

⚠️ **Le compteur d'orphelins en SQL n'est pas celui de l'écran.** La route écarte les
jumeaux par empreinte `montant@seconde` : un même encaissement d'abonnement existe
sous `in_…` et `pi_…`. Lire `app/api/payments/route.ts:511`, ou demander à Chris ce
qu'il voit.
