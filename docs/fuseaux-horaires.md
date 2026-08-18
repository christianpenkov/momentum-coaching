# Fuseaux horaires — chacun voit les heures de call dans le sien

Référence pour ne pas se reperdre sur ce sujet — déjà source de plusieurs bugs et
de deux investigations longues (juillet et août 2026).

## Règle produit (depuis le 2026-08-19)

**Chaque personne voit les heures de call dans SON fuseau, passé compris.**

Un coach à Paris voit « 14:30 », son élève à Dubaï voit « 16:30 Dubaï » — les deux
ont raison, le badge de ville lève l'ambiguïté. Le fuseau n'est affiché que
lorsqu'il produit une heure différente de celle du lecteur : en France, l'écran est
strictement identique à ce qu'il était avant.

Trois conséquences à connaître :

1. **La saisie suit le fuseau de qui saisit.** « 14:00 » tapé à Dubaï vaut 14h à
   Dubaï. Les formulaires affichent toujours le fuseau utilisé, même en France —
   dans un formulaire, l'ambiguïté coûte plus cher qu'un libellé.
2. **Le passé est converti comme le futur.** Pas de règle spéciale pour
   l'historique. C'est le comportement de Google Calendar : deux règles selon le
   côté de « maintenant » produiraient un saut d'heure incompréhensible au moment
   où un call bascule dans le passé.
3. **Les statistiques ne suivent pas.** Elles restent calées sur les journées
   Paris, sinon un « lundi » vu de Dubaï ne couvrirait pas les mêmes heures qu'un
   « lundi » vu de Paris, et l'historique deviendrait incomparable.

### Ancienne règle (2026-07-25 → 2026-08-19)

Toute heure s'affichait en heure de Paris pour tout le monde, quel que soit
l'endroit où se trouvaient coach et élève. L'argument était d'éviter tout
quiproquo sur « quelle heure ça veut dire ».

Abandonnée parce que le coût pour un utilisateur expatrié (convertir mentalement à
chaque call) dépasse le bénéfice, et parce que le badge de ville lève l'ambiguïté
que la règle voulait éviter. Si le code d'un vieux commit raconte l'autre
histoire, c'est pour cette raison.

## Où vit la logique

| Runtime | Fichier | Note |
|---|---|---|
| Next.js | `lib/timezone.ts` | Source de vérité : formatage, saisie, badge de ville |
| Deno | `supabase/functions/_shared/timezone.ts` | Port du formatage, partagé par les 2 Edge Functions |

Pas de partage possible entre les deux (aucune résolution de `@/lib/*` depuis
Deno). **Toute modification dans l'un doit être répercutée dans l'autre.** On est
passé de 3 copies à 2 : `call-reminders` et `poll-leads` avaient chacune la sienne.

`lib/parisTime.ts` n'existe plus. Il portait un calcul manuel d'offset Paris,
inutilisable pour un fuseau arbitraire.

### Qui décide du fuseau

- **À l'écran** : le navigateur, via `useViewerTimeZone()` (exposé par
  `UserContext`). Toujours la valeur la plus fraîche.
- **Côté serveur** : la colonne `profiles.timezone`, seule information dont
  dispose le serveur. Écrite par `lib/UserContext.tsx` au montage et à chaque
  retour au premier plan, **uniquement si elle a changé** — sans ce garde, chaque
  bascule d'onglet sur mobile déclencherait un UPDATE.

**Limite connue** : un élève qui atterrit dans un autre pays et ne rouvre pas
l'app avant son call recevra son rappel dans l'ancien fuseau. Il n'existe pas
d'autre source d'information côté serveur. Ce n'est pas un bug.

## Notifications — toujours le fuseau du DESTINATAIRE

L'erreur naturelle est d'utiliser le fuseau de celui qui déclenche l'action. Le
code tourne dans la requête de l'un, mais la notification s'affiche chez l'autre.

| Site | Destinataire |
|---|---|
| `lib/googleCalendarService.ts` (création, déplacement) | l'élève |
| `app/api/calls/[id]/respond/route.ts` | **le coach** |
| `app/api/calls/reminders/route.ts` | l'élève |
| `supabase/functions/call-reminders/index.ts` | l'élève |
| `supabase/functions/poll-leads/index.ts` | l'élève |

Le cas `respond` est le plus piégeux : le code s'exécute dans la requête de
l'élève qui répond, mais la notification part chez le coach. Il faut donc lire le
profil du coach, **avec le client service-role** — la RLS empêche un élève de lire
le profil de son coach.

Les insertions dans `client_notifications` ne formatent rien : elles stockent
`scheduled_at` brut, rendu plus tard par `useNotifications` dans le fuseau du
lecteur. Ne jamais y stocker une heure pré-formatée.

## `Intl` et le runtime Deno — résultat de sonde du 2026-08-19

Le 2026-07-24, `toLocaleTimeString({timeZone:'Europe/Paris'})` retombait
silencieusement sur UTC dans l'Edge Function `call-reminders`, ce qui avait imposé
un calcul manuel d'offset.

Ce calcul ne pouvant couvrir qu'un seul fuseau, une sonde jetable a été déployée
sur le runtime réel avant d'écrire ce chantier :

```
runtime  : supabase-edge-runtime-1.74.3 (Deno v2.1.4)
fuseaux  : 418 supportés
été      : Paris 14:00 · Dubaï 16:00 · New York 08:00 · Tokyo 21:00 · Kolkata 17:30
hiver    : Paris 13:00 · Dubaï 16:00 · New York 07:00 · Tokyo 21:00 · Kolkata 17:30
verdict  : OK — heure d'été correctement gérée, demi-fuseaux corrects
```

**`Intl` est donc utilisable côté Deno depuis cette version.** Si un doute revient,
redéployer une sonde équivalente plutôt que de supposer — c'est cette trace qui
évite de refaire l'investigation.

Deux précautions conservées dans le code :

- **Locale `en-CA`, jamais `fr-FR`**, avec `formatToParts` : on n'extrait que des
  chiffres. Les noms de jours et de mois viennent de tables FR en dur. Le fuseau et
  la locale sont deux dépendances ICU **distinctes** — un runtime peut avoir l'un
  sans l'autre et renvoyer « Monday ».
- **`hour === 24` normalisé à 0** : certaines versions d'ICU rendent minuit comme
  « 24:00 ».

## ⚠️ Piège toujours valable : DEUX systèmes de rappel distincts

Il existe **deux chemins de code séparés** qui envoient le rappel « call dans
15 min » / « call demain » — même texte, mêmes colonnes
`calls.reminder_15min_sent`/`reminder_24h_sent`, mais deux implémentations qui
peuvent diverger silencieusement :

| | Route Next.js | Edge Function Supabase |
|---|---|---|
| Fichier | `app/api/calls/reminders/route.ts` | `supabase/functions/call-reminders/index.ts` |
| Déploiement | `git push` (Vercel) | `supabase functions deploy call-reminders --no-verify-jwt` (séparé !) |
| Déclencheur réel | **Inconnu** — aucun des crons connus ne l'appelle d'après investigation exhaustive | Confirmé active en pratique (2026-07-25) |

**Ce qui s'était passé en juillet** : l'Edge Function avait sa propre copie du
formatage, sans `timeZone`, jamais mise à jour lors des correctifs précédents. On
croyait avoir corrigé le bug côté route Next.js — qui n'est probablement jamais
appelée.

**Les deux sont maintenues à l'identique**, y compris dans ce chantier. Si un bug
d'heure réapparaît, vérifier **les deux fichiers**. Utiliser
`mcp__Supabase__list_edge_functions` pour voir ce qui tourne réellement : une Edge
Function peut exister en prod sans être committée.

Table `cron_invocation_logs` : les deux chemins y écrivent une ligne à chaque
invocation (`route: '/api/calls/reminders'` ou `'edge-function:call-reminders'`).

## Déploiement — ne pas oublier les Edge Functions

`git push` ne déploie **pas** `supabase/functions/*`. Après toute modification :

```
npx supabase functions deploy call-reminders --no-verify-jwt
npx supabase functions deploy poll-leads --no-verify-jwt
```

Le `--no-verify-jwt` est obligatoire : ces fonctions sont appelées par
cron-job.org avec un `CRON_SECRET`, pas un JWT. Sans le flag, les crons cassent.

Oublier ce déploiement reproduit exactement le bug de juillet : l'app affiche la
bonne heure, les notifications non, et l'écart est silencieux.

## Dette connue

Les calls créés depuis `PagePipeline` **avant le 2026-08-19** ont un
`scheduled_at` décalé : la chaîne partait sans offset, Postgres l'interprétait
dans le fuseau de sa session (UTC), donc « 14:00 » était stocké comme 14:00 UTC =
16:00 Paris. Non corrigé : il faudrait deviner la saison de saisie ligne par ligne
et distinguer l'origine de chaque enregistrement. Peu de lignes concernées, peu de
valeur de lecture.
