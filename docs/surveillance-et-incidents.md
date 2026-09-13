# Surveillance et incidents

Mis en place le 2026-09-13. **Objectif : la plateforme tourne sans que personne ne la
regarde, et le jour où quelque chose casse vraiment, un e-mail arrive avec tout ce qu'il
faut pour corriger** — ce qui s'est passé, où, avec quel code déployé, les dernières
occurrences complètes, la requête SQL et un prompt prêt à coller dans Claude Code.

Ce document décrit le **système**. Les vues de santé une par une sont dans
`docs/sante-plateforme.md` ; les crons dans `docs/crons.md`.

---

## 1. Les trois couches, et le trou que chacune ferme

```
  ┌─ Couche 1 : CAPTER ─────────────────────────────────────────────────────────┐
  │  Vercel (serveur)   instrumentation.ts → onRequestError + filet fetch       │
  │  Navigateur         instrumentation-client.ts, app/error.tsx, global-error  │
  │  Edge Functions     _shared/incidents.ts → servirAvecFilet + filet fetch    │
  │  Données            ~25 vues de santé (conséquences dans la base)           │
  └──────────────────────────────┬──────────────────────────────────────────────┘
                                 ▼  table `incidents` (une ligne par panne distincte)
  ┌─ Couche 2 : PRÉVENIR ───────────────────────────────────────────────────────┐
  │  /api/sante/dispatch   (pg_cron, toutes les 5 min)                          │
  │    · incident critique nouveau      → e-mail immédiat                       │
  │    · toutes les heures              → vues critiques                        │
  │    · chaque jour dès 8 h Paris      → toutes les vues, stockage, domaines,  │
  │                                       sonde Resend, récapitulatif non urgent│
  └──────────────────────────────┬──────────────────────────────────────────────┘
                                 ▼  battement (seulement si tout a fonctionné)
  ┌─ Couche 3 : SURVEILLER LE SURVEILLANT ──────────────────────────────────────┐
  │  healthchecks.io  — prévient par SA messagerie si le battement cesse        │
  └─────────────────────────────────────────────────────────────────────────────┘
```

| Couche | Ce qu'elle ferme | Mesuré le 2026-09-13 |
|---|---|---|
| Filet `fetch` (Vercel + Edge + navigateur) | Les écritures Supabase dont l'erreur n'est jamais lue : la route répond 200, rien n'est écrit | ~150 sites dans le code |
| `onRequestError`, `error.tsx`, `servirAvecFilet` | Les exceptions non attrapées, invisibles au bout d'1 h (logs Vercel Hobby) ou d'1 jour (Supabase) | aucune capture n'existait |
| Vues ajoutées | pg_cron, pg_net, file des webhooks, versions d'API qui expirent | aucune n'était lue |
| Répartiteur sur pg_cron | Toutes les alertes dépendaient de `poll-leads` : sa mort n'était signalée par personne | — |
| Battement externe | Vercel, la base, pg_cron ou Resend en panne : plus aucune alerte ne peut partir | — |

---

## 2. La table `incidents`

Une ligne par **empreinte** — la même panne, regroupée. Elle ne grossit qu'avec le nombre
de pannes distinctes, jamais avec le trafic (garde de débordement à 200 nouvelles par
heure ; purge à 90 jours sans occurrence).

```sql
-- Ce qui se passe en ce moment
select gravite, titre, occurrences, derniere_le, notifie_le
from incidents where resolu_le is null order by derniere_le desc;

-- Tout le contexte d'un incident (les 5 dernières occurrences complètes)
select * from incidents where empreinte = '<empreinte>';
```

### Réarmement automatique — aucune action humaine requise

Un incident notifié se tait. Il **renvoie un e-mail tout seul** si :

1. il revient après **7 jours** sans occurrence ;
2. il survit à un **déploiement** (incident critique seulement) — « ton correctif n'a pas
   marché » ;
3. il revient après avoir été **marqué résolu**.

C'est la leçon de `cron_runs` appliquée d'emblée (AGENTS.md) : aucune ligne ne peut
condamner une alerte au silence.

Marquer résolu est **facultatif** — ça sert à dire « c'est corrigé » et à être prévenu
immédiatement si ça revient :

```sql
update incidents set resolu_le = now(), resolu_note = '<commit>' where empreinte = '<empreinte>';
```

⚠️ **Ne jamais supprimer une ligne pour faire taire un e-mail.** Elle se rouvrirait à la
prochaine occurrence, et on aurait perdu l'historique.

### Gravité

| | Critique → e-mail en ≤ 5 min | Normale → récapitulatif du matin |
|---|---|---|
| Base | écriture ou RPC refusée ; toute requête refusée depuis une Edge Function ou une route critique | lecture refusée depuis un écran |
| Exceptions | toute exception serveur non attrapée ; écran en erreur pour un utilisateur connecté | erreur JavaScript isolée, promesse rejetée |
| Métier | webhook Stripe en échec, paiement en N fois non borné, événement Instagram perdu, signature Meta refusée, notifications push coupées, domaine qui expire | Graph API servie dans une autre version, battement non configuré |

La règle vit dans **un seul fichier**, `lib/incidentsClassement.ts`, importé tel quel par
Vercel, les Edge Functions et le navigateur. **Ne pas en faire de copie.**

Ce qui n'est **jamais** un incident (`CODES_BENINS`, chaque entrée justifiée) : `.single()`
sans ligne, violation d'unicité (garde d'idempotence volontaire), session utilisateur
expirée, erreurs d'authentification, fichier absent à la lecture.

⚠️ **N'ajouter un code à `CODES_BENINS` qu'avec sa raison écrite.** Un code ajouté « parce
qu'il fait du bruit » transforme un défaut réel en silence.

### Aucun secret ne sort

Les jetons d'URL (`access_token=`), les en-têtes (`authorization`, `cookie`, signatures),
les clés JSON sensibles (`*token*`, `*secret*`, `api_key`…) et les lignes que Postgres
recopie dans ses erreurs (« Failing row contains (…) ») sont retirés avant d'écrire. Tout
est testé dans `lib/incidents.test.ts`.

---

## 3. Le répartiteur — `/api/sante/dispatch`

Déclenché par pg_cron (`sante-dispatch-5min` → `declencher_cron('sante-dispatch')`).

| Cadence | Ce qu'il fait | Ligne de passage |
|---|---|---|
| chaque passage | e-mail pour chaque incident critique nouveau (6 max, puis un e-mail groupé) | `sante-dispatch` |
| toutes les heures | `alerte-vues?critiques=1` (crons, cron_runs, accès sans RLS, file webhooks, pg_cron, pg_net) + pont dépôt → base (empreintes, migrations, versions d'API) | `sante-horaire` |
| chaque jour dès 8 h Paris | `alerte-vues` complète, `alerte-stockage`, sonde du canal Resend, expiration des domaines (RDAP), récapitulatif des incidents non urgents | `sante-quotidien` |

⚠️ Les cadences horaire et quotidienne se marquent **au début** de leur passage : un
passage qui échoue au milieu n'est pas rejoué toutes les 5 minutes (la sonde Resend
enverrait sinon douze e-mails de test par heure). L'échec retient le battement.

⚠️ **Un seul déclencheur.** `poll-leads` appelait `alerte-vues` et `alerte-stockage`
jusqu'au 2026-09-13 ; ces appels ont été retirés. Les remettre ferait partir la même
alerte deux fois.

### Réponse et diagnostic

```bash
curl -s -H "authorization: Bearer $CRON_SECRET" https://momentum-plateforme.vercel.app/api/sante/dispatch
# { ok, resultats: { horaire, quotidien, critiques, battement }, problemes: [...] }
```

`problemes` non vide = la chaîne d'alerte ne fonctionne pas entièrement. C'est ce qui
retient le battement.

---

## 4. Le battement externe — healthchecks.io

**La seule protection contre la mort de la chaîne entière** (Vercel, base, pg_cron,
secret désaccordé, Resend refusé). Rien à l'intérieur de la plateforme ne peut signaler sa
propre mort.

- Le répartiteur envoie `POST <HEALTHCHECK_PING_URL>` à la fin d'un passage **sans
  problème**.
- En cas de problème, il **n'envoie pas `/fail`** (un hoquet isolé ferait basculer le check
  pour rien) : il se tait et écrit le motif dans le journal du check (`/log`). healthchecks.io
  ne prévient qu'après le délai de grâce — un problème qui dure.

### Configuration (une seule fois)

1. Créer un compte gratuit sur https://healthchecks.io (20 checks gratuits, e-mail inclus).
2. Créer un check « Momentum — surveillance » : **Period 5 minutes, Grace 1 hour**.
3. Copier son URL de ping (`https://hc-ping.com/<uuid>`).
4. Vercel → projet `momentum-plateforme` → Settings → Environment Variables → Production :
   `HEALTHCHECK_PING_URL` = cette URL (avec `printf`, jamais `echo`, si en ligne de commande).
5. Redéployer (un `git push` suffit).

Tant que la variable manque, un incident non urgent le rappelle une fois.

⚠️ **Le jour d'un transfert** : l'adresse qui reçoit les e-mails de healthchecks.io doit
être celle du mainteneur, et **sur un autre domaine que l'expéditeur de la plateforme** —
si ce domaine expire, les deux canaux tomberaient ensemble.

---

## 5. Témoins joués le 2026-09-13

Une surveillance qui n'a jamais rien détecté n'a rien prouvé (docs/sante-plateforme.md).

| Pièce | Témoin | Résultat |
|---|---|---|
| `signaler_incident` | regroupement, gravité qui ne redescend pas, 4 cas de réarmement | ✅ les 4 |
| `pgcron_sante` | job `select 1/0` planifié, puis désactivé | ✅ « dernier passage en échec », puis « job désactivé » |
| `webhook_queue_sante` | lignes simulées bloquée / abandonnée / saine | ✅ |
| Filet `fetch` + vrai `supabase-js` | colonne inconnue, écriture NOT NULL, requête saine | ✅ normale / critique (valeurs retirées) / intacte |
| `/api/sante/incident-client` | POST sans session | ✅ incident `normale` |
| `next build` | build de production complet | ✅ |

---

## 6. Ajouter une surveillance

- **Une conséquence dans les données** → une vue SQL (vide ou `etat like 'ALERTE%'` quand
  tout va bien), puis une entrée dans `SURVEILLANCES` de `app/api/sante/alerte-vues/route.ts`
  (`critique: true` seulement si des données ou de l'argent se perdent tant que personne
  n'agit). Sans cette entrée, la vue est muette.
- **Une panne qu'un `catch` avale** → `signalerIncident()` (Vercel) ou
  `signalerExceptionEdge()` (Edge) dans ce `catch`, avec une empreinte **sans identifiant
  de ligne ni date**.
- **Une nouvelle Edge Function** → `Deno.serve(servirAvecFilet('<nom>', async (req) => …))`.

⚠️ Avant d'ajouter une surveillance ici, se demander **qui peut agir**. Une donnée métier
d'un coach (trop-perçu, client à relancer) n'a rien à faire dans ces e-mails : elle
appartient à l'écran du coach (voir le commentaire de `ventes_sante_sur_encaissement`).

---

## 7. Ce qui reste hors de portée, en connaissance de cause

- **Une Edge Function tuée par la limite CPU ou mémoire** ne passe par aucun `catch` :
  c'est `crons_passages` (silence) qui la voit.
- **L'expiration d'un domaine hors `.com`/`.app` à deux niveaux** (ex. `.co.uk`) : le
  domaine enregistrable est déduit des deux derniers segments.
- **Le plafond de la base en plan Pro** : `base_sante_taille` raisonne sur 500 Mo. Le jour
  du passage en Pro, adapter la vue (sinon une fausse alerte « plan gratuit », et le plafond
  de 8 Go non surveillé).
- **Vercel Hobby** interdit l'usage commercial et peut couper un projet jusqu'à 30 jours en
  cas de dépassement de quota : c'est une décision de plan, pas une alerte.
