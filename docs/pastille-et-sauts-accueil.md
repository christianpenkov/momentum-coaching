# Pastille de notification et sauts de mise en page

Journal des défauts corrigés les 25–27 août 2026 sur la pastille PWA et sur les
sursauts des deux accueils (coach et élève). Neuf bugs, **un seul mécanisme** : une valeur
inconnue traitée comme une valeur connue.

> À lire avant de toucher : `lib/pwaBadge.ts`, `public/sw.js` (bloc pastille),
> `lib/usePushNotifications.ts`, `app/api/push/subscribe/route.ts`,
> `lib/useNotifications.ts`, le squelette de `PageToday.tsx`.

---

## Le fil rouge

Chacun de ces bugs est né du même raccourci : **une absence d'information a été
lue comme une information**.

| Ce qui était inconnu | Lu comme | Conséquence |
|---|---|---|
| `created_at` jamais rafraîchi par un `upsert` | « abonnement vieux donc mort » | abonnements push valides supprimés |
| Compteur à `0` avant chargement | « rien en attente » | pastille effacée au démarrage à froid |
| `view-transition-name` sans boîte | règle CSS active | barre de nav non ancrée, elle glissait |
| Notifications du tiroir (tag partagé) | « nombre total en attente » | 6 notifications devenaient 1 |
| `unreadCount` du serveur | « total » | 6 notifs + 2 messages affichaient 2 |
| `loading` du contexte | « premier chargement » | tout rafraîchissement effaçait la page |
| Squelette dessinant un bandeau conditionnel | « il y aura un bandeau » | saut dans les deux cas |
| État local d'un hook sans cache | « il n'y a rien, donc on charge » | écran élève vidé à chaque navigation |

**Règle qui en découle** : avant qu'une valeur ne déclenche une action
destructrice (effacer, supprimer, masquer), vérifier qu'elle a été *réellement
observée*, et pas seulement initialisée. Un drapeau « cette source a parlé »
coûte trois lignes ; les neuf bugs ci-dessous en découlent tous.

---

## 1. Purge d'abonnements push par ancienneté

`app/api/push/subscribe/route.ts` supprimait les abonnements du même profil
vieux de plus de 7 jours. Deux détails la rendaient destructrice sans erreur :

- `upsert` **ne rafraîchit pas `created_at`** — un abonnement parfaitement
  valide vieillissait indéfiniment ;
- la purge se déclenchait depuis un **autre appareil** que celui qu'elle
  détruisait.

**Corrigé** : purge supprimée. Un abonnement mort se signale par un **404/410**
d'APNs/FCM au premier envoi, et `/api/push/send` le nettoie déjà. L'âge n'est
pas une preuve d'invalidité.

> ⚠️ Ne jamais réintroduire de suppression fondée sur l'ancienneté.
> `last_seen_at` existe pour **diagnostiquer**, jamais pour purger.

## 2. Abonnement jamais revalidé

`registerPush` réutilisait `getSubscription()` sans revalider côté serveur, et un
garde `done.current` interdisait toute nouvelle tentative après un échec — un
service worker pas encore actif au montage condamnait la session entière.

**Symptôme** : plus aucun `push_received` entre le 21 et le 27 août.

**Corrigé** : l'abonnement est renvoyé **à chaque ouverture** et revalidé au
retour au premier plan (6 h max), avec reprise après échec. La route est
idempotente : la réémettre ne coûte qu'une requête.

## 3. Deux sources qui s'écrasaient

Les notifications de la cloche et les messages non lus appelaient chacun
`setAppBadge(sonPropreTotal)` : la dernière à parler écrasait l'autre.

**Corrigé** : `lib/pwaBadge.ts` agrège. Chaque source déclare son compte via
`setBadgeCount(source, n)` ; la pastille affiche la **somme**. Une source qui
tombe à zéro n'efface plus l'autre.

## 4. Pastille effacée au démarrage à froid

`reassertAppBadge()` est branché sur `pageshow`, qui se déclenche **dès le
chargement initial** — avant que les sources aient chargé leurs données. Le
compteur valait `{0, 0}`, donc « rien en attente », donc effacement.

**Corrigé** : un drapeau `reported` par source. Tant qu'aucune n'a parlé,
`applyBadge()` ne fait rien. Au passage, la fermeture des notifications du
tiroir ne part plus qu'à la **transition** vers zéro (elle partait toutes les
60 s au rythme du refresh, refermant toute notification reçue app ouverte).

## 5. Le service worker ne pouvait pas relire la pastille

**L'API Badging n'expose aucun moyen de lire la valeur courante.** Le service
worker ne pouvait que poser un nombre deviné.

Première tentative — compter les notifications du tiroir : **échec**. Elles
partagent le tag `momentum-msg` et se *remplacent*, donc le tiroir n'en contient
jamais qu'une. Six notifications en attente devenaient « 1 ».

**Corrigé** : l'état est rangé dans **IndexedDB**, seul stockage accessible à la
fois à l'application et au service worker (`localStorage` n'existe pas dans un
worker). L'application y écrit la vérité à chaque calcul ; le worker part de là
pendant qu'elle est fermée.

## 6. `unreadCount` n'est pas un total

Mesuré dans `sw_logs` : `{"count": 2, "previous": 7}`. L'état partagé contenait
bien 7, mais le push transportait `unreadCount: 2` et le code lui donnait la
priorité.

Or `app/api/push/webhook/route.ts` calcule ce champ par un `count` sur la table
`messages` **uniquement**. Il ignore les notifications de la cloche.

**Corrigé** : IndexedDB range les **deux sources séparément**, jamais leur
somme. Le worker remplace le compteur `messages` par la valeur du serveur — qui
fait autorité *sur cette source-là* — et conserve `notifs` intact.

> 🔑 Si un jour une route envoie un vrai total, lui donner la priorité sur
> l'addition. Mais vérifier d'abord **ce que le champ compte réellement**.

## 7. Sauts de l'accueil

Trois causes distinctes, découvertes dans cet ordre :

1. **`refetch()` effaçait la page.** Le contexte repassait `loading` à `true`
   même avec les données déjà chargées, et l'accueil remplace toute la page par
   un squelette dans ce cas. Corrigé par `hasLoadedRef` : `loading` ne vaut
   `true` qu'au tout premier chargement.
2. **Le squelette inventait le bandeau.** Il dessinait systématiquement une
   carte à la forme du « Prochain call », pourtant conditionnel. Avec un call,
   la vraie carte est plus haute → ça pousse ; sans call, elle disparaît → ça
   remonte.
3. **`useNotifications` repartait d'une liste vide à chaque montage** — la vraie
   cause du saut à la navigation. Le carrousel « rapports en attente » renvoie
   `null` quand il est vide : il occupait zéro hauteur puis surgissait à pleine
   hauteur ~300 ms plus tard. Corrigé par un cache inter-montages (même
   intention que l'abonnement partagé de `useUnreadMessagesCount`).

Reste le **démarrage à froid**, où rien n'est en mémoire :
`lib/accueilLayoutHint.ts` retient la *forme* du dernier passage (y avait-il un
bandeau, combien de rapports) pour que le squelette réserve la place. La forme
est **cloisonnée par espace** (`'coach'` / `'client'`) : les deux accueils n'ont
pas la même structure et un même navigateur voit souvent les deux.

> 🔑 L'indice doit être calculé avec **exactement** la condition du rendu, pas
> une approximation. Côté élève, `upcomingCalls` peut être non vide sans qu'aucun
> bandeau ne s'affiche (call à plus de 24 h, rapport déjà rempli) : réserver la
> place dans ce cas recrée le saut, dans l'autre sens.

## 8. L'espace élève n'avait aucun cache

`useClientSelfData` est un hook à état local **sans provider** : chaque montage
repartait de `data: null, loading: true` et relançait une quinzaine de requêtes
en parallèle. Or cinq écrans élève l'utilisent (accueil, calendrier, calendrier
mobile, calls, prochains calls) — chaque navigation entre eux vidait l'écran,
affichait un squelette, puis reconstruisait tout.

Côté coach les mêmes données passent par `SupabaseClientsProvider`, monté dans
le layout : elles survivent aux navigations. **D'où l'écart de comportement
entre les deux espaces**, longtemps attribué à tort à la page elle-même.

**Corrigé** : cache module-level, réaffiché immédiatement puis remplacé sur
place par la version fraîche. Le rechargement continue d'avoir lieu — il
n'efface simplement plus l'écran pendant qu'il tourne.

## 9. Le badge « Commencé il y a… » des brouillons

`usePendingDrafts` partait lui aussi d'un objet vide à chaque montage. La
mention « Commencé il y a X jours · étape N/M » n'existait donc pas au premier
rendu et s'ajoutait une fois la requête revenue : elle occupe une ligne, donc la
carte grandissait et poussait le contenu en dessous.

**Corrigé** : cache indexé par ensemble d'ids (borné à 8 entrées), réaffiché
immédiatement puis remplacé sur place.

> ⚠️ Le réamorçage depuis le cache se fait sur changement de **liste**
> uniquement, **jamais** sur le `tick` de `notifs-refresh`. Un tick suit une
> soumission de rapport : le brouillon vient d'être supprimé, et réafficher
> l'entrée en cache le ferait réapparaître le temps de la requête. Un cache sert
> à éviter un trou, pas à ressusciter une donnée qu'on sait fausse.

---

## Le motif à réutiliser

Quatre sources alimentaient l'accueil, **quatre repartaient de zéro** à chaque
montage : `useNotifications`, `useClientSelfData`, `usePendingDrafts`, et la
forme du squelette. À chaque fois le même correctif — garder la dernière valeur
connue, la réafficher tout de suite, la remplacer sur place.

Avant d'ajouter un hook qui alimente un bloc **conditionnel** (un badge, une
carte qui disparaît quand elle est vide), se demander : *que vaut-il au premier
rendu après une navigation ?* Si la réponse est « vide », le bloc surgira et
poussera ce qui le suit.

> ⚠️ On ne mémorise **que des formes**, jamais du contenu. Réafficher un nom ou
> une heure du lancement précédent afficherait un call annulé comme s'il tenait
> toujours. Une place vide ne ment pas ; une donnée périmée, si.

---

## Vérifier l'état de la chaîne push

```sql
-- Un abonnement revalidé récemment = le client se réenregistre bien.
-- last_seen_at figé alors que l'app est ouverte = enregistrement en échec.
select p.full_name, p.role, ps.created_at, ps.last_seen_at
  from push_subscriptions ps join profiles p on p.id = ps.profile_id
 order by ps.last_seen_at desc nulls last;

-- Un push effectivement reçu par l'appareil, et le calcul de la pastille.
select event, data, created_at from sw_logs
 where event in ('push_received','badge_set','badge_error')
 order by created_at desc limit 20;
```

`badge_set` journalise `{count, previous, next}` : `previous` montre ce que
l'application avait écrit, `next` le détail des deux sources. C'est cette trace
qui a permis d'identifier le bug n° 6 en une requête.

## Journalisation du service worker — attention au volume

`sw_logs` avait accumulé **43 837 lignes en deux semaines pour un seul
testeur**, dont ~25 000 pour `clear_notifications_requested`.

Cause : `markMessageRead` est déclenché par l'`IntersectionObserver` de **chaque
bulle**. Ouvrir une conversation de trente messages émettait trente ordres en
deux secondes, et le worker écrivait une ligne pour chacun — y compris quand le
tiroir était vide, soit la quasi-totalité du temps.

**Corrigé** : ordre étranglé à un envoi par salve (3 s), et le worker ne
journalise que si quelque chose a **réellement** été fermé.

> ⚠️ `sw_logs` accepte les insertions du rôle `anon` sans condition
> (`with_check: true`), et la clé anon est en clair dans `sw.js`. C'est une
> porte d'écriture ouverte sur la production. Gravité faible (pas de lecture,
> pas de données sensibles) mais à durcir : restreindre l'insertion, ou purger
> automatiquement au-delà de N jours.

## Ancrage des barres pendant les transitions de page

`.bottom-nav-wrapper` porte `display: contents` : il ne génère **aucune boîte**.
Or `view-transition-name` n'a d'effet que sur un élément qui en génère une.
L'ancrage était donc silencieusement inopérant, et la barre du bas, capturée
dans l'instantané de la page entière, glissait à chaque navigation — ce qui se
lit comme une disparition. Symptôme mobile uniquement, la barre étant masquée
au-delà de 767 px.

**Corrigé** : le nom est posé sur `.bottom-nav`, l'élément réel.

> 🔑 Vérifier qu'un élément portant un `view-transition-name` génère bien une
> boîte. `display: contents` et `display: none` annulent la règle sans erreur.
