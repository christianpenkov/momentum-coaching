# Le clavier mobile dans les modales

> Écrit après six corrections successives qui ont toutes échoué (2026-09-03 →
> 2026-09-04, commits `939be7a` → `e97a128`). Le but de cette page est qu'il n'y
> en ait plus jamais six : **la recette d'abord, les pièges ensuite, et
> l'instrument qui tranche quand ça résiste.**

---

## La recette — à suivre telle quelle

Pour toute feuille mobile qui contient un champ de saisie :

```tsx
const { hauteur: clavier, dessus, visible } = useHauteurClavier();

<div style={{
  position: 'fixed', left: 0, right: 0, zIndex: 10009,

  // Clavier fermé : feuille ancrée en bas, coins arrondis.
  ...(clavier > 0 ? null : { bottom: 0 }),
  borderTopLeftRadius:  clavier > 0 ? 0 : 18,
  borderTopRightRadius: clavier > 0 ? 0 : 18,

  // Clavier ouvert : la feuille occupe EXACTEMENT la zone visible.
  ...(clavier > 0
    ? { top: dessus, height: visible }
    : { maxHeight: '90vh' }),

  display: 'flex', flexDirection: 'column', overflow: 'hidden',
}}>
```

Plus, dans le corps de la feuille :

- la zone de contenu en `overflow-y: auto; flex: 1; minHeight: 0` ;
- un `scrollIntoView({ block: 'center' })` sur `focusin`, **rejoué après ~300 ms**
  (le clavier déplace le sol pendant son animation) ;
- le pied de page **masqué quand `clavier > 0`** (voir piège 5).

Références : [`lib/useHauteurClavier.ts`](../lib/useHauteurClavier.ts),
[`lib/hauteurClavier.ts`](../lib/hauteurClavier.ts) (le calcul, avec son test),
[`components/payments/ModaleAction.tsx`](../components/payments/ModaleAction.tsx)
(le montage complet).

---

## La règle qui gouverne tout

> **Toute valeur qui entre dans un calcul réactif doit avoir un événement qui
> annonce son changement.**

Sinon le calcul est juste au premier passage et **faux pour toujours ensuite, en
silence**. C'est la cause racine de l'affaire entière, et elle dépasse largement
le clavier.

---

## Les six pièges, dans l'ordre où on tombe dedans

### 1. `window.innerHeight` — le piège central

**Ne jamais l'utiliser pour calculer une hauteur de clavier.**

Mesuré sur iPhone, à 16 ms d'écart :

```
3482 ms   innerHeight 394   visualViewport.height 394   → clavier calculé = 0
3498 ms   innerHeight 797   visualViewport.height 394   → clavier calculé = 403
```

iOS écrase **aussi** `window.innerHeight` pendant l'animation du clavier. Les
deux valeurs deviennent égales, leur différence vaut zéro, le clavier devient
indétectable. Puis `innerHeight` est restauré — et **sa restauration n'émet aucun
événement**, puisque `visualViewport` n'a pas bougé. Le hook reste figé sur ce
zéro pour toujours.

*Symptôme* : la feuille flashe en plein écran, retombe, et n'y revient que si on
scrolle à la main (le `scroll` force une nouvelle mesure).

**À la place** : auto-étalonnage. On retient `vv.height` pendant qu'aucun champ
n'est focalisé, et le clavier vaut ce qui manque. Aucun nombre en dur, donc
valable sur toutes les tailles d'écran, et réétalonné à chaque fermeture — ce qui
absorbe la rotation et la barre d'URL.

### 2. Ne pas déduire l'ouverture d'un écart de pixels

« Le clavier est-il ouvert ? » a une réponse directe : **un champ est-il
focalisé** (`focusin` / `focusout`). La déduire d'un écart supposait un seuil,
donc une hypothèse sur la taille de l'appareil — fragile sur un autre téléphone,
et muette quand on passe d'un champ à l'autre, moment où aucune hauteur ne change.

⚠️ Sur `focusout`, lire `document.activeElement` **après un tour de boucle**
(`setTimeout(…, 0)`) : l'événement part avant que le focus suivant soit posé, et
on annoncerait une fermeture entre deux champs — la feuille clignoterait.

### 3. Redimensionner sur `hauteur > 0`, pas sur le focus

`ouvert` est vrai **dès le focus**, alors que la zone visible n'a pas encore
rétréci. `height: visible` vaut alors la hauteur pleine : la feuille s'étire sur
tout l'écran, puis retombe quand le clavier arrive. Deux sauts au lieu d'un.

```
1955 ms   vvH797   top0 h797   ← focus : la feuille prend TOUT l'écran
2136 ms   vvH394   top0 h394   ← le clavier arrive, elle retombe
```

`hauteur > 0` n'est vrai qu'une fois le clavier réellement monté, et il implique
`ouvert`. Même signal, au bon moment.

### 4. `top: dessus`, jamais `top: 0`

iOS peut **décaler** la zone visible en plus de la rétrécir
(`visualViewport.offsetTop`). `position: fixed` se cale sur le viewport de mise
en page, qui ne bouge pas : à `top: 0` la feuille se pose au-dessus de l'écran et
son titre est coupé.

⚠️ Mais `offsetTop` sert au **positionnement uniquement**. Le soustraire de la
hauteur (erreur du commit `f7c9956`) rejoue le piège 1. Il vaut 0 sur l'iPhone de
test — donc une correction fondée dessus peut sembler plausible tout en n'ayant
aucun effet.

### 5. La barre d'accessoires iOS n'est pas comptée

« Préremplir le contact », les suggestions : cette barre flotte **au-dessus** du
clavier et n'entre pas dans `visualViewport.height`. Elle recouvre donc le bas de
la feuille. D'où le pied de page masqué pendant la saisie — ce qui est aussi le
bon geste en soi : on ne valide pas pendant qu'on écrit.

### 6. `vh`, `dvh`, `svh` : aucune ne convient

Aucune unité de viewport ne rétrécit avec le clavier de façon fiable sur iOS.
Une feuille en `100vh` ou `100dvh` termine **sous** le clavier : arrivé en bas,
il n'y a plus rien à faire défiler et le champ ne peut plus remonter, quel que
soit le `scrollIntoView`. Il faut des **pixels mesurés** (`height: visible`).

---

## Quand ça résiste : mesurer, ne pas déduire

Six corrections déduites ont échoué. La septième, fondée sur une mesure, a réglé
la chose en un tour. `components/payments/DebugClavier.tsx` est gardé pour ça —
une ligne à monter dans la feuille suspecte :

```tsx
{isMobile && <DebugClavier cible={feuilleRef} />}
```

Deux choix de conception, chacun contre une façon de rater la mesure :

1. **Il journalise, il n'affiche pas l'état courant.** Le symptôme est une
   *transition* (« ça flashe et ça revient »). Un instrument d'état montrerait
   l'état final, c'est-à-dire tout sauf ce qu'on cherche. Une seule capture
   d'écran rend donc toute la séquence.

2. **Il échantillonne à chaque image (rAF), pas sur `resize`/`scroll`.** Si le
   défaut vient d'un événement qui n'arrive pas — et c'était exactement le
   cas — écouter les événements ne le verra jamais. On ne prend pas le suspect
   comme témoin.

3. **Il relève le rectangle réel de la feuille** (`top`, `height`), pas seulement
   les valeurs du viewport. C'est ce qui sépare « la mesure est fausse » de « la
   mesure est juste mais le style ne s'applique pas » — deux causes opposées,
   indiscernables autrement, et la raison pour laquelle on tournait en rond.

Chris fait la capture, elle se lit en dix secondes.

---

## Où c'est utilisé

| Écran | Fichier |
|---|---|
| Les 6 modales de correction d'une vente | `components/payments/ModaleAction.tsx` |
| Création d'un lien de paiement | `components/payments/CreateLinkModal.tsx` |
| Rapport de vente, feuilles et boîtes centrées | `components/ui/ModalShell.tsx` |

⚠️ `ModalShell` a en plus son propre recalage impératif pour le variant
`centered`, fondé sur `window.screen.height` — stable, lui, contrairement à
`innerHeight`. Ne pas le remplacer par `innerHeight` en croyant harmoniser.

## Tests

`lib/hauteurClavier.test.ts` rejoue les valeurs réelles relevées sur l'appareil,
pas des valeurs plausibles. Le test décisif est
`l'écrasement momentané d'innerHeight par iOS ne fait plus retomber la feuille` :
il échoue avec l'ancienne formule.
