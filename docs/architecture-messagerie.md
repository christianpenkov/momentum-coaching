# Architecture de la messagerie Momentum

Documentation de référence pour reconstruire une messagerie temps réel équivalente sur une autre plateforme. Couvre : schéma DB, réaltime (messages + présence + typing), scroll robuste, marquage lu, notifications.

**Statut** : présence en ligne/hors ligne, typing, scroll (flash, ancrage bas/divider, retour d'arrière-plan) — tous validés en usage réel après la série de correctifs décrite ici (commits jusqu'à `a5e621b`). Tous les pièges documentés ont été effectivement rencontrés en production, pas des risques théoriques.

## Fichiers

- `components/pages/coach/PageChat.tsx` — vue coach (liste de conversations + thread actif)
- `components/pages/client/PageClientMessages.tsx` — vue élève (une seule conversation avec son coach)
- Les deux fichiers sont **structurellement dupliqués** (pas de composant partagé) — même logique, adaptée aux rôles inversés (`role: 'coach'` / `role: 'client'`)

## 1. Schéma de données

Table `messages` (Postgres/Supabase) :

```sql
id            uuid primary key
client_id     uuid        -- FK vers clients.id (la conversation = 1 coach + 1 élève)
sender_id     uuid        -- auth.users.id de l'expéditeur (coach OU élève)
text          text
type          text        -- 'text' | 'audio' | 'image' | 'document'
audio_url     text null
duration_s    int null
created_at    timestamptz
read_at       timestamptz null   -- null = non lu
edited_at     timestamptz null
```

Une conversation = toutes les lignes `messages` pour un `client_id` donné. Pas de table `conversations` séparée : le `client_id` sert directement de clé de conversation (1 coach ↔ 1 élève, relation fixe).

## 2. Chargement initial

1. `supabase.auth.getUser()` → obtient l'utilisateur connecté.
2. Résout `client_id` (table `clients`, `profile_id` = user.id côté élève, ou sélection dans une liste côté coach).
3. Fetch tous les messages de la conversation, triés par `created_at ascending`, en un seul `select`.
4. `setMessages(data)` puis `setLoading(false)` dans le même tick (batché par React).

Pas de pagination/scroll infini — tout l'historique est chargé d'un coup (fonctionne bien jusqu'à quelques centaines de messages ; à revoir si l'historique grossit beaucoup).

## 3. Réaltime des messages (INSERT/UPDATE/DELETE)

Un canal Supabase Realtime dédié par conversation, écoutant les changements Postgres (pas du Presence) :

```ts
const channel = supabase.channel(`messages-client-${clientId}`)
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `client_id=eq.${clientId}` },
    payload => setMessages(prev => [...prev, payload.new]))
  .on('postgres_changes', { event: 'UPDATE', ... }, payload => setMessages(prev => prev.map(...)))
  .on('postgres_changes', { event: 'DELETE', ... }, payload => setMessages(prev => prev.filter(...)))
  .subscribe();
```

Cleanup : `supabase.removeChannel(channel)`. Nom de canal incluant `clientId` pour éviter les collisions entre conversations lors des remounts en PWA.

## 4. Présence en ligne/hors ligne — le point le plus délicat

### 4.1 Pourquoi c'est difficile

Un canal Supabase Realtime **Presence** donne un état `join`/`leave` par client connecté au canal. Le piège : si le WebSocket meurt **silencieusement** (mise en veille de l'OS, coupure réseau brutale, throttling de l'onglet en arrière-plan), le serveur peut mettre plusieurs dizaines de secondes à minutes à détecter la coupure et ne déclenche parfois jamais de vrai `leave` — le peer peut alors rester affiché "en ligne" indéfiniment jusqu'à un hard refresh.

### 4.2 Solution : ne jamais faire confiance au seul état du canal

Pattern retenu (inspiré Slack/Discord — heartbeat + TTL, jamais un booléen de connexion seul) :

1. **Canal unique par conversation** : `presence-chat-${clientId}`, avec `config: { presence: { key: userId } }` — chaque participant a sa propre clé (son `auth.users.id`), donc pas de collision entre coach et élève sur le même canal.

2. **`track()` initial** au `SUBSCRIBED` :
   ```ts
   ch.track({ user_id: userId, role: 'coach' /* ou 'client' */, online_at: new Date().toISOString() });
   ```

3. **`sync` event** — reçu par chaque participant dès que l'état de présence du canal change (y compris son propre `track()` initial). On lit `ch.presenceState()`, on cherche l'entrée du **peer** (clé ≠ la sienne, `role` opposé), et on retient son `online_at` :
   ```ts
   ch.on('presence', { event: 'sync' }, () => {
     const state = ch.presenceState();
     const peerEntry = Object.entries(state).find(([key, entries]) =>
       key !== userId && entries.some(e => e.role === 'client' /* ou 'coach' */));
     if (peerEntry) { lastPeerSeenRef.current = Date.now(); setPeerOnline(true); }
     else { lastPeerSeenRef.current = null; setPeerOnline(false); }
   });
   ```

4. **Heartbeat applicatif** : re-`track()` toutes les **60 secondes** (pas plus fréquent — voir 4.4) tant que la page est visible :
   ```ts
   setInterval(() => { if (isSubscribedRef.current && document.visibilityState === 'visible') track(); }, 60_000);
   ```

5. **TTL local côté récepteur** : si le dernier `online_at` connu du peer dépasse **150 secondes** (2.5× le heartbeat, marge pour absorber la latence réseau), on le considère hors ligne — **indépendamment de l'état du canal WebSocket** :
   ```ts
   setInterval(() => {
     if (lastPeerSeenRef.current !== null && Date.now() - lastPeerSeenRef.current > 150_000) setPeerOnline(false);
   }, 10_000);
   ```

6. **`untrack()`/`track()` sur `visibilitychange`** : untrack quand l'onglet passe en arrière-plan (`hidden`), re-track à visible — évite d'afficher "en ligne" un onglet masqué depuis longtemps. Gardé par `isSubscribedRef.current` pour ne pas untrack un canal pas encore souscrit.

7. **Reconnexion automatique** : le SDK Realtime **ne se re-souscrit jamais tout seul** sur `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`. Sans rien faire, le point de présence reste figé jusqu'à un hard refresh. Il faut recréer le canal entièrement :
   ```ts
   .subscribe(status => {
     if (status === 'SUBSCRIBED') { retryAttemptRef.current = 0; track(); }
     else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) scheduleRetry();
   });
   ```
   Et sur retour réseau : `window.addEventListener('online', () => { retryAttemptRef.current = 0; setPresenceRetryKey(k => k+1); })` — `presenceRetryKey` est une dépendance du `useEffect` qui crée le canal, donc l'incrémenter force sa recréation complète.

8. **Backoff exponentiel sur les retries** — **critique** :
   ```ts
   const delay = Math.min(1000 * 2 ** attempt, 30_000); // 1s, 2s, 4s... plafonné à 30s
   ```
   Sans backoff, une erreur de canal déclenche un retry immédiat → nouveau `track()` → peut re-déclencher le rate limit Supabase Realtime sur les événements de présence (`ClientPresenceRateLimitReached`, confirmé en prod via les logs Realtime) → nouvelle erreur → boucle qui ne se résout jamais. C'est la cause racine constatée du bug "les deux appareils toujours hors ligne l'un pour l'autre".

9. **`worker: true` sur le client Realtime** (`createClient({ worker: true, heartbeatIntervalMs: 15_000 })`) — déporte le heartbeat bas niveau du WebSocket dans un Web Worker, insensible au throttling de timers que les navigateurs appliquent aux onglets en arrière-plan longue durée. Le SDK Supabase embarque le script worker dans un `Blob` local (`URL.createObjectURL`), donc aucune requête réseau externe, aucun risque de blocage CSP.

### 4.3 Où ça vit dans le code

- Côté élève : dans le composant principal, un seul canal sert à la fois pour la présence **et** le broadcast `typing` (voir §5) — pas deux canaux séparés.
- Côté coach : le canal de présence vit dans le composant **parent** (`PageChat`, jamais démonté tant qu'on reste dans les pages coach), pas dans le sous-composant de thread — car il doit persister même quand on change de conversation active.

### 4.4 Rate limit Supabase Realtime — leçon apprise

Diagnostiqué via les **logs Realtime réels du projet** (`mcp Supabase get_logs`, service `realtime`) : `ClientPresenceRateLimitReached: client_rate_limit_exceeded`. Le rate limit de présence est sensible au **nombre d'événements `track()`/`untrack()` par seconde**, pas juste au nombre d'utilisateurs connectés. Un heartbeat à 20s combiné à des retries immédiats suffit à l'atteindre avec seulement 2 appareils. Réglages qui tiennent en prod : heartbeat 60s, TTL 150s, backoff exponentiel sur les retries.

## 5. Indicateur "en train d'écrire"

Réutilise le **même canal** que la présence (`presence-chat-${clientId}`), via `broadcast` (pas `presence`) :

- Émission (débattue/throttlée côté frappe, pas à chaque keystroke) :
  ```ts
  ch.send({ type: 'broadcast', event: 'typing', payload: { role: 'client' } });
  ```
- Réception :
  ```ts
  ch.on('broadcast', { event: 'typing' }, payload => {
    if (payload.payload?.role === 'coach') {
      setCoachTyping(true);
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setCoachTyping(false), 3000);
    }
  });
  ```

**Piège corrigé et validé en usage réel** : si le canal est recréé (retry, retour d'arrière-plan) **entre** le `setCoachTyping(true)` et l'expiration du timer de 3s, le cleanup de l'effet annule le timer (`clearTimeout`) mais oubliait de repasser `coachTyping` à `false` — l'indicateur restait bloqué affiché indéfiniment ("En train d'écrire…" visible en permanence, constaté en usage réel). **Toujours réinitialiser l'état dans le cleanup, pas seulement annuler le timer** :
```ts
return () => {
  if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  setCoachTyping(false); // pas juste clearTimeout — sinon le state reste bloqué à true
};
```

## 6. Scroll — atterrir directement à la bonne position, sans flash ni résidu

C'est la partie la plus longue à mettre au point. Objectifs : (a) jamais de flash visuel du haut de la conversation à l'ouverture, (b) toujours atterrir exactement en bas (ou sur le bon message), (c) rester ancré en bas pendant que de nouveaux messages arrivent, (d) ne jamais bloquer un scroll manuel de l'utilisateur.

### 6.1 `useLayoutEffect`, pas `useEffect`

Le calcul et l'application du scroll initial doivent être dans un **`useLayoutEffect`** (exécution synchrone après le commit DOM mais **avant** que le navigateur peigne), pas un `useEffect` (exécuté après le paint). Avec `useEffect`, le navigateur peut peindre une première frame avec `scrollTop: 0` (haut de la conversation) avant que le scroll ne soit corrigé — flash intermittent, dépendant du timing exact du navigateur à chaque ouverture.

### 6.2 `scrollTo({ behavior: 'instant' })`, jamais une affectation directe de `scrollTop`

Le CSS `.chat-messages-zone { scroll-behavior: smooth }` (nécessaire pour le scroll manuel fluide) anime **toute** modification de la position de scroll, **y compris l'affectation directe** `el.scrollTop = x` — pas seulement les appels explicites `scrollTo({behavior:'smooth'})`. Utiliser `el.scrollTo({ top, behavior: 'instant' })` qui outrepasse explicitement la règle CSS.

### 6.3 Masquage anti-flash en complément (filet de sécurité)

```tsx
style={{ visibility: (!loading && messages.length > 0 && !contentReady) ? 'hidden' : 'visible' }}
```
`contentReady` (state) passe à `true` juste après que le scroll initial ait été posé dans le `useLayoutEffect`. `visibility: hidden` (pas `display: none`) garde le layout calculé, donc `scrollHeight` reste mesurable pendant le masquage.

### 6.4 Atterrir sur le premier message non lu (pattern WhatsApp/Telegram)

Au lieu de toujours scroller tout en bas, si des messages non lus existent, on atterrit sur un séparateur "Nouveaux messages" placé juste avant le premier non-lu — pour ne rater aucun message si beaucoup sont arrivés d'un coup.

- Calcul figé **une seule fois** par ouverture de conversation (`firstUnreadComputedRef`), sinon le divider disparaîtrait dès que les messages commencent à être marqués lus au fil du scroll :
  ```ts
  if (!firstUnreadComputedRef.current) {
    firstUnreadComputedRef.current = true;
    const firstUnread = messages.find(m => m.sender_id !== userId && !m.read_at);
    if (firstUnread) { setFirstUnreadId(firstUnread.id); return; } // attend le re-render suivant
  }
  ```
  Le `return` fait attendre le prochain passage de l'effet (déclenché par `setFirstUnreadId`) — le DOM du séparateur doit être monté (rendu conditionnel sur `firstUnreadId === msg.id`) avant qu'on puisse faire `document.getElementById('unread-divider-...').scrollIntoView(...)`.
- Deux flags d'ancrage distincts selon où on a atterri :
  - `stickToBottomRef` : ancré en bas (cas normal).
  - `stickToDividerRef` : ancré sur le divider (cas non-lu) — sans ce 2ᵉ flag, rien ne protège la position du divider pendant la stabilisation post-paint (voir 6.5), et un reflow peut faire dériver la vue de plusieurs messages.

### 6.4bis Refaire le calcul au retour d'arrière-plan, pas seulement au premier chargement

**Piège corrigé et validé en usage réel** : le reset de tous ces flags (`firstUnreadComputedRef = false`, etc.) ne se déclenchait que dans un `useEffect` dépendant de `[loading]` — or `loading` ne repasse à `true` qu'au tout premier montage du composant (chargement initial des messages). Si l'app/onglet n'est **jamais complètement fermé** (mise en arrière-plan mobile sans kill de l'app, ou simple changement d'onglet/fenêtre sur PC), `loading` reste `false` indéfiniment : le calcul du premier non-lu ne se refait jamais, même en revenant des heures plus tard avec plein de nouveaux messages — le séparateur "Nouveaux messages" n'apparaissait alors jamais, les nouveaux messages semblaient juste "apparaître" sans distinction visuelle.

Fix : un listener `visibilitychange` séparé détecte un retour au premier plan après une **absence significative** (seuil de 5s, pour ignorer les micro blur/focus type notification rapide ou alt-tab instantané) et refait exactement le même reset que le chargement initial :
```ts
const hiddenAtRef = useRef<number | null>(null);
useEffect(() => {
  const handleBackgroundReturn = () => {
    if (document.visibilityState === 'hidden') { hiddenAtRef.current = Date.now(); return; }
    const wasHiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
    hiddenAtRef.current = null;
    if (wasHiddenFor < 5000) return; // ignore les changements d'onglet très courts
    initialScrollDone.current = false;
    stickToBottomRef.current = true;
    settlingRef.current = true;
    knownIdsRef.current = null;
    firstUnreadComputedRef.current = false;
    setFirstUnreadId(null);
    setContentReady(false);
    suppressAutoReadRef.current = true;
  };
  document.addEventListener('visibilitychange', handleBackgroundReturn);
  return () => document.removeEventListener('visibilitychange', handleBackgroundReturn);
}, []);
```
Ce mécanisme fonctionne identiquement sur mobile PWA (mise en arrière-plan) et sur PC (changement d'onglet/fenêtre) — les deux déclenchent le même événement `visibilitychange`, il n'y a pas de distinction à faire entre les deux environnements.

### 6.5 Boucle `requestAnimationFrame` continue pendant une fenêtre de "stabilisation"

Un seul `scrollTo()` au chargement ne suffit pas : le contenu peut continuer à grandir après (images qui finissent de charger, polices qui swap, barre d'adresse mobile qui se replie changeant la hauteur du viewport). Une seule correction par notification `ResizeObserver` s'est révélée insuffisante en pratique (le navigateur peut regrouper plusieurs changements de hauteur en une seule notification, laissant passer une fenêtre de croissance non détectée — écarts de plusieurs messages constatés malgré des logs indiquant un écart nul juste avant).

Solution : une boucle `requestAnimationFrame` qui revérifie et corrige **à chaque frame** pendant 2.5 secondes après l'ouverture :
```ts
useEffect(() => {
  if (loading || !settlingRef.current) return;
  let rafId: number | null = null;
  const tick = () => {
    const c = chatZoneRef.current;
    if (!c || !settlingRef.current) { rafId = null; return; }
    if (stickToBottomRef.current) {
      const gap = c.scrollHeight - c.scrollTop - c.clientHeight;
      if (gap > 0) c.scrollTo({ top: c.scrollHeight, behavior: 'instant' });
    } else if (stickToDividerRef.current) {
      document.getElementById(`unread-divider-${clientId}`)?.scrollIntoView({ behavior: 'instant', block: 'center' });
    } else { rafId = null; return; }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return () => { if (rafId !== null) cancelAnimationFrame(rafId); };
}, [loading, messages, clientId]);
```

**Piège critique corrigé** : le `setTimeout` qui referme cette fenêtre (`settlingRef.current = false` après 2.5s) ne doit **jamais** être posé à l'intérieur du `useLayoutEffect` de scroll (dépendances `[messages, ...]`) avec un `return () => clearTimeout(t)`. React exécute ce cleanup à **chaque redéclenchement de l'effet**, donc à chaque nouveau message — si le nouveau timer n'est reposé que dans une branche qui ne se reproduit jamais après le premier passage (ce qui était le cas), dès qu'un 2ᵉ message arrive dans les 2.5 premières secondes, le timer est annulé sans jamais être remplacé : `settlingRef.current` reste bloqué à `true` **pour toujours**, et la boucle `rAF` tourne en continu à 60fps, **saturant le thread principal** — app totalement figée (aucune interaction possible, y compris la navigation), nécessitant un hard refresh ou de tuer complètement l'app. Le timer doit vivre dans un `useEffect` **séparé**, dépendant uniquement de `contentReady` (qui ne change qu'une fois par ouverture) :
```ts
useEffect(() => {
  if (!settlingRef.current) return;
  const t = setTimeout(() => { settlingRef.current = false; }, 2500);
  return () => clearTimeout(t);
}, [contentReady]);
```

### 6.6 Ne jamais bloquer un vrai geste utilisateur

Un `event: scroll` natif peut être déclenché par le navigateur lui-même (reflow viewport mobile, swap de police) sans intervention de l'utilisateur — il ne doit pas désarmer l'ancrage bas pendant la fenêtre de stabilisation. Mais un **vrai geste** (`touchstart`/`mousedown`/`wheel`) est un signal fiable à 100% qu'il vient de l'utilisateur — il doit désarmer l'ancrage **immédiatement**, sans attendre la fin des 2.5s, sinon scroller vers le haut juste après l'ouverture est systématiquement annulé par la boucle rAF :
```ts
function handleUserGestureStart() { userGestureRef.current = true; settlingRef.current = false; }
// posé sur onTouchStart / onMouseDown / onWheel du container
```

### 6.7 Viewport mobile qui bouge après coup

Le shell mobile (voir §8) recalcule sa hauteur via `visualViewport.resize` **après** le premier paint — la barre d'adresse finit de se replier un instant plus tard, réduisant la zone de chat après coup ("je vois le bas, puis ça remonte"). Ce resize n'est jamais un geste utilisateur : on force une correction en boucle `rAF` pendant 500ms à chaque `resize` de `visualViewport`, indépendamment de `settlingRef`.

## 7. Marquage "lu"

Un message est marqué lu **uniquement** quand sa bulle entre réellement dans le viewport visible via `IntersectionObserver` (`threshold: 0.6`) — pas juste parce que la conversation est ouverte quelque part avec le message trop haut dans l'historique, jamais scrollé jusqu'à lui.

```ts
const observer = new IntersectionObserver(entries => {
  pendingVisible = !!entries[0]?.isIntersecting;
  tryMark(); // pose un setTimeout(1000ms) si pendingVisible && document.visibilityState === 'visible'
}, { threshold: 0.6 });
```

Délai de grâce de 1s avant marquage — un simple passage rapide en scrollant ne doit pas suffire.

**Piège critique corrigé** : un message reçu **pendant que l'app est en arrière-plan** (pas fermée) peut être marqué lu automatiquement **avant même que l'utilisateur ne l'ait vu** : Realtime insère la ligne en base, React monte la bulle correspondante, l'`IntersectionObserver` la voit "visible" dans le DOM (le viewport DOM n'a pas conscience que l'onglet est masqué), puis au retour au premier plan le `visibilitychange` redéclenche `tryMark()` — souvent **avant** que le calcul du premier non-lu (§6.4) n'ait eu lieu, empêchant le séparateur "Nouveaux messages" d'apparaître pour des messages jamais réellement vus.

Fix : un flag `suppressAutoReadRef`, `true` par défaut, qui bloque tout marquage automatique jusqu'à ce que le calcul du premier non-lu ait eu lieu pour cette ouverture de conversation — levé juste après ce calcul, donc les messages reçus en direct pendant que la conversation est déjà ouverte continuent d'être marqués lus normalement.
```ts
const markMessageRead = useCallback((msgId: string) => {
  if (suppressAutoReadRef.current) return;
  // ... update read_at en DB + state local
}, [supabase]);
```

## 8. Layout mobile (PWA) — hauteur de viewport dynamique

Le clavier virtuel et la barre d'adresse mobile changent la hauteur visible sans que `100vh` CSS le reflète correctement (`100vh` est calculé sur le viewport maximal, barre repliée). Deux protections combinées :

1. **`100dvh` (dynamic viewport height)** en fallback CSS : `height: 100vh; height: 100dvh;` (la 2ᵉ déclaration écrase la 1ʳᵉ si supportée).
2. **Correction JS précise via `window.visualViewport`** (plus réactive que le CSS seul), extraite dans un hook partagé `useViewportShellHeight(shellRef)` appliqué identiquement aux layouts coach et élève :
   ```ts
   const vv = window.visualViewport;
   const baseH = window.screen.height; // stable sur iOS, contrairement à innerHeight
   function update() {
     const vvh = vv.height;
     const kbH = Math.max(0, baseH - vvh);
     shellRef.current.style.height = `${vvh}px`;
     document.body.classList.toggle('keyboard-open', kbH > 100);
     if (document.activeElement instanceof HTMLInputElement || ...) window.scrollTo(0, 0); // hack WebKit
   }
   vv.addEventListener('resize', update);
   vv.addEventListener('scroll', update);
   ```

## 9. Récapitulatif des refs/state clés (par conversation)

| Nom | Type | Rôle |
|---|---|---|
| `messages` | state | Liste complète des messages, source de vérité du rendu |
| `loading` | state | Chargement initial en cours |
| `initialScrollDone` | ref | Le scroll initial a été posé une fois |
| `contentReady` | state | Pilote le masquage anti-flash (`visibility`) |
| `firstUnreadId` | state | ID du premier message non lu (pour le divider) |
| `firstUnreadComputedRef` | ref | Le calcul du premier non-lu a eu lieu (figé, une fois) |
| `suppressAutoReadRef` | ref | Bloque le marquage auto tant que `firstUnreadComputedRef` n'a pas tranché |
| `stickToBottomRef` | ref | Ancré en bas — corrigé en continu pendant `settlingRef` |
| `stickToDividerRef` | ref | Ancré sur le divider non-lu — alternative à `stickToBottomRef` |
| `settlingRef` | ref | Fenêtre de stabilisation active (2.5s post-ouverture) |
| `userGestureRef` | ref | Un vrai geste utilisateur a eu lieu — désarme `settlingRef` immédiatement |
| `knownIdsRef` | ref | IDs déjà présents au chargement — pilote l'animation d'entrée des bulles (seuls les nouveaux messages l'ont) |
| `isSubscribedRef` | ref | Le canal presence est `SUBSCRIBED` (garde pour `untrack`/`track`) |
| `lastCoachSeenRef` / `lastPeerSeenRef` | ref | Dernier `online_at` connu du peer — base du TTL local |
| `presenceRetryKey` | state | Incrémenté pour forcer la recréation du canal presence |
| `retryAttemptRef` | ref | Compteur pour le backoff exponentiel |
| `hiddenAtRef` | ref | Timestamp de mise en arrière-plan — sert à mesurer la durée d'absence (seuil 5s) avant de refaire le reset "premier non-lu" au retour (§6.4bis) |

## 10. Ce qu'il faut absolument reproduire si migration vers une autre stack

- Système realtime avec un vrai **Presence** (pas juste du pub/sub classique) — sinon il faut réimplémenter le heartbeat + TTL à la main.
- `useLayoutEffect`-équivalent (ou son analogue dans le framework cible) pour le scroll initial — critique pour éviter le flash.
- Bien vérifier que **tout timer/interval posé dans un effect qui se redéclenche souvent** (dépendant d'une liste qui grossit) a un cycle de vie **découplé** de cet effet, sinon risque de blocage de flag et boucle infinie (le bug le plus grave rencontré).
- Rate limits du provider realtime choisi — tester avec 2+ clients simultanés avant de considérer la présence "finie".
