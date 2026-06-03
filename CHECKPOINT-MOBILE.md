# CHECKPOINT v2 — Messagerie mobile iOS PWA (2026-06-04)

> Reprise dans un nouveau chat. Lis ce bloc EN PREMIER, puis le reste du fichier pour le contexte historique.

## ⚠️ ÉTAT EN COURS — à terminer

On corrige les bugs messagerie mobile iOS PWA. **Une modif est à moitié faite** (voir ci-dessous), à finir + tsc + commit + push.

### Ce qui vient d'être fixé (commits poussés sur `main`)
1. **Messages vides = root cause trouvée** : la table `messages` (Supabase projet `nvjgwtetyuatnkjihmtw`) n'avait PAS les colonnes `type`, `audio_url`, `duration_s`. La query `.select(...)` les demandait → erreur silencieuse → `data=null` → "Aucun message". **FIX DB appliqué** via MCP : `ALTER TABLE messages ADD COLUMN type text DEFAULT 'text', audio_url text, duration_s integer`. Les 11 messages existants sont intacts. Commit `8588041`.
2. **Layout remount** : `isMobile` initialisé `false` (SSR) causait un remount → messages perdus + nav fixed. Fixé : layout unique `.app-shell-pwa`, manipulation DOM directe via `useRef`/`querySelector` dans `app/(client)/layout.tsx`. Commit `0a56774`.
3. **Realtime dédup** : évite doublon optimistic/realtime dans `PageClientMessages.tsx`. Commit `6566180`.
4. **UX iOS** : `touch-action:manipulation`, `:active scale(0.96)`, scroll lock pendant vocal, fix `URL.revokeObjectURL` (était appelé avant setMessages → vocal disparaissait). Commit `19071c3`.

### 🔧 MODIF EN COURS (NON commitée) — à finir
Dans `app/globals.css` je viens d'isoler `.app-shell-pwa` :
- Desktop : `position: static` height 100vh (comportement normal)
- Mobile (`@media max-width:767px`) : `position: absolute` + hauteur gérée par JS
**FAIT.** Reste à : `npx tsc --noEmit` depuis `orbit/`, puis commit + push (PowerShell, path avec parens → `git add "app/(client)/layout.tsx"`).

### Bugs RESTANTS à vérifier après ce déploiement
- **Nav qui remonte avec clavier iOS** : le layout `app/(client)/layout.tsx` cache `.bottom-nav` via `querySelector('.bottom-nav').style.display='none'` quand `kbH>60`. À tester sur iPhone réel.
- **Vocal qui disparaît sur mobile** (pas sur PC) : à re-vérifier maintenant que les colonnes DB existent — c'était probablement le même root cause (colonnes manquantes). Tester l'envoi d'un vocal sur iPhone.
- **PC** : vérifier que le design desktop est intact après le fix `.app-shell-pwa`.

## Architecture messagerie actuelle (pour comprendre vite)
- `app/(client)/layout.tsx` : shell unique `.app-shell-pwa`. `useEffect` mobile écoute `window.visualViewport` (resize+scroll), set `shellRef.style.height = vvh`, cache `.bottom-nav` si clavier ouvert, `window.scrollTo(0,0)` au focus (hack WebKit anti-décalage).
- `components/pages/client/PageClientMessages.tsx` : `createClient()` dans `useRef`, load au mount + Realtime `supabase.channel` filtré `client_id`, optimistic UI texte+audio, `AudioBubble` + `RecordingOverlay` (bouton Envoyer rond + Annuler). Vocal → upload bucket `voice-messages` → getPublicUrl → insert.
- `app/globals.css` : `html/body position:fixed overflow:hidden` SEULEMENT en `@media max-width:767px`. `.chat-shell` flex-column height 100%. `.chat-messages-zone` flex:1 overflow-y:auto. `.chat-input-bar` flex-shrink:0. `.bottom-nav` mobile `position:relative` dans le flux flex.

## Infos clés projet
- Supabase projet : **momentum-coaching** = `nvjgwtetyuatnkjihmtw` (eu-west-3). Client test : `349de377-4bdb-4b74-97f1-c2d7590541f1` (Christian Penkov, profile_id `a02e5927-7b39-4b7d-b112-0a43b30e9f09`).
- RLS actif. Policy messages : `EXISTS (clients WHERE c.id=messages.client_id AND (coach_id=auth.uid() OR profile_id=auth.uid()))`. OK.
- Git : repo dans `orbit/`, remote `github.com/christianpenkov/momentum-coaching`, branche `main`. Commit/push via **PowerShell** (bash casse sur path `(client)`).
- Vercel auto-deploy sur push. Tester iPhone après ~2min + kill PWA + relance.
- TopBar mobile 52px, BottomNav 64px+safe-area.

## Higgsfield (annexe, ads)
- CLI `higgsfield` installé, authentifié, plan Plus ~635 crédits. `--model` veo3_1 max 8s. Mode `hyper_motion` PAS dispo via CLI (UI web seulement). Prompt complet ads déjà fourni à l'utilisateur.

## Commande de reprise nouveau chat
> Reprends le fix messagerie mobile iOS Momentum. Lis `orbit/CHECKPOINT-MOBILE.md` (bloc v2 en haut). Termine la modif en cours dans globals.css (tsc + commit + push PowerShell), puis vérifie les bugs restants : nav qui remonte avec clavier, vocal sur mobile, design PC intact.

---

# CHECKPOINT v1 — Polish mobile PWA Momentum (élève) [HISTORIQUE]

> Reprise dans un nouveau chat. Lis ce fichier en entier, puis exécute les fixes ci-dessous **dans l'ordre**. Ne reviens pas tant que tout est clean sur mobile.

## Contexte projet
- App : **Momentum Coaching** — Next.js 14 app router + Supabase + TypeScript strict
- Racine du code : `c:\Users\chris\Projet Quennel Momentum\orbit\`
- **Pas de Tailwind** : inline styles + CSS variables. Tout le CSS mobile est dans `app/globals.css` sous `@media (max-width: 767px)`.
- ⚠️ `orbit/AGENTS.md` dit que Next.js a des breaking changes → lire `node_modules/next/dist/docs/` AVANT de toucher une API Next. Les fixes ci-dessous sont CSS/composant pur, pas d'API Next.
- Tokens : `--bg:#fbfbf7 --surface:#fff --surface-2:#f7f4ec --ink:#1a1815 --muted:#797569 --border:#eeeae0 --accent:#1a1815`, font Inter.
- Vercel : projet `momentum-plateforme` (prj_bJsNTFxTelIqO7DWcgd6E8J5rDTx). URL : https://momentum-plateforme.vercel.app
- Mobile = SEULEMENT 4 pages élève : `/client` (Accueil), `/client/messages`, `/client/liens`, `/client/calendar`. Coach pas touché.

## Objectif global
Version mobile premium type app iOS/Android native. Messagerie clean façon WhatsApp. Pas de zoom. PWA installable, logo bleu sur fond blanc. Transitions fluides légères partout.

## État déjà fait (NE PAS refaire)
- PWA : viewport no-zoom + JS anti-pinch/double-tap dans `app/layout.tsx`. SW v5 `public/sw.js` purge tout + reload. No-cache headers dans `next.config.ts`. → confirmé fonctionnel (updates apparaissent sur iPhone).
- `apple-touch-icon` → `/logo-momentum-apple.png` (180x180 logo sur fond blanc, généré via sharp).
- `components/layout/BottomNav.tsx` : nav 4 items, SVG inline, actif via `usePathname`.
- `components/layout/TopBar.tsx` : logo `/logo-momentum.png` width/height 44.
- `.bottom-nav` z-index déjà passé de 100 → **300** (au-dessus du drawer liens zIndex 200). Fix "nav disparait quand on clique sur un contenu". `transform: translateZ(0)` ajouté.
- Stats IG/YT, revenue (mocks retirés), pipeline, attribution source : terminés. PAS le focus.

## ⚠️ Règle déploiement StatV3 (mémoire)
`PageStatsV3` est un fichier dev local, jamais importé en prod → toujours faire une copie. (non pertinent ici mais à savoir)

## Demandes utilisateur EXACTES à traiter (les 6 + 1)
1. **Logo bleu trop petit** → augmenter légèrement la taille. `TopBar.tsx` ligne 18 : `width={44} height={44}` → ~`52`. Vérifier que `.topbar` height 52px mobile suffit (ligne ~1381 globals.css), sinon passer à 56px.
2. **Messagerie : la nav barre NE doit PAS monter avec le clavier** — "je veux que ça soit normal". Fichier `components/pages/client/PageClientMessages.tsx` : il a un state `keyboardHeight` (visualViewport API) et l'input est `position: fixed` à `bottom: 56 + keyboardHeight`. → Repenser : la nav reste en place (déjà z-index 300 + translateZ). Le plus simple = **retirer le décalage keyboardHeight de la nav** et laisser iOS gérer. Tester que l'input reste visible au-dessus du clavier sans pousser la nav. Garder l'input fixé au-dessus de la bottom-nav (bottom: calc(56px + safe-area)).
3. **Animations d'envoi de message propres** — bulle qui apparaît avec un slide/fade léger (transform translateY + opacity, 150-250ms ease-out). Pas de bounce.
4. **Barre noire iPhone (home indicator) trop proche de la nav** → plus d'espace au-dessus. `.bottom-nav` ligne ~1440 : height `calc(56px + env(safe-area-inset-bottom))` + `padding-bottom: env(safe-area-inset-bottom)`. Augmenter : ajouter ~8-10px de marge → `padding-bottom: calc(env(safe-area-inset-bottom) + 6px)` et height en conséquence. Vérifier que `.main-content` padding-bottom suit (ligne ~1386).
5. **Lead Magnet mobile : clic = rien n'apparait.** `components/liens/PageLiens.tsx` : le bouton header Lead Magnets fait `onClick={() => setRightView({ type: 'lm-library' })}` (~ligne 2127) au lieu de `openMobileDetail({ type: 'lm-library' })`. Sur mobile il faut ouvrir le drawer via `openMobileDetail`. Idem bouton Paramètres. Chercher TOUS les `setRightView(` dans les boutons header et, sur mobile, router vers `openMobileDetail`. Le drawer mobile est `position: fixed, inset: 0, zIndex: 200`.
6. **Transitions fluides partout, légères** (page→page, clic bouton, retour). `components/layout/PageTransition.tsx` : ATTENTION le wrapper a `display: contents` ce qui ANNULE l'opacity (un élément display:contents ne peut pas être animé). → soit retirer `display:contents` et mettre un vrai wrapper `<div style={{opacity, transition}}>`, soit revoir. Garder léger : fade 150-200ms ease-out, pas de gros mouvement. Ajouter aussi `:active { transform: scale(.98) }` léger sur boutons mobile.
7. **Nav bar disparait quand on clique sur un contenu** → déjà partiellement réglé (nav z-index 300 > drawer 200). VÉRIFIER que ça suffit ; si le drawer couvre encore, soit baisser drawer en dessous de 300 (déjà le cas), soit s'assurer que le drawer ne met pas `inset:0` par-dessus la nav. Idéalement le drawer s'arrête à `bottom: calc(56px + safe-area)` pour laisser la nav visible.

## Fichiers clés
- `components/layout/TopBar.tsx` — logo (fix #1)
- `components/layout/BottomNav.tsx` — nav (OK)
- `components/layout/PageTransition.tsx` — transitions, bug display:contents (fix #6)
- `components/pages/client/PageClientMessages.tsx` — clavier + anim envoi (fix #2, #3)
- `components/liens/PageLiens.tsx` — Lead Magnet drawer mobile (fix #5, #7) — gros fichier, grep `setRightView`, `openMobileDetail`, `mobileDetailOpen`, `mobileTab`
- `app/globals.css` — tout le CSS mobile : `.topbar` ~1381, `.main-content` ~1385, `.chat-shell` ~1414, `.bottom-nav` ~1428-1493 (fix #1, #4, #6)

## Procédure
1. Faire les fixes 1→7 dans l'ordre.
2. `npx tsc --noEmit` (depuis `orbit/`) — zéro erreur.
3. Build mental / vérifier visuellement les media queries.
4. Commit atomique. ⚠️ Path avec parens `(client)` casse bash heredoc → utiliser le tool **PowerShell** pour git, pas Bash. Git n'est pas un repo à la racine `Projet Quennel Momentum` — vérifier où est le `.git` (probablement dans `orbit/` ou parent). Message FR.
5. Push → Vercel déploie. Tester sur iPhone (refresh, le SW v5 force reload).

## Style / craft (skills actifs)
- impeccable + design-taste-frontend + ui-ux-pro-max chargés. Touch targets ≥44px, transitions 150-300ms ease-out (pas de bounce), contraste ≥4.5:1, pas d'emoji (SVG only), safe-areas respectées.
- Garder le design existant (warm neutral #fbfbf7 + ink #1a1815). Ne pas réinventer.

## Reprise
Commande pour le nouveau chat :
> Reprends le polish mobile Momentum. Lis `orbit/CHECKPOINT-MOBILE.md` en entier puis exécute les fixes 1→7 dans l'ordre, tsc, commit (PowerShell), push. Ne reviens pas tant que tout est clean.
