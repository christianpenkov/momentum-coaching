# Handoff — Audit « Mes Stats » : fin YouTube, puis Instagram

Brief de reprise pour une nouvelle session. État arrêté au **2026-08-21**, dernier commit
`a964646`.

---

## La méthode imposée — à respecter, elle a tout trouvé

> « faut voir chaque donnée, si on l'a en instant donc on maj à chaque passage du cron ou
> si c'est 2-3j d'attente »

**Une métrique à la fois**, en remontant la chaîne complète **API → base → affichage**, et
en **recoupant avec une réponse d'API réelle**. Jamais de conclusion tirée de la lecture du
code ou de la documentation seules.

Ce que cette méthode a produit sur YouTube : **~20 problèmes**, dont un watch time qui
affichait 0 au lieu de ~82 min depuis des mois sur 3 chemins de code, 4 courbes générées par
un sinus, un CTR codé en dur, et 4 colonnes lues par l'UI que rien n'écrivait.

Les fois où j'ai conclu sans vérifier en base, je me suis trompé — deux fois sur le CTR
seul (détaillé plus bas). **La vérification en base n'est pas une formalité.**

### Contraintes permanentes

- **Zéro maintenance** après livraison à Quennel ; robuste à 30 élèves. Solide > rapide.
- **Aucune donnée inventée, simulée ou codée en dur.** Un `0` affirme quelque chose, un
  trou dit « on ne sait pas ». Ne jamais confondre les deux.
- Réponses en **français**, explications non techniques, noms de tables conservés.
- Déploiement : **`git push origin main` uniquement**. Jamais `vercel deploy --prod`.
- Edge Functions : déploiement séparé,
  `npx supabase functions deploy poll-leads --project-ref nvjgwtetyuatnkjihmtw --no-verify-jwt`.
- **Interdiction de pousser quoi que ce soit touchant la page « Gérer mes liens »** tant que
  la review Meta n'est pas terminée.
- Vérifier la branche avant chaque commit — une session parallèle peut la faire basculer.

---

## Où en est YouTube

**L'onglet est audité de bout en bout.** Deux documents portent le détail :

- `docs/audit-metriques-youtube.md` — l'audit complet, dont la session du 21 août en fin de
  fichier. **Contient une section « Trois fausses pistes — ne pas corriger »** : la lire
  avant de « réparer » quoi que ce soit.
- `docs/youtube-api-limitations.md` — ce que l'API refuse de donner et pourquoi.

### Ce qui reste ouvert sur YouTube

1. **Vérification visuelle après déploiement de `a964646`** (fait mais non constaté) :
   - graphique « Abonnés nets / jour » : `−1 / 0 / +1` centré, **sans barre blanche** ;
   - modale « Abonnés nets YT » : même rendu que la section (grille ajoutée) ;
   - fiche vidéo : case CTR présente dès l'ouverture avec points de chargement, puis
     **`N/D`** grisé avec explication au survol.

2. **Le commit `c3b2eec` a un `@` parasite en première ligne** de son message (heredoc
   PowerShell mal interprété). Purement cosmétique, corriger demanderait un force-push sur
   `main` — décision de Chris, non prise.

3. **Rien d'autre n'est connu comme cassé sur YouTube.** Si une anomalie apparaît, appliquer
   la méthode plutôt que de supposer.

---

## Les trois pièges qui ont coûté le plus de temps

À connaître avant de toucher Instagram — ce sont des **motifs**, pas des incidents isolés.

### 1. La règle écrite à plusieurs endroits qui diverge

Rencontré **une dizaine de fois** : `utm_content` dans 3 chemins Calendly, `buildDestUrl`
en double dont une copie sans `utm_term`, la vue SQL `utm_anomalies` contre
`isValidContentId`, le watch time formaté par 3 fonctions différentes, et le CTR testé sur
un écran mais pas sur l'autre.

**Corollaire pour Instagram** : `docs/cron-poll-leads-dates.md` documente que
`lib/ig-metrics-core.ts` (Node) est recopié à la main dans
`supabase/functions/poll-leads/index.ts` (Deno, qui ne peut pas importer hors de son
dossier).

⚠️ **Vérifié le 2026-08-21, la description du doc ne colle plus** : `lib/ig-metrics-core.ts`
fait 131 lignes mais n'exporte plus qu'une seule fonction (`isoDateCore`), et l'Edge
Function ne la référence nulle part. Soit la logique a migré ailleurs, soit le fichier est
devenu largement mort. **À trancher avant d'en faire une piste d'audit** — et corriger le
doc dans les deux cas.

**Réflexe** : quand une règle doit valoir partout, la poser une seule fois — au niveau le
plus bas possible. Le CTR a été corrigé dans la RPC `get_yt_videos_history`, pas dans les
composants, précisément pour ça.

### 2. Une donnée présente n'est pas une donnée fiable

Le cas CTR, où je me suis trompé **deux fois** :

- J'ai affirmé que les vidéos anciennes n'avaient aucune donnée CTR. **Faux** : 29 sur 30
  en avaient une. C'est pire qu'une absence — un chiffre faux s'affiche sans prévenir.
- J'ai affirmé qu'une vidéo devait être publiée après l'« integration ready » pour avoir un
  CTR. **Faux aussi** : le job récupère de l'historique, mais seulement une fraction
  résiduelle (0,1 % des vues réelles sur une vidéo à 2 012 vues).

**Réflexe** : croiser le volume de la métrique avec un volume de référence connu
(impressions contre vues, ici). Un ratio absurde révèle un échantillon non représentatif.

### 3. Recharts ignore `domain` sans `ticks`

Trois corrections successives ont échoué sur l'axe des abonnés nets avant d'identifier que
Recharts recalcule ses propres bornes par-dessus le `domain` fourni. **Il faut passer
`ticks` explicitement.**

Autre piège du même écran : la carte affichait un message vide **à la place du graphique**
quand toutes les valeurs étaient à zéro — c'est-à-dire dans le cas normal.

---

## L'audit Instagram — point de départ

### Périmètre

`TabInstagram` occupe les lignes **1009 à 1690** de
`components/analytics/PageClientStats.tsx`. Ce composant est rendu par **3 routes**
(`/mes-stats`, `/client/stats`, `/clients/[id]/analytics`) : une correction vaut donc
automatiquement côté coach et côté élève.

### Ce qui est déjà vérifié (ne pas refaire)

- Aucune donnée simulée (`Math.sin`, `mockFrom*`) ne subsiste dans le fichier.
- Aucun pourcentage codé en dur dans la plage Instagram.

### Documents à lire d'abord

- `docs/instagram-api-limitations.md`
- `docs/cron-poll-leads-dates.md` — dont la duplication `ig-metrics-core.ts` ↔ Edge Function
- `docs/perimetre-stats-referentiel.md` — les 5 règles de périmètre
- `docs/pipeline-leads-ig-sources.md`

### Pistes à instruire, par ordre de rendement attendu

1. **Fraîcheur de chaque métrique** — c'est la question d'origine de Chris. YouTube expose
   trois APIs à délais différents (temps réel / J-3 / ~J-2), et l'audit a dû poser des
   badges « J-3 » ciblés. **Faire le même inventaire pour Instagram** : quelle métrique est
   instantanée, laquelle accuse un retard, et l'UI le dit-elle ?
   Chris a tranché : **pas de badge** sur Appareils, Sources de trafic, Mots-clés,
   Démographie.

2. **Statut réel de `lib/ig-metrics-core.ts`** — code mort ou logique déplacée ? (voir
   piège 1 : la description du doc ne correspond plus au fichier).

3. **Colonnes lues par l'UI que rien n'écrit** — 4 cas trouvés côté YouTube. Vérifier
   colonne par colonne côté Instagram.

4. **Métriques dépréciées en 2025** — documentées dans la mémoire projet
   (`api_instagram_reference.md`). Vérifier qu'aucune n'est encore lue.

5. **Divergence période courante / période passée** — côté Stripe, `/api/stripe/client-data`
   appelle l'API en direct alors que le mode historique lit `stripe_payments`. Vérifier
   qu'Instagram n'a pas la même dualité entre chemin live et chemin snapshot.

---

## Repères techniques

| Élément | Valeur |
|---|---|
| Projet Supabase | `nvjgwtetyuatnkjihmtw` |
| Projet Vercel | `momentum-plateforme` (`prj_bJsNTFxTelIqO7DWcgd6E8J5rDTx`) |
| Profil de test (Chris) | `a02e5927-7b39-4b7d-b112-0a43b30e9f09` |
| Composant central | `components/analytics/PageClientStats.tsx` (~6900 lignes) |
| Formatage des durées | `lib/duree.ts` + `lib/duree.test.ts` |
| Tests | `npm test` (node --test, aucune dépendance) |

**Toute requête SQL sur `calls`** doit filtrer `ignored is not true` et préciser
`call_type` (`'calendly'` = vente, `'google'` = coaching) — sinon les chiffres sont faux.

**`deals` est la source du cash** depuis le 2026-08-20 ; `calls.revenue` n'est plus qu'une
trace du rapport.

---

## Derniers commits

| Commit | Objet |
|---|---|
| `a964646` | Barre blanche abonnés nets, carte CTR qui surgissait |
| `d0eba5b` | CTR masqué avant démarrage du suivi (+ migration `20260821180000`) |
| `b73f87b` | `lib/duree.ts` — un seul composant pour toutes les durées |
| `d23d47c` | Abonnés nets : ligne plate plutôt qu'un message vide |
| `c3b2eec` | Graphique à 0, KPI qui exclut ces jours *(message avec `@` parasite)* |
