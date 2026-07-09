# Architecture de la messagerie Momentum

Documentation de référence pour reconstruire une messagerie temps réel équivalente sur une autre plateforme. Couvre : schéma DB, réaltime (messages + présence + typing), scroll robuste, marquage lu, notifications.

**Statut** : présence en ligne/hors ligne (plateforme entière, pas juste messagerie), typing, scroll en `column-reverse` — refonte complète, ancrage bas natif du navigateur (§6, commit `dec462c`, confirmé résolu en usage réel), navigation SPA, notifications forcées, messages vocaux écouté/vu + reprise de lecture (§13), répondre à un message + copier (§15), légende sur fichier (§16), photo de profil (§17), menu contextuel v2 sans grossissement de bulle (§19), réactions emoji (§20), AudioBubble style WhatsApp (§21), bloc document avec vraie miniature PDF (§22), citation avec fond (§23) — tous validés en usage réel après la série de correctifs décrite ici. Tous les pièges documentés ont été effectivement rencontrés en production, pas des risques théoriques.

## Fichiers

- `components/pages/coach/PageChat.tsx` — vue coach (liste de conversations + thread actif)
- `components/pages/client/PageClientMessages.tsx` — vue élève (une seule conversation avec son coach)
- Les deux fichiers sont **structurellement dupliqués** — même logique, adaptée aux rôles inversés (`role: 'coach'` / `role: 'client'`)
- `components/pages/shared/MessageMenuParts.tsx` — **exception au principe de duplication** : `MenuItem`, `ReactionBar`, `buildMenuItems()` n'ont aucune logique spécifique au rôle, partagés entre les deux fichiers pour éviter une duplication gratuite (voir §19)
- `lib/pdfThumbnail.ts` — génération de miniature PDF + comptage de pages (`pdf-to-img`), partagé entre `app/api/resources/upload/route.ts` et `app/api/messages/upload-file/route.ts`

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
listened_at   timestamptz null   -- null = vocal non écouté (distinct de read_at, voir §13)
edited_at     timestamptz null
caption       text null          -- légende optionnelle sur image/document, voir §16
reply_to_id   uuid null          -- FK messages.id on delete set null, voir §15
reaction_emoji text null         -- emoji de la réaction posée, voir §20
reaction_by   uuid null          -- FK profiles.id on delete set null, auteur de la réaction, voir §20
file_size_bytes integer null     -- taille du fichier envoyé (octets), voir §22
page_count    integer null       -- nombre de pages si PDF, voir §22
thumbnail_url text null          -- miniature de la page 1 si PDF, voir §22
```
Contrainte : `check ((reaction_emoji is null) = (reaction_by is null))` — une réaction a toujours emoji + auteur ensemble, jamais l'un sans l'autre.

Table `profiles` (Postgres/Supabase) — pertinente pour la photo de profil (§17) :

```sql
id            uuid primary key  -- = auth.users.id
role          text              -- 'coach' | 'client'
full_name     text null
avatar_url    text null         -- URL publique Storage, avec cache-buster ?t=, voir §17
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

## 4. Présence en ligne/hors ligne — plateforme entière, pas juste messagerie

### 4.1 Pourquoi c'est difficile

Un canal Supabase Realtime **Presence** donne un état `join`/`leave` par client connecté au canal. Le piège : si le WebSocket meurt **silencieusement** (mise en veille de l'OS, coupure réseau brutale, throttling de l'onglet en arrière-plan), le serveur peut mettre plusieurs dizaines de secondes à minutes à détecter la coupure et ne déclenche parfois jamais de vrai `leave` — le peer peut alors rester affiché "en ligne" indéfiniment jusqu'à un hard refresh.

### 4.2 Portée : présence plateforme entière, pas juste "messagerie ouverte"

**Décision importante** : le statut "en ligne" affiché dans la messagerie doit refléter la présence de l'utilisateur sur **toute la plateforme** (n'importe quelle page), pas seulement quand il a la page Messages ouverte. Sinon quitter Messages pour une autre page fait immédiatement passer le peer à "hors ligne" à tort, alors qu'il est toujours actif ailleurs sur l'app.

Conséquence architecturale : la présence **ne peut pas** vivre dans le composant de messagerie lui-même (démonté/remonté à chaque navigation, voir §11) — elle doit vivre dans le **layout**, qui reste monté tant que l'utilisateur navigue dans une même section (coach ou élève) de la plateforme.

- `lib/GlobalPresenceContext.tsx` expose deux providers :
  - `GlobalPresenceClientProvider` (monté dans `app/(client)/layout.tsx`) — un seul canal (le coach est le seul peer possible), expose `useGlobalClientPresence() → { coachOnline: boolean }`.
  - `GlobalPresenceCoachProvider` (monté dans `app/(coach)/layout.tsx`) — un canal **par élève** du coach (`clients` table), expose `useGlobalCoachPresence() → { isClientOnline(clientId): boolean }`.
- Le composant messagerie ne calcule plus rien lui-même pour "en ligne/hors ligne" — il consomme juste `const { coachOnline } = useGlobalClientPresence();` (ou l'équivalent coach).
- Le canal `presence-chat-${clientId}` (local à la messagerie) **reste utilisé**, mais uniquement pour le broadcast `typing` (§5) — plus pour le calcul de présence.

### 4.3 Solution : ne jamais faire confiance au seul état du canal

Pattern retenu (inspiré Slack/Discord — heartbeat + TTL, jamais un booléen de connexion seul), appliqué au canal `global-presence-${clientId}` :

1. **Canal par élève** : `global-presence-${clientId}`, avec `config: { presence: { key: userId } }` — chaque participant a sa propre clé (son `auth.users.id`).

2. **`track()` initial** au `SUBSCRIBED` :
   ```ts
   ch.track({ user_id: userId, role: 'coach' /* ou 'client' */, online_at: new Date().toISOString() });
   ```

3. **`sync` event** — reçu par chaque participant dès que l'état de présence du canal change. On lit `ch.presenceState()`, on cherche l'entrée du **peer** (clé ≠ la sienne, `role` opposé), et on retient son `online_at` :
   ```ts
   ch.on('presence', { event: 'sync' }, () => {
     const state = ch.presenceState();
     const peerEntry = Object.entries(state).find(([key, entries]) =>
       key !== userId && entries.some(e => e.role === 'client' /* ou 'coach' */));
     if (peerEntry) { lastPeerSeenRef.current = Date.now(); setPeerOnline(true); }
     else { lastPeerSeenRef.current = null; setPeerOnline(false); }
   });
   ```

4. **Heartbeat applicatif** : re-`track()` toutes les **60 secondes** (pas plus fréquent — voir 4.5) tant que la page est visible :
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
   Et sur retour réseau : `window.addEventListener('online', () => { retryAttemptRef.current = 0; setRetryKey(k => k+1); })` — `retryKey` est une dépendance du `useEffect` qui crée le canal, donc l'incrémenter force sa recréation complète.

8. **Backoff exponentiel sur les retries** — **critique** :
   ```ts
   const delay = Math.min(1000 * 2 ** attempt, 30_000); // 1s, 2s, 4s... plafonné à 30s
   ```
   Sans backoff, une erreur de canal déclenche un retry immédiat → nouveau `track()` → peut re-déclencher le rate limit Supabase Realtime sur les événements de présence (`ClientPresenceRateLimitReached`, confirmé en prod via les logs Realtime) → nouvelle erreur → boucle qui ne se résout jamais. C'est la cause racine constatée du bug "les deux appareils toujours hors ligne l'un pour l'autre".

9. **`worker: true` sur le client Realtime** (`createClient({ worker: true, heartbeatIntervalMs: 15_000 })`) — déporte le heartbeat bas niveau du WebSocket dans un Web Worker, insensible au throttling de timers que les navigateurs appliquent aux onglets en arrière-plan longue durée. Le SDK Supabase embarque le script worker dans un `Blob` local (`URL.createObjectURL`), donc aucune requête réseau externe, aucun risque de blocage CSP.

### 4.4 Cas particulier côté coach : un canal par élève

Le coach a potentiellement plusieurs élèves — `GlobalPresenceCoachProvider` ouvre **un canal par `clientId`** (liste récupérée via `clients.coach_id = user.id`), chacun avec son propre cycle heartbeat/TTL/retry indépendant, agrégés dans une seule `Record<clientId, boolean>` exposée via `isClientOnline(clientId)`. Le cleanup doit itérer et démonter chaque canal individuellement au démontage du provider (changement de liste d'élèves, déconnexion).

### 4.5 Rate limit Supabase Realtime — leçon apprise

Diagnostiqué via les **logs Realtime réels du projet** (`mcp Supabase get_logs`, service `realtime`) : `ClientPresenceRateLimitReached: client_rate_limit_exceeded`. Le rate limit de présence est sensible au **nombre d'événements `track()`/`untrack()` par seconde**, pas juste au nombre d'utilisateurs connectés. Un heartbeat à 20s combiné à des retries immédiats suffit à l'atteindre avec seulement 2 appareils. Réglages qui tiennent en prod : heartbeat 60s, TTL 150s, backoff exponentiel sur les retries.

### 4.6 Timers d'arrière-plan potentiellement gelés — check TTL synchrone au réveil

Le `setInterval` de vérification du TTL (point 5, §4.3) suppose qu'il continue de s'exécuter toutes les `STALE_CHECK_MS` pendant toute la durée de vie du composant. Sur mobile, quand l'app passe en arrière-plan **profond** (écran verrouillé, pas juste onglet caché), l'OS peut **complètement geler** le process JS — pas seulement le throttler. Dans ce cas, le `setInterval` ne s'exécute tout simplement pas pendant l'absence, et le TTL n'a jamais l'occasion de rattraper un statut périmé pendant les minutes de verrouillage — le prochain tick programmé ne se déclenche qu'au réveil, sans garantie de délai précis.

Fix : en plus du `setInterval` périodique, faire un check TTL **synchrone immédiat** dans le handler `visibilitychange` lui-même, au retour `visible` :
```ts
const handleVisibility = () => {
  if (!isSubscribedRef.current) return;
  if (document.visibilityState === 'hidden') {
    ch.untrack();
  } else {
    track();
    // Ne pas attendre le prochain tick du setInterval, potentiellement gelé pendant l'absence.
    if (lastCoachSeenRef.current !== null && Date.now() - lastCoachSeenRef.current > STALE_TTL_MS) {
      setCoachOnline(false);
    }
  }
};
```
`Date.now()` reflète toujours l'heure réelle au réveil, indépendamment de si les timers ont tourné pendant l'intervalle — donc ce check reste fiable même après un gel complet du process.

## 5. Indicateur "en train d'écrire"

Utilise le canal **local à la conversation** (`presence-chat-${clientId}` — pas le canal de présence globale, voir §4.2), via `broadcast` (pas `presence`) :

- Émission, throttlée à **2 secondes** côté frappe (pas à chaque keystroke) :
  ```ts
  if (now - lastTypingSentRef.current > 2000) {
    lastTypingSentRef.current = now;
    ch.send({ type: 'broadcast', event: 'typing', payload: { role: 'client' } });
  }
  ```
- Réception, avec extinction après **4 secondes** sans nouveau broadcast :
  ```ts
  ch.on('broadcast', { event: 'typing' }, payload => {
    if (payload.payload?.role === 'coach') {
      setCoachTyping(true);
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setCoachTyping(false), 4000);
    }
  });
  ```

**Piège 1 corrigé — marge émission/extinction trop fine** : avec 2.5s d'émission et 3s d'extinction (réglage initial), la marge de 500ms était trop fine pour absorber la latence réseau variable — constaté surtout sur mobile (latence 4G plus irrégulière que PC-à-PC) : l'indicateur **clignotait** (s'éteignait puis se rallumait) entre deux broadcasts. Fix : émission resserrée à 2s, extinction élargie à 4s — marge de 2s.

**Piège 2 corrigé — timer non réinitialisé au cleanup** : si le canal est recréé (retry, retour d'arrière-plan) **entre** le `setCoachTyping(true)` et l'expiration du timer, le cleanup de l'effet annule le timer (`clearTimeout`) mais oubliait de repasser `coachTyping` à `false` — l'indicateur restait bloqué affiché indéfiniment ("En train d'écrire…" visible en permanence, constaté en usage réel). **Toujours réinitialiser l'état dans le cleanup, pas seulement annuler le timer** :
```ts
return () => {
  if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  setCoachTyping(false); // pas juste clearTimeout — sinon le state reste bloqué à true
};
```

**Piège 3 corrigé — animation des points qui semble s'interrompre (mobile uniquement)** : le state lui-même restait stable (l'espace réservé sous le dernier message ne clignotait pas), mais l'**animation CSS** des 3 points (`@keyframes` infinie) donnait l'impression de s'arrêter et repartir, uniquement sur mobile réel (pas reproductible en simulateur responsive desktop). Cause : le conteneur de l'indicateur portait la classe `msg-bubble-in` (animation d'entrée fade+translateY, pensée pour les nouvelles bulles de message) alors qu'il reste monté en continu tant que `coachTyping`/`clientTyping` est `true` — sur certains moteurs de rendu mobiles, ça semble interagir avec l'animation infinie des points. Fix : retirer `msg-bubble-in` de ce conteneur spécifique (il n'a pas besoin d'animation d'entrée).

## 6. Scroll — `column-reverse`, ancrage bas natif du navigateur

### 6.0 Historique — pourquoi ce système a remplacé l'ancien

**L'ancien système** (scroll `column` classique + ~150 lignes de rustines par fichier : `settlingRef`, boucle `requestAnimationFrame` continue pendant 2.5s, deux `ResizeObserver` de rattrapage, `stickToBottomRef`/`stickToDividerRef`, handlers de geste dédiés) souffrait d'un bug persistant et non reproductible en dev local : au premier tap après un cold start de la PWA, le scroll "sautait" de plusieurs messages vers le haut.

**Cause racine**, prouvée par une sonde de diagnostic temporaire tracant `scrollHeight`/`scrollTop` à chaque frame + `document.fonts.ready` : au moment exact où les polices web (Inter, `display:'swap'`) finissaient de charger, `scrollHeight` grossissait de +1810px alors que `scrollTop` restait **rigoureusement figé** — un pur reflow de contenu (bascule police système → Inter, texte qui prend plus de place), jamais un scroll. C'est pour ça qu'aucune instrumentation `scrollTop`/`scroll` native n'a jamais rien capturé au moment du bug, malgré 7 tentatives de fix successives basées sur cette hypothèse.

**Fix (commit `dec462c`)** : `flex-direction: column-reverse`. Plutôt que de corriger le scroll après coup à chaque reflow détecté, on élimine le problème par construction — le navigateur ancre nativement en bas dans ce mode de layout, donc un contenu qui grandit pousse vers le haut **hors du viewport visible** au lieu de décaler la vue actuelle. Confirmé résolu en usage réel (cold start PWA, tap immédiat).

### 6.1 CSS — le renversement de layout

```tsx
<div className="chat-messages-zone" style={{ flexDirection: 'column-reverse', ... }}>
```
En `column-reverse`, le navigateur traite le **premier enfant DOM** comme le bas visuel de la zone, et ancre automatiquement la position de scroll dessus (comportement natif, aucun JS requis) — c'est le mécanisme utilisé par WhatsApp Web/Discord/Telegram. `scroll-behavior: smooth` et `overflow-anchor: none` (CSS globaux, `globals.css`) restent inchangés et compatibles.

### 6.2 Rendu JSX en ordre inversé

Puisque `column-reverse` inverse déjà visuellement l'ordre des enfants, le JSX doit être rendu en ordre **inverse** de la chronologie pour que le résultat affiché reste correct (plus ancien en haut, plus récent en bas) :

```tsx
{messageGroups.slice().reverse().map(group => (
  <div key={group.dateLabel} style={{ flexDirection: 'column-reverse' }}>
    {group.msgs.slice().reverse().map((msg, revIdx, revArr) => {
      const msgIdx = revArr.length - 1 - revIdx; // index chronologique réel, pour isContinued/isLast
      // ... <MessageBubble ... />
      // ... divider "Nouveaux messages" si firstUnreadId === msg.id
    })}
    {/* Séparateur de date — dernier enfant DOM du groupe = visuellement au-dessus, grâce à column-reverse */}
    <div>{group.dateLabel}</div>
  </div>
))}
```
Le `TypingIndicator` (§5) est rendu en **premier** dans le JSX (= visuellement en bas). `messages` (le state) **reste trié chronologiquement croissant** (`.order('created_at', {ascending:true})`, §2) — seul le rendu est inversé via `.slice().reverse()`, jamais le state lui-même (`isContinued`/`isLast` ont encore besoin de l'ordre chronologique réel pour comparer voisin précédent/suivant).

### 6.3 Flèche scroll-bas — cross-navigateur

En `column-reverse`, "être en bas" correspond à `scrollTop ≈ 0` (pas `scrollHeight` comme en `column` classique) — mais le signe diffère selon le moteur de rendu : Chrome/Firefox utilisent des valeurs **négatives** croissantes en valeur absolue à mesure qu'on remonte, WebKit reste historiquement **positif**. `Math.abs()` couvre les deux sans détection de navigateur :
```ts
function handleChatScroll(e: React.UIEvent<HTMLDivElement>) {
  const distanceFromBottom = Math.abs(e.currentTarget.scrollTop);
  setShowScrollArrow(distanceFromBottom > 120);
}
function scrollToBottom() {
  chatZoneRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
}
```

### 6.4 Atterrir sur le premier message non lu (pattern WhatsApp/Telegram) — inchangé dans son principe

Toujours en place : si des messages non lus existent à l'ouverture, on atterrit sur un séparateur "Nouveaux messages" plutôt que tout en bas — `scrollIntoView({block:'center'})` reste valide et se comporte identiquement en `column-reverse` (l'API ne dépend pas de la direction du flex).

Calcul figé **une seule fois** par ouverture de conversation (`firstUnreadComputedRef`), sinon le divider disparaîtrait dès que les messages commencent à être marqués lus au fil du scroll :
```ts
useLayoutEffect(() => {
  if (loading) return;
  const container = chatZoneRef.current;
  if (!container) return;
  if (!knownIdsRef.current) knownIdsRef.current = new Set(messages.map(m => m.id));
  else messages.forEach(m => knownIdsRef.current!.add(m.id));

  if (!firstUnreadComputedRef.current) {
    firstUnreadComputedRef.current = true;
    const firstUnread = messages.find(m => m.sender_id !== userId && !m.read_at);
    if (firstUnread) { setFirstUnreadId(firstUnread.id); return; } // re-render → divider monté
  }
  if (initialLandingDoneRef.current) return;
  initialLandingDoneRef.current = true;
  const divider = firstUnreadId ? document.getElementById(`unread-divider-${clientId}`) : null;
  if (divider) divider.scrollIntoView({ behavior: 'instant', block: 'center' });
  // (sans divider : column-reverse ancre déjà en bas nativement, rien à faire)
  setContentReady(true);
  suppressAutoReadRef.current = false;
}, [messages, loading, firstUnreadId, clientId, userId]);
```
Un seul `useLayoutEffect` (exécution synchrone avant paint, évite le flash), pas de `stickToBottomRef`/`stickToDividerRef` distincts : plus besoin de "protéger" activement une position pendant une fenêtre de stabilisation, puisque le navigateur ne la fait plus dériver.

### 6.5 Masquage anti-flash — réduit au strict nécessaire

```tsx
style={{ visibility: (!loading && messages.length > 0 && !contentReady) ? 'hidden' : 'visible' }}
```
Contrairement à l'ancien système, ce masquage ne sert **plus qu'au cas "atterrissage sur un divider non-lu"** (le temps que `scrollIntoView` soit posé). Sans non-lus, `column-reverse` ancre déjà en bas dès le tout premier paint — aucun flash possible, `contentReady` n'a même pas besoin d'être consulté dans ce cas (mais reste simple à laisser tel quel, le coût est négligeable).

### 6.6 Refaire le calcul au retour d'arrière-plan — inchangé dans son principe, simplifié dans le détail

Le composant peut rester monté longtemps (PWA jamais fermée, juste mise en arrière-plan) sans que `loading` ne repasse jamais à `true` — sans reset dédié, le calcul du premier non-lu ne se referait jamais pour les messages arrivés pendant l'absence. Un listener `visibilitychange` avec seuil de 5s (ignore les micro blur/focus) refait le même reset qu'au chargement initial :
```ts
const resetLanding = useCallback(() => {
  firstUnreadComputedRef.current = false;
  initialLandingDoneRef.current = false;
  knownIdsRef.current = null;
  suppressAutoReadRef.current = true;
  setFirstUnreadId(null);
  setContentReady(false);
}, []);
useEffect(() => { if (loading) resetLanding(); }, [loading, resetLanding]);
useEffect(() => {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') { hiddenAtRef.current = Date.now(); return; }
    const wasHiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
    hiddenAtRef.current = null;
    if (wasHiddenFor >= 5000) resetLanding();
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => document.removeEventListener('visibilitychange', onVisibility);
}, [resetLanding]);
```
**Différence clé avec l'ancien système** : plus besoin du compteur `resetTick` (piège documenté historiquement — `setFirstUnreadId(null)` ne redéclenche pas l'effet si la valeur était déjà `null`, React bail-out sur `Object.is`). Ici `initialLandingDoneRef.current = false` suffit à lui seul à refaire atterrir le `useLayoutEffect` au prochain changement de `messages` (nouveaux messages arrivés pendant l'absence redéclenchent de toute façon l'effet via sa dépendance `[messages, ...]`) — le risque de blocage silencieux qui justifiait `resetTick` n'existe plus dans cette version simplifiée, il n'y a plus de `visibility:hidden` permanent possible puisque `contentReady` ne bloque plus rien de critique pour l'interaction (le scroll manuel fonctionne même si `contentReady` reste `false` par accident, contrairement à avant).

### 6.7 Ce qui a disparu — plus nécessaire

Supprimés entièrement (le navigateur gère maintenant nativement ce que ces mécanismes patchaient) :
- `settlingRef` + la boucle `requestAnimationFrame` continue de 2.5s (rattrapait le scroll bas à chaque frame pendant la fenêtre de stabilisation).
- Les deux `ResizeObserver` (un sur les enfants de la zone, un sur `visualViewport` pour la barre d'adresse mobile) — plus besoin de détecter un grossissement de contenu pour le compenser, il n'a plus d'effet visible.
- `stickToBottomRef`/`stickToDividerRef` — remplacés par le simple ancrage natif + un seul atterrissage one-shot (§6.4).
- `handleTouchStart`/`handleTouchMove`/`handlePointerDown`/`handleWheel`/`userGestureRef` — servaient à détecter un vrai geste utilisateur pour désarmer la boucle de stabilisation sans la couper sur un simple tap ; sans boucle à désarmer, ces handlers n'ont plus de rôle.
- Le compteur `resetTick` (§6.6 ci-dessus).
- `initialScrollDone` (ref) — remplacé par `initialLandingDoneRef`, même rôle mais portée réduite au seul atterrissage initial.

### 6.8 Viewport mobile (`useViewportShellHeight`) — inchangé, hors sujet scroll

Le hook `useViewportShellHeight` (§8) continue de corriger la hauteur du shell via `visualViewport.resize` — ça reste nécessaire pour que `.chat-messages-zone` (`flex:1`) ait la bonne hauteur disponible. Seul le bloc qui forçait un **rescroll** en réaction à ce resize (parce que l'ancien système en `column` classique perdait sa position bas quand la hauteur changeait après coup) a été retiré côté messagerie — `column-reverse` reste ancré en bas automatiquement même quand le conteneur change de hauteur, aucune compensation JS n'est nécessaire.

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

## 9. Navigation SPA (App Router) — pourquoi ça "juste marche" sans code dédié

Question posée : si l'utilisateur reste sur la plateforme (jamais d'arrière-plan/verrouillage), navigue vers une autre page, reçoit des messages en push, puis revient sur Messages — voit-il bien le séparateur "Nouveaux messages" ?

Réponse : **oui, sans code supplémentaire**, grâce au routing Next.js App Router. `/client/messages` et `/messages` (coach) sont des **routes** distinctes (fichiers `page.tsx` séparés) — naviguer vers une autre route démonte **complètement** le composant `PageClientMessages`/`PageChat`, contrairement à un simple changement d'onglet interne (tabs) qui garderait le composant monté avec `display:none`.

Au retour sur la route Messages, le composant est **remonté depuis zéro** :
- `loading` repart à `true` → `useEffect` de chargement initial refait un `fetch` frais des messages (avec les `read_at` à jour).
- Tous les refs (`firstUnreadComputedRef`, `initialScrollDone`, etc.) repartent à leur valeur initiale (nouvelle instance de composant).
- Le calcul du premier non-lu (§6.4) s'exécute normalement sur des données fraîches.

C'est donc le **même chemin de code** que le tout premier chargement de l'app — pas besoin de dupliquer la logique de reset (§6.4bis) pour ce cas, qui ne concerne que le scénario où le composant **reste monté** (page Messages jamais quittée, juste mise en arrière-plan/verrouillée).

**Point de vigilance pour la présence** : comme la présence en ligne/hors ligne vit maintenant dans le layout (§4.2), pas dans le composant Messages, elle **n'est pas** affectée par ce démontage/remontage — elle continue de tourner en continu tant que l'utilisateur reste dans la même section de la plateforme (coach ou élève), peu importe la page affichée.

## 10. Notifications forcées à l'installation PWA

`components/PushPermissionGate.tsx`, monté dans les deux layouts, au-dessus de tout le reste (`z-index: 99999`).

- Ne s'affiche **qu'en mode standalone** (app réellement ajoutée à l'écran d'accueil), détecté via :
  ```ts
  window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true // iOS
  ```
  Pas affiché en simple onglet navigateur — l'utilisateur n'a pas forcément l'intention de recevoir des notifs juste en visitant le site.
- Tant que `Notification.permission !== 'granted'`, écran plein bloquant avec un bouton qui déclenche `Notification.requestPermission()` — **nécessite un geste utilisateur explicite**, impossible à déclencher automatiquement (contrainte iOS/navigateur, pas du code).
- "Plus tard" laisse passer une fois par session (`sessionStorage`) — réapparaît à la prochaine ouverture complète de l'app tant que la permission n'est pas accordée.
- Cas `denied` (refusé explicitement) : JS ne peut plus rouvrir la popup native — affiche les étapes pour réactiver manuellement dans les réglages du téléphone plutôt qu'un bouton qui ne ferait rien.

## 11. Récapitulatif des refs/state clés (par conversation)

| Nom | Type | Rôle |
|---|---|---|
| `messages` | state | Liste complète des messages (ordre chronologique croissant), source de vérité du rendu — le rendu JSX seul est inversé (§6.2), pas ce state |
| `loading` | state | Chargement initial en cours |
| `contentReady` | state | Pilote le masquage anti-flash (`visibility`) — utile seulement pour l'atterrissage sur un divider non-lu depuis la refonte column-reverse (§6.5) |
| `firstUnreadId` | state | ID du premier message non lu (pour le divider) |
| `firstUnreadComputedRef` | ref | Le calcul du premier non-lu a eu lieu (figé, une fois par ouverture/retour d'arrière-plan) |
| `initialLandingDoneRef` | ref | L'atterrissage initial (divider ou bas natif) a été posé une fois — remplace l'ancien `initialScrollDone` |
| `suppressAutoReadRef` | ref | Bloque le marquage auto tant que `firstUnreadComputedRef` n'a pas tranché |
| `knownIdsRef` | ref | IDs déjà présents au chargement — pilote l'animation d'entrée des bulles (seuls les nouveaux messages l'ont) |
| `hiddenAtRef` | ref | Timestamp de mise en arrière-plan — sert à mesurer la durée d'absence (seuil 5s) avant de refaire le reset "premier non-lu" au retour (§6.6) |
| `isSubscribedRef` | ref | Le canal `presence-chat-*` (typing) est `SUBSCRIBED` |
| `presenceRetryKey` | state | Incrémenté pour forcer la recréation du canal typing |
| `retryAttemptRef` | ref | Compteur pour le backoff exponentiel (canal typing) |

*(`lastCoachSeenRef`/`lastPeerSeenRef`, `presenceIsSubscribedRef` équivalents vivent maintenant dans `lib/GlobalPresenceContext.tsx`, pas dans le composant messagerie — voir §4.)*

**Retirés avec la refonte column-reverse (§6.7), n'existent plus** : `initialScrollDone` (remplacé par `initialLandingDoneRef`), `stickToBottomRef`, `stickToDividerRef`, `settlingRef`, `userGestureRef`, `resetTick`. Le navigateur gère nativement ce qu'ils patchaient.

| `listenTimerRef` | ref (par `AudioBubble`) | Timer du seuil "écouté" (MIN 1.5s/durée totale) posé au `play`, annulé au `pause` (§13.2) |
| `positionKey` (`localStorage`) | clé externe (par `AudioBubble`) | Position de lecture (`currentTime`) persistée par vocal, survit démontage ET refresh complet (§13.5) |

## 13. Messages vocaux — "vu" vs "écouté", et reprise de lecture

### 13.1 Pourquoi `read_at` ne suffit pas pour l'audio

`read_at` (§7) se déclenche dès que la bulle traverse le viewport (IntersectionObserver) — pour un vocal, ça veut juste dire "l'utilisateur a fait défiler jusqu'à la bulle", pas "il a cliqué play et écouté". D'où une colonne dédiée `listened_at`, mise à jour uniquement quand l'audio a réellement été lancé.

### 13.2 Seuil de déclenchement — signal binaire façon WhatsApp/Telegram

Comme WhatsApp/Telegram : pas de seuil en % du vocal écouté, juste "play réellement enclenché" — avec une garde anti-clic-accidentel. Le seuil est `MIN(1.5s, durée totale du vocal)`, pour qu'un vocal très court (1-2s) ne soit jamais structurellement impossible à marquer écouté :

```ts
const onPlay = () => {
  if (listened || !onListened) return;
  const dur = el.duration || currentDuration || 0;
  const threshold = dur > 0 ? Math.min(1500, dur * 1000) : 1500;
  if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
  listenTimerRef.current = setTimeout(() => onListened(id), threshold);
};
const onPause = () => {
  if (listenTimerRef.current) { clearTimeout(listenTimerRef.current); listenTimerRef.current = null; }
};
```
Une pause avant l'écoulement du seuil annule le marquage — remettre en lecture repose un timer complet (pas de cumul du temps déjà écouté entre plusieurs pauses ; comportement volontairement simple, comme WhatsApp).

### 13.3 Deux mécanismes distincts, affichés à deux endroits différents

Point de confusion initial à ne pas reproduire : une pastille "non écouté" et les coches de statut ne répondent **pas** à la même question, et coexistent volontairement :

1. **Pastille rouge sur le bouton play**, affichée uniquement sur les vocaux **reçus** (`onListened` défini seulement pour `!isMe`) et non encore écoutés — un rappel personnel pour le destinataire ("tu n'as pas encore écouté ce vocal"), pas une info pour l'expéditeur.
   ```tsx
   {onListened && !listened && (
     <span style={{ position: 'absolute', top: -1, right: -1, width: 9, height: 9,
       borderRadius: '50%', background: 'var(--red)', border: '2px solid var(--surface)' }} />
   )}
   ```
2. **`MessageStatus` (coches)**, affiché sur les messages **envoyés** — informe l'expéditeur si son vocal a été écouté. Pour l'audio, la logique bascule de `read_at` à `listened_at` :
   ```ts
   const isRead = isAudio ? !!listenedAt : !!readAt;
   ```

### 13.4 Piège corrigé — update fire-and-forget sans `await` ni gestion d'erreur

**Bug constaté en usage réel** : la pastille pouvait réapparaître après avoir écouté un vocal, changé de page, puis être revenu sur la messagerie — et symétriquement, les coches ne passaient jamais côté expéditeur alors que le destinataire avait bien écouté.

Cause : le premier jet de `markMessageListened` faisait l'update Supabase **sans `await`, sans `.then()`, sans gestion d'erreur** :
```ts
// AVANT — buggé
supabase.from('messages').update({ listened_at: new Date().toISOString() }).eq('id', msgId);
```
Le state local était mis à jour de façon optimiste dans le même appel, donc l'UI locale semblait correcte immédiatement — mais rien ne garantissait que la requête réseau avait réellement abouti avant que l'utilisateur change de page. Si la navigation (démontage du composant, changement de route App Router — §9) survient dans la fraction de seconde qui suit le déclenchement du timer d'écoute, le `fetch` sous-jacent peut être annulé en plein vol par le navigateur : le state local reste optimiste, la DB ne reçoit jamais le `UPDATE`. Au remontage (retour sur la page), le fetch initial (§2) récupère la vraie valeur en base — toujours `null` — et la pastille "revient".

Fix : `.then()` avec vérification d'erreur, et **revert de l'optimisme si l'update échoue réellement** (RLS, réseau) :
```ts
const markMessageListened = useCallback((msgId: string) => {
  const ts = new Date().toISOString();
  let shouldPersist = false;
  setMessages(prev => {
    const msg = prev.find(m => m.id === msgId);
    if (!msg || msg.listened_at) return prev;
    shouldPersist = true;
    return prev.map(m => m.id === msgId ? { ...m, listened_at: ts } : m);
  });
  if (!shouldPersist) return;
  supabase.from('messages').update({ listened_at: ts }).eq('id', msgId).then(({ error }) => {
    if (error) setMessages(prev => prev.map(m => m.id === msgId ? { ...m, listened_at: null } : m));
  });
}, [supabase]);
```
Un `.then()` posé sur un appel Supabase JS laisse le navigateur garder la requête en vol même après un changement de route (contrairement à une requête simplement "lancée et oubliée" sans handler attaché, plus vulnérable à l'annulation) — c'est la correction qui a réellement stabilisé le comportement en usage réel.

**Policies RLS vérifiées et écartées comme cause** (`pg_policies` sur `messages`) : la policy `UPDATE` "messages mark read by recipient" autorise déjà `sender_id <> auth.uid()` pour toute mise à jour par le destinataire (elle ne restreint pas aux seules colonnes `read_at`/`read`) — donc RLS n'était pas le blocage ; la cause était bien la race condition réseau ci-dessus.

### 13.5 Reprise de lecture — position persistée en `localStorage`

Nouvelle demande : si un vocal est mis en pause en cours de lecture, la reprise doit se faire exactement à la position quittée — y compris après un changement de page (démontage du composant, §9) ou un **refresh complet du navigateur** (donc pas juste un ref/state React, qui ne survit à aucun des deux).

Clé `localStorage` par message (`audio-pos-${id}`), écrite à chaque `timeupdate`/`pause`, lue et appliquée à `loadedmetadata`, effacée à `ended` :
```ts
const positionKey = `audio-pos-${id}`;

const onTimeUpdate = () => {
  setProgress((el.currentTime / dur) * 100);
  try { localStorage.setItem(positionKey, String(el.currentTime)); } catch {}
};
const onEnded = () => {
  setActive(null); setProgress(0);
  try { localStorage.removeItem(positionKey); } catch {}
};
const onLoaded = () => {
  if (el.duration && !isNaN(el.duration)) setCurrentDuration(el.duration);
  try {
    const saved = parseFloat(localStorage.getItem(positionKey) || '');
    if (!isNaN(saved) && saved > 0 && saved < el.duration) {
      el.currentTime = saved;
      setProgress((saved / el.duration) * 100);
    }
  } catch {}
};
const onPause = () => {
  if (listenTimerRef.current) { clearTimeout(listenTimerRef.current); listenTimerRef.current = null; }
  try { localStorage.setItem(positionKey, String(el.currentTime)); } catch {}
};
```
Points notables :
- `preload="metadata"` sur l'élément `<audio>` (déjà en place pour l'affichage de la durée) suffit à déclencher `loadedmetadata` **au montage**, donc la restauration s'applique même sans que l'utilisateur ait re-cliqué play.
- Écriture à `timeupdate` (pas seulement à `pause`) pour couvrir le cas d'un démontage brutal du composant (changement de route) pendant la lecture, sans passer par `onPause`.
- Fonctionne symétriquement pour les vocaux envoyés et reçus (pas de restriction `isMe`, contrairement à la pastille §13.3) — décision : cohérent de pouvoir se réécouter son propre vocal envoyé et reprendre où on s'était arrêté.
- `try/catch` autour de chaque accès `localStorage` : Safari en navigation privée peut lever une exception sur `setItem` (quota 0) — ne doit jamais faire planter la lecture audio elle-même.

## 15. Répondre à un message + Copier le texte

### 15.1 Découplage du menu contextuel de `isMe`

Avant cette feature, `MessageContextMenu` (§ voir `MessageBubble`) ne s'ouvrait **que** sur ses propres messages : `canOpenMenu = isMe && (canEdit || canDelete) && !isEditing && !isMenuTarget`. Pour permettre "Répondre"/"Copier" sur les messages **reçus**, la condition d'ouverture est découplée des actions qu'elle propose :
```ts
const canOpenMenu = !isEditing && !isMenuTarget; // s'ouvre sur tout message, isMe ou non
```
À l'intérieur du menu, chaque action reste conditionnée séparément : "Répondre" toujours affiché, "Copier" seulement si le message est du texte pur (`!msg.type || msg.type === 'text'` — inutile sur un vocal/image/document), "Modifier"/"Supprimer" toujours réservés à `isMe` (logique inchangée). Le fallback "Délai dépassé" ne doit s'afficher que `isMe && !canEdit && !canDelete` — sinon un message reçu l'affichait à tort puisqu'il n'a jamais `canEdit`/`canDelete` à `true`.

Conséquence sur le positionnement du menu (`CTX_MENU_HEIGHT` devenue `CTX_MENU_ITEM_HEIGHT`, hauteur dynamique) : le nombre d'items affichés varie maintenant de 1 (juste "Répondre", sur un vocal reçu ancien) à 4 (Répondre + Copier + Modifier + Supprimer, sur son propre message texte récent) — la hauteur réservée pour choisir d'ouvrir au-dessus ou en-dessous de la bulle doit refléter ce nombre réel, pas une constante fixe.

### 15.2 Pas de duplication de texte cité en DB

`messages.reply_to_id uuid null references messages(id) on delete set null`. Décision technique : **ne pas** stocker de snapshot du texte cité au moment de la réponse. Comme tout l'historique de la conversation est déjà chargé en mémoire (§2, pas de pagination), un lookup local dans le state suffit :
```ts
const messagesById = new Map(messages.map(m => [m.id, m])); // une fois par changement de `messages`
// dans MessageBubble :
const quotedMsg = msg.reply_to_id ? messagesById.get(msg.reply_to_id) : undefined;
```
Si `quotedMsg` est `undefined` (message supprimé entre-temps, retiré du state par le DELETE realtime — §3), afficher "Message supprimé". `ON DELETE SET NULL` en DB reste un filet de sécurité (la ligne ne pointe jamais vers un ID orphelin), mais l'affichage réel repose sur ce lookup local, pas sur une jointure serveur.

**Piège de perf évité** : un `.find()` par bulle affichée serait O(n) par bulle, donc O(n²) sur toute la conversation. La `Map` est construite **une fois** au niveau du composant conversation (pas dans `MessageBubble`) et passée en prop.

### 15.3 Bandeau de citation — placé hors des blocs conditionnels de la barre du bas

La barre de saisie a trois états mutuellement exclusifs : texte normal, preview `pendingFile`, `RecordingOverlay` pendant l'enregistrement vocal. Le bandeau "en train de répondre à…" doit rester visible **peu importe lequel de ces trois états est actif** — il est donc placé **avant** les trois blocs conditionnels dans le JSX, pas à l'intérieur d'un seul d'entre eux. Sinon, démarrer un enregistrement vocal en cours de réponse ferait disparaître le contexte de la réponse sans prévenir.

```tsx
{replyingTo && (
  <div>{/* nom expéditeur cité + aperçu tronqué + croix d'annulation */}</div>
)}
{pendingFile && (/* ... */)}
{isRecording && (/* ... */)}
{!isRecording && !pendingFile && (/* barre normale */)}
```

`replyingTo` (state `Msg | null`) est réinitialisé **après succès** de l'insert dans les trois chemins d'envoi (`sendMessage`, `sendAudioMessage`, `sendFile`) — pas avant, pour ne pas perdre le contexte si l'envoi échoue.

### 15.4 Scroll + highlight vers le message original

Réutilise le mécanisme déjà en place pour le divider "Nouveaux messages" (§6.4) : `bubbleRefsMap`/`registerBubbleRef`, une `Map<string, HTMLDivElement>` déjà peuplée par bulle montée.
```ts
function scrollToMessage(msgId: string) {
  const el = bubbleRefsMap.current.get(msgId);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('msg-flash-highlight');
  setTimeout(() => el.classList.remove('msg-flash-highlight'), 1200);
}
```

**Piège CSS évité — style inline vs classe** : la bulle a déjà un `background` **inline** (`isMe ? 'var(--ink)' : 'var(--surface)'`). Une classe CSS qui tenterait d'animer `background-color` directement sur cet élément serait **sans aucun effet** (un style inline gagne toujours sur une règle de classe, sauf `!important`). Solution : un overlay `::after` en pseudo-élément, positionné en `absolute inset:0` par-dessus, qui ne touche jamais au `background` réel de la bulle :
```css
.msg-flash-highlight { position: relative; }
.msg-flash-highlight::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit;
  background: rgba(255, 214, 0, 0.35); animation: msg-flash-fade 1.1s ease-out forwards;
  pointer-events: none;
}
@keyframes msg-flash-fade { from { opacity: 1; } to { opacity: 0; } }
```

## 16. Légende sur image/document avant envoi

Avant cette feature, la barre de saisie texte était **complètement masquée** pendant la preview d'un fichier en attente d'envoi (`{!isRecording && !pendingFile && (...)}`) — aucun moyen d'accompagner un fichier d'un message.

`messages.caption text null` — colonne **séparée** du `text` existant (qui contient déjà le nom du fichier, utilisé pour l'affichage et l'extraction d'extension via `getFileExt`). Un `<textarea rows={1}>` compact est ajouté dans le bloc de preview `pendingFile`, sous le nom de fichier/la taille :
```tsx
<textarea value={fileCaption} onChange={e => setFileCaption(e.target.value)} placeholder="Ajouter une légende…" rows={1} />
```
`sendFile(file, caption?)` — signature étendue, insère `caption: caption?.trim() || null`. `fileCaption` est réinitialisé à la fois à l'envoi et à l'annulation (croix) du fichier en attente.

Affichage : le nom de fichier reste affiché tel quel (comportement inchangé), la légende s'ajoute **en dessous** si présente — pas de remplacement. Pour une image, où la bulle a un padding minimal (`4px`, l'image occupant presque toute la bulle), la légende est rendue dans un `<div>` séparé sous l'`<img>`, avec son propre padding — pas de changement du padding de la bulle elle-même pour ne pas casser l'affichage sans légende.

## 17. Photo de profil coach/élève

### 17.1 Policy RLS croisée — le blocage non documenté avant cette feature

Avant cette feature, la seule policy sur `profiles` était `"own profile" (ALL, auth.uid() = id)` — **un coach ne pouvait pas lire le profil de son élève, ni l'inverse**, même en JOIN depuis le client Supabase JS. Nécessaire pour que l'avatar de l'autre partie soit visible où que ce soit (header de conversation, liste de conversations coach) :
```sql
create policy "profiles readable by linked coach/client"
on public.profiles for select
using (
  exists (
    select 1 from public.clients c
    where (c.profile_id = profiles.id and c.coach_id = auth.uid())
       or (c.coach_id = profiles.id and c.profile_id = auth.uid())
  )
);
```
Additive — ne remplace pas la policy `own profile` existante, qui continue de couvrir UPDATE/DELETE de son propre profil.

### 17.2 Bucket Storage dédié, un dossier par utilisateur

Aucun des buckets existants (`chat-medias`, `voice-messages`, `instagram-avatars`...) n'était réutilisable (policies scoped par `bucket_id`). Nouveau bucket `avatars`, public en lecture, écriture restreinte au propriétaire via un chemin `avatars/${userId}/avatar.jpg` — le dossier par `userId` est **nécessaire** pour que la policy `(storage.foldername(name))[1] = auth.uid()::text` fonctionne (elle exige un vrai premier segment de dossier, pas juste `${userId}.jpg` à la racine du bucket) :
```sql
create policy "avatars upload own" on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
```
Chemin **toujours identique** par utilisateur (`upsert: true` à l'upload) — écrase l'ancienne photo à chaque nouvel upload plutôt que d'accumuler des fichiers. Conséquence : un cache-buster (`?t=${Date.now()}`) doit être ajouté à l'URL stockée en DB, sinon le navigateur/CDN continue de servir l'ancienne image en cache après un remplacement — le chemin Storage physique n'a pas changé, seule l'URL affichée doit varier pour forcer un re-fetch.

### 17.3 Recadrage carré côté client — pas de dépendance npm

`lib/cropImageToSquare.ts` : charge le `File` dans une `Image` via `URL.createObjectURL`, calcule un crop carré **centré** (`side = min(width, height)`), dessine sur un `<canvas>` 512×512 puis exporte en `Blob` JPEG qualité 0.9. Pas de repositionnement interactif (crop toujours centré) — décision volontairement simple, cohérente avec "léger, sans dépendance".

### 17.4 Composant `Avatar` étendu, pas dupliqué

`components/ui/Avatar.tsx` existait déjà (initiales uniquement), utilisé dans 6 autres pages hors messagerie (PageClientDetail, PageToday, PageClients, PageCalendar, PageClientAnalytics, PageBriefing). Une prop `avatarUrl?: string | null` optionnelle a été ajoutée plutôt que de créer un second composant — rétrocompatible (les 6 autres appelants continuent de fonctionner sans la passer), et ces pages bénéficient automatiquement de la photo si elles l'adoptent plus tard :
```tsx
export default function Avatar({ initials, avatarUrl, size = 36, className }: AvatarProps) {
  if (avatarUrl) return <img src={avatarUrl} className={`avatar${className ? ' '+className : ''}`} style={{ width: size, height: size, objectFit: 'cover' }} />;
  return <div className={`avatar${className ? ' '+className : ''}`} style={{ width: size, height: size, fontSize: size*0.35 }}>{initials}</div>;
}
```
La classe CSS `.avatar` (déjà `border-radius: 50%`) s'applique sans changement aussi bien au `<div>` qu'au `<img>`.

### 17.5 Propagation de l'avatar jusqu'à la liste de conversations coach

`lib/SupabaseClientsContext.tsx` chargeait la liste de clients via `select('*')` sur `clients` seul, sans jointure `profiles`. Un second fetch séparé (pas un embed automatique PostgREST, plus prévisible sans FK explicitement nommée) récupère les avatars et les merge en JS :
```ts
const profileIds = rawClients.map(c => c.profile_id).filter(Boolean);
const { data: avatarsData } = await supabase.from('profiles').select('id, avatar_url').in('id', profileIds);
const avatarMap = Object.fromEntries(avatarsData.map(p => [p.id, p.avatar_url]));
// merge : avatar_url: c.profile_id ? (avatarMap[c.profile_id] || null) : null
```
Fonctionne uniquement une fois la policy croisée (§17.1) appliquée — sans elle, ce fetch retournerait silencieusement un tableau vide (RLS filtre, pas d'erreur explicite).

### 17.6 Rafraîchissement immédiat après upload — `refreshUser()`

`lib/UserContext.tsx` charge le profil (dont `avatar_url`) une fois au montage et sur changement d'état d'auth — un upload de photo dans les Réglages ne déclenche ni l'un ni l'autre. Une fonction `refreshUser()` est exposée par le contexte (refait le même `loadUser` que l'effet initial, sur demande) et appelée juste après la mise à jour réussie de `profiles.avatar_url`, pour que la sidebar reflète la nouvelle photo sans nécessiter un rechargement de page.

## 19. Menu contextuel v2 — sans grossissement de bulle, lift du message

### 19.1 Suppression du clone agrandi

La v1 grossissait un clone de la bulle de 30% (`BUBBLE_SCALE`) via un `<div>` cloné (`innerHTML` copié depuis `outerHTML`) dans un portail, avec transition `cubic-bezier` façon rebond. Coûteux à maintenir (calculs de position du clone séparés du menu, `outerHTML` à transmettre) et pas fidèle à WhatsApp (captures fournies : juste le fond assombri/flouté, la bulle garde sa taille réelle). Supprimé entièrement — le fond `rgba(0,0,0,.35)` + `backdropFilter: blur(4px)` suffisait déjà seul à l'effet recherché.

Conséquence : `MessageBubble` n'a plus besoin de masquer la bulle réelle pendant que le menu est ouvert (`visibility` ne dépend plus de `isMenuTarget`, seulement de `isEditing`) — elle reste visible, potentiellement remontée par le lift (§19.2).

### 19.2 Lift du message — jamais de menu au-dessus

WhatsApp n'ouvre jamais le menu au-dessus du message : si la place manque en dessous, c'est le **message lui-même** qui remonte légèrement (pas le menu qui se repositionne). Implémenté via un `transform: translateY(-liftPx)` sur le **wrapper externe** de `MessageBubble` (jamais sur la bulle interne, qui doit garder `position:relative` pour ses propres enfants positionnés — badge de réaction §20.3, flèche hover) :

```ts
function openMenu(bubbleEl: HTMLDivElement, msg: Msg, opts: { menuOnly?: boolean } = {}) {
  const items = buildMenuItems(isMe, isTextMessage, canEditMsg(msg), canDeleteMsg(msg));
  if (!opts.menuOnly && items.length === 0) return; // rien à afficher
  const rect = bubbleEl.getBoundingClientRect();
  const menuHeight = (opts.menuOnly ? 0 : items.length * MENU_ITEM_HEIGHT) + REACTION_BAR_HEIGHT + MENU_GAP;
  const spaceBelow = window.innerHeight - rect.bottom - MENU_SCREEN_MARGIN;
  const lift = Math.max(0, (menuHeight + MENU_GAP) - spaceBelow);
  setCtxMenu({ rect, msgId: msg.id, lift, menuOnly: !!opts.menuOnly });
}
```

Le calcul se fait **une seule fois à l'ouverture** (pas de remesure après la transition) — le rect utilisé par le menu est le rect d'origine moins le lift (`rect.top - lift`), donc toujours cohérent avec la position finale de la bulle une fois translatée. Fermeture (`ctxMenu = null`) → `liftPx` redevient `0` côté `MessageBubble` → la transition CSS (`transition: 'transform 160ms ease-out'`) ramène automatiquement le message à sa place, sans code de "retour" dédié.

**Piège évité, pas rencontré en pratique** : si le contenu de la bulle changeait de taille pile pendant que le menu est ouvert (image qui finit de charger), le lift resterait basé sur l'ancien rect. Jugé négligeable — le menu reste ouvert quelques secondes, et les images ont déjà leurs dimensions connues avant qu'un long-press soit possible dessus. Pas de `ResizeObserver` de sécurité ajouté (complexité non justifiée pour ce cas).

### 19.3 Règles de contenu du menu — `buildMenuItems()` centralisé

Avant : Répondre toujours affiché (même sur ses propres messages), "Délai dépassé" en fallback. Nouvelles règles WhatsApp-like :
- Message **reçu** : Répondre + Copier (si texte).
- Message **envoyé** : Modifier (si < 15min) + Supprimer (si < 1h) + Copier (si texte) — **plus de Répondre, plus de "Délai dépassé"**. Si aucun item (message non-texte envoyé, délais expirés), le menu ne s'ouvre pas du tout.

Cette logique vit dans une fonction pure `buildMenuItems(isMe, isTextMessage, canEdit, canDelete)` (`components/pages/shared/MessageMenuParts.tsx`), appelée à **deux endroits** qui doivent rester synchronisés : `openMenu()` (pour calculer `menuHeight`/le lift) et le rendu réel du menu. Centraliser dans une seule fonction évite qu'un des deux diverge silencieusement si la règle change un jour.

### 19.4 Flèche hover desktop

Nouveau petit bouton rond (`.msg-hover-arrow`), apparaît au survol souris sur le côté extérieur de la bulle (gauche si `isMe`, droite sinon), ouvre le même menu que le clic droit — les deux coexistent. Masqué explicitement sur tout appareil sans souris réelle :
```css
@media (hover: none) { .msg-hover-arrow { display: none; } }
```
Sans cette règle, certains navigateurs mobiles peuvent simuler un `:hover` bref après un tap, laissant un résidu visuel du bouton.

## 20. Réactions emoji

### 20.1 Modèle de données — colonnes simples, pas de table dédiée

`messages.reaction_emoji`/`reaction_by` — une seule réaction par message, quel que soit qui l'a posée (conversation coach↔élève = toujours 2 personnes). Décision explicite : **pas** de table `message_reactions(message_id, user_id, emoji)` pour l'instant — inutile tant qu'il n'y a que 2 participants possibles par conversation. Si Momentum passe un jour aux conversations de groupe, migration standard vers une table dédiée (une ligne par utilisateur par message).

### 20.2 RPC dédiées plutôt qu'une policy UPDATE générale

Point de sécurité vérifié en base (`pg_policies` sur `messages`) : deux policies UPDATE existaient déjà (`sender_id = auth.uid() + fenêtre 15min` pour éditer son texte, `sender_id <> auth.uid()` pour marquer lu) — **aucune n'autorise un update sans limite de temps par un participant quelconque**. Une policy UPDATE générale pour les réactions aurait élargi le pouvoir de modification à **toutes** les colonnes (texte compris) sans limite de temps dès qu'on est participant — Postgres RLS ne restreint pas nativement par colonne, seulement par ligne.

Solution : deux fonctions RPC `SECURITY DEFINER`, chacune limitée aux 2 colonnes `reaction_*` :
```sql
create or replace function public.set_message_reaction(p_message_id uuid, p_emoji text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from messages m join clients c on c.id = m.client_id
    where m.id = p_message_id and (c.profile_id = auth.uid() or c.coach_id = auth.uid()))
  then raise exception 'not authorized'; end if;
  update messages set reaction_emoji = p_emoji, reaction_by = auth.uid() where id = p_message_id;
end; $$;
```
`clear_message_reaction(p_message_id)` est symétrique (remet les deux colonnes à `null`). N'importe quel participant peut réagir à n'importe quel message, y compris les siens (comme WhatsApp) — la vérification porte uniquement sur l'appartenance à la conversation, pas sur `sender_id`.

### 20.3 Barre de réactions + badge — toggle

8 emojis fixes (`👍❤️😂😮😢🙏🔥💪` — 7 de base WhatsApp + 🔥💪 ajoutés à la demande), bouton "+" décoratif (pas de picker complet). Cliquer le même emoji déjà posé par soi-même **retire** la réaction ; cliquer un autre **remplace** (une seule réaction par message, quel que soit l'auteur — un participant peut donc écraser la réaction de l'autre, acceptable en 1:1) :
```ts
function handleReact(msg: Msg, emoji: string) {
  if (msg.reaction_emoji === emoji && msg.reaction_by === userId) clearReaction(msg.id);
  else reactToMessage(msg.id, emoji);
}
```
Badge affiché en `position: absolute` sur la bulle (bas, côté opposé à l'expéditeur) — **toujours un enfant de la bulle interne** (déjà `position:relative`), jamais du wrapper externe transformé par le lift (§19.2) : un `transform` actif crée un nouveau containing block pour les descendants `position:absolute`, ce qui déplacerait le badge de façon incorrecte s'il était ancré sur l'élément translaté. Cliquer le badge rouvre **uniquement** la barre de réactions (`menuOnly: true` dans le state du menu), pas le menu Modifier/Supprimer/Copier complet.

## 21. AudioBubble — design WhatsApp (avatar, pointillés, curseur)

Remplace le bouton play/pause rond plein par l'avatar réel de l'expéditeur (photo ou initiales, réutilise `components/ui/Avatar.tsx`) avec un petit bouton play/pause superposé en bas à droite. La waveform passe de barres pleines à hauteur variable à des **pointillés** (petits ronds, taille fixe `2.5px`) — plus proche du rendu WhatsApp réel, où seule la couleur/position varie, pas la hauteur. Un curseur rond bleu (`#3b82f6`) avance sur la waveform pendant la lecture, positionné en `left: %` (pas en px) pour rester responsive nativement :
```tsx
<div style={{ position: 'absolute', top: '50%', left: `${progress}%`, transform: 'translate(-50%, -50%)', ... }} />
```
Le conteneur waveform doit avoir `position: relative` pour que ce curseur `absolute` se positionne bien par rapport à lui, pas à un ancêtre plus lointain.

**Avatar de l'expéditeur** : jusqu'ici `MessageBubble` ne recevait que `clientName`/`coachName` en props, jamais les URLs d'avatar. Il fallait aussi ajouter `useUser()` (absent des deux fichiers messagerie) pour connaître sa propre photo (vocaux qu'on a soi-même envoyés) :
```tsx
const { user } = useUser();
const myAvatarUrl = user?.avatar_url ?? null;
```
Toute la logique de lecture/pause/seek/persistance de position (`localStorage`)/marquage écouté (§13) reste **inchangée** — seul le rendu visuel a changé.

## 22. Bloc document — vraie miniature PDF via route API dédiée

### 22.1 Piège architectural corrigé avant implémentation

`sendFile()` faisait un **upload direct navigateur → Supabase Storage**, sans jamais passer par un serveur Next.js. La génération de miniature PDF (`pdf-to-img`, basé sur `pdfjs-dist`) nécessite `runtime = 'nodejs'` — **impossible à exécuter dans le navigateur**. Il ne suffisait donc pas de "réutiliser une fonction" : il fallait faire passer l'upload de fichier par un serveur.

`lib/pdfThumbnail.ts` extrait la fonction `generatePdfThumbnail`/`isPdfFile` (déjà en prod dans `app/api/resources/upload/route.ts` pour la page Ressources) — réutilisée par une **nouvelle route** `app/api/messages/upload-file/route.ts`, qui fait l'upload vers `chat-medias`, génère la miniature si PDF, **et insère le message directement côté serveur** (avec `thumbnail_url`/`page_count`/`file_size_bytes`).

`sendFile()` (les deux fichiers messagerie) appelle cette route via `fetch(..., { body: formData })` au lieu d'uploader lui-même :
```ts
const formData = new FormData();
formData.append('file', file);
formData.append('client_id', clientId);
const res = await fetch('/api/messages/upload-file', { method: 'POST', body: formData });
const json = await res.json();
if (res.ok && json.message) setMessages(prev => [...prev, json.message as Msg]);
```
Le message n'apparaît qu'une fois la réponse reçue (miniature générée) — cohérent avec le comportement précédent qui attendait déjà la fin de l'upload avant d'insérer. Le realtime `postgres_changes` INSERT reçoit aussi l'événement (l'insert vient du serveur), mais la garde existante (`prev.some(m => m.id === msg.id)`) évite tout doublon puisque l'ID est déjà connu localement.

### 22.2 Rendu

Aperçu de la page 1 (`msg.thumbnail_url`) si disponible, sinon zone générique avec icône PDF si l'extension est `.pdf`, sinon rien. Bandeau nom/pages/taille en dessous, puis deux vrais boutons pleine largeur séparés par une ligne (`Ouvrir` en `target="_blank"`, `Enregistrer sous...` en `<a download>`) — remplace l'ancien lien simple avec icône générique statique.

**Limitation connue** : pas de miniature pour les fichiers non-PDF (docx, etc.) — comportement identique à avant (icône générique), amélioration possible plus tard si besoin.

## 23. Citation avec fond distinct

La citation dans une bulle qui répond n'avait qu'une barre verticale de 3px sans fond — remplacée par un vrai bloc avec fond distinct (`rgba(255,255,255,0.14)` sur bulle envoyée, `var(--surface-2)` sur bulle reçue), nom de l'expéditeur cité en vert (`var(--green)`) plutôt que la couleur du texte normal, cohérent avec les captures WhatsApp fournies.

## 24. Ce qu'il faut absolument reproduire si migration vers une autre stack

- Système realtime avec un vrai **Presence** (pas juste du pub/sub classique) — sinon il faut réimplémenter le heartbeat + TTL à la main.
- **Scroll de la messagerie en `flex-direction: column-reverse`**, pas en `column` + rustines JS. C'est la leçon la plus chère de cette section : un système `column` classique qui essaie de "recorriger" le scroll après chaque reflow de contenu (polices web, images tardives) est structurellement fragile — un bug de scroll qui saute au premier tap après cold start a résisté à 7 tentatives de fix successives avant que la cause (reflow de police invisible à toute instrumentation `scrollTop`) soit prouvée par une sonde de diagnostic dédiée. `column-reverse` élimine la classe de bug entière par construction (le navigateur ancre nativement en bas), pas par patch — voir §6.
- `useLayoutEffect`-équivalent (ou son analogue dans le framework cible) pour l'atterrissage initial (divider non-lu) — critique pour éviter le flash, même avec `column-reverse` qui gère déjà le cas "pas de non-lu" nativement.
- Bien vérifier que **tout timer/interval posé dans un effect qui se redéclenche souvent** (dépendant d'une liste qui grossit) a un cycle de vie **découplé** de cet effet, sinon risque de blocage de flag et boucle infinie — risque qui n'existe plus dans la version `column-reverse` (plus de boucle de stabilisation à découpler), mais à garder en tête pour tout autre effect du même type ailleurs dans l'app.
- Rate limits du provider realtime choisi — tester avec 2+ clients simultanés avant de considérer la présence "finie".
- RLS croisée entre deux rôles liés (coach/élève) n'est **jamais** automatique — chaque nouvelle table/colonne consultée par l'un sur le profil de l'autre nécessite sa propre policy explicite, à vérifier avant de supposer qu'un SELECT "devrait marcher".
- Pour toute action sensible côté DB (réactions, modifications), préférer une **RPC `SECURITY DEFINER` scoped aux colonnes concernées** plutôt qu'une policy UPDATE générale — RLS Postgres ne restreint pas par colonne, une policy trop permissive peut élargir silencieusement le pouvoir de modification bien au-delà de l'intention initiale.
- Toute génération de fichier côté serveur (miniatures, traitement d'image/PDF) nécessite un vrai aller-retour serveur — vérifier le chemin d'upload réel (`direct client→storage` vs `via une route API`) avant de supposer qu'une fonction existante est réutilisable telle quelle.
