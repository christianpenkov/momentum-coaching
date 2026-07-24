# Heure des calls — toujours Europe/Paris, jamais l'heure locale de l'appareil

Référence pour ne pas se reperdre sur ce sujet — déjà source de plusieurs bugs et
d'une investigation longue (juillet 2026).

## Règle produit

**Toute heure de call est en heure de Paris, pour tout le monde, tout le temps.**
Coach en Bulgarie qui saisit "14h" → c'est 14h à Paris, pas 14h heure locale
bulgare. Élève qui reçoit l'invit voit "14h" aussi — même heure affichée des deux
côtés, peu importe où chacun se trouve physiquement. Décision volontaire (voir
`lib/parisTime.ts`) : expliquer un décalage par-fuseau à chaque déplacement coûte
plus cher que le bénéfice d'un affichage localisé, sur une plateforme où tout le
monde est normalement en France.

**Ne pas essayer de "corriger" ça vers une heure locale par utilisateur** sans en
reparler d'abord — c'est un choix produit assumé, pas un oubli.

## La séquence complète (3 étapes, 3 fichiers différents)

1. **Saisie** — `components/ui/CreateCallModal.tsx` : le formulaire (date + heure +
   minute) est interprété comme une heure murale Paris via
   `parisWallClockToUtc()`, peu importe le fuseau réel de l'appareil du coach.
2. **Invits / réponses** — `lib/googleCalendarService.ts` (création, déplacement de
   call) et `app/api/calls/[id]/respond/route.ts` (accepter/refuser) : le texte de
   la notif push affiche l'heure via `formatParisTime()`/`formatParisDate()`.
3. **Rappels** (24h avant, 15 min avant) — **deux endroits distincts qui font la
   même chose en parallèle**, voir section suivante.

Toutes les fonctions de conversion/formatage viennent de `lib/parisTime.ts`
(calcul manuel d'offset Paris, pas de dépendance à `Intl`/ICU — voir plus bas
pourquoi).

## ⚠️ Piège découvert le 2026-07-24 : DEUX systèmes de rappel distincts

Il existe **deux chemins de code séparés** qui envoient le rappel "call dans
15 min" / "call demain" — same texte de notif, same colonnes `calls.reminder_
15min_sent`/`reminder_24h_sent`, mais DEUX implémentations différentes qui
peuvent diverger silencieusement :

| | Route Next.js | Edge Function Supabase |
|---|---|---|
| Fichier | `app/api/calls/reminders/route.ts` | `supabase/functions/call-reminders/index.ts` |
| Déploiement | `git push` (Vercel) | `supabase functions deploy call-reminders` (séparé !) |
| Déclencheur réel | **Inconnu à ce jour** — aucun des 4 crons connus (cron-job.org : sync-calendly, notify-rapport, instagram/cron-refresh-tokens, poll-leads) ne l'appelle d'après investigation exhaustive (logs Vercel, dashboard Cron Jobs, grep du repo) | Confirmé active en pratique (2026-07-25) — c'est elle qui a réellement envoyé les rappels de tous les tests faits |

**Ce qui s'est passé** : l'Edge Function `call-reminders` a été créée fin
février 2026, jamais retouchée depuis (`updated_at == created_at` avant ce fix),
avec sa propre copie de la logique de formatage — **sans** `timeZone:
'Europe/Paris'` dans son `toLocaleTimeString`/`toLocaleDateString` (contrairement
à la route Next.js, corrigée le 22 juillet). Résultat : elle affichait l'heure UTC
brute dans les notifs, alors qu'on pensait avoir corrigé le bug côté route
Next.js — qui elle-même n'était probablement jamais appelée en pratique.

**Si un futur bug d'heure de call réapparaît : vérifier les DEUX fichiers**, pas
seulement la route Next.js qui semble la plus évidente. Utiliser
`mcp__Supabase__list_edge_functions` / `get_edge_function` pour lister ce qui
tourne réellement côté Supabase, ne pas se fier uniquement à un `grep` du repo
local (une Edge Function peut exister en prod sans être committée — c'était le
cas ici jusqu'à ce fix).

Table `cron_invocation_logs` (créée le 2026-07-24) : les deux chemins y écrivent
une ligne (`route: '/api/calls/reminders'` ou `route: 'edge-function:call-
reminders'`) à chaque invocation — utile pour confirmer lequel tourne réellement
si le doute revient.

## Pourquoi un calcul manuel d'offset au lieu de `Intl`/`timeZone`

`toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' })` peut silencieusement
retomber sur UTC sur certains runtimes serverless/Edge sans base de données de
fuseaux nommés complète (observé concrètement sur l'Edge Function Deno
`call-reminders`). `lib/parisTime.ts` calcule l'offset Paris (+1h hiver / +2h été,
règle UE : dernier dimanche de mars/octobre à 1h UTC) à la main, sans dépendre du
support ICU/Intl de l'environnement d'exécution — robuste sur n'importe quel
runtime Node ou Deno.

`poll-leads/index.ts` et `call-reminders/index.ts` (tous deux Deno, pas de partage
de module possible avec le Next.js `lib/parisTime.ts`) dupliquent une copie locale
du même calcul d'offset — si le calcul doit changer un jour (improbable, la règle
UE ne change pas), il faut le répercuter dans les 3 fichiers.

## Déploiement — ne pas oublier les Edge Functions

Un `git push origin main` déploie automatiquement le code Next.js (Vercel), mais
**PAS** les Edge Functions Supabase (`supabase/functions/*`) — celles-ci
nécessitent un déploiement séparé :

```bash
npx supabase link --project-ref nvjgwtetyuatnkjihmtw   # une fois par poste
npx supabase functions deploy <nom-de-la-fonction> --no-verify-jwt
```

Fonctions actuellement concernées par l'heure Paris : `poll-leads`,
`call-reminders`.
