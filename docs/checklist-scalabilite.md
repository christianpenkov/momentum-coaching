# Checklist — une intégration tient-elle à 40 élèves, sans maintenance ?

À dérouler sur **chaque intégration** qui interroge une API externe : YouTube,
Instagram, Short.io, Calendly, Stripe.

Chaque point de cette liste a trouvé un vrai défaut sur YouTube le 2026-08-21.
Le détail de cet audit est dans [`youtube-scalabilite.md`](./youtube-scalabilite.md).

**Objectif** : 30-40 élèves, zéro intervention après livraison à Quennel.

---

## État par intégration

| Intégration | Auditée | Capacité mesurée | Doc |
|---|---|---|---|
| YouTube | ✅ 2026-08-21 | **121 élèves** | [youtube-scalabilite.md](./youtube-scalabilite.md) |
| Instagram | ❌ à faire | inconnue | — |
| Short.io | ❌ à faire | inconnue | [shortio-api.md](./shortio-api.md) |
| Calendly | ❌ à faire | inconnue | — |
| Stripe | ❌ à faire | inconnue | — |

---

## 1. Compter les appels — ne pas les estimer

```
appels par exécution × exécutions par jour × nombre d'élèves
```

À comparer au quota **documenté** de l'API (le vérifier, ne pas le supposer).

> **Mesure YouTube** : 7 appels × 288 passages/jour = **2 027 appels/jour/élève**,
> contre 10 000/jour partagés entre tous. La plateforme cassait au **5ᵉ élève**.
> Rien ne l'annonçait.

Quotas connus :

| API | Quota/jour | Partagé ? |
|---|---|---|
| YouTube Data v3 + Analytics | 10 000 unités | oui, tous élèves confondus |
| Instagram Graph | à vérifier | — |
| Short.io | ~60 req/fenêtre | oui (clé/domaine) |

---

## 2. Vérifier la fréquence réelle du cron

Ne jamais la déduire d'une note, d'une mémoire ou d'un commentaire. La mesurer :

```sql
select date_trunc('hour', updated_at) as heure, count(*)
from analytics_daily_snapshots
group by 1 order by 1 desc limit 24;
```

> Un commentaire affirmait « ce cron tourne une fois par jour », une note de
> mémoire disait « lundi 07:00 ». Il tourne **toutes les 5 minutes**.

Le cron `poll-leads` est une **Edge Function Supabase**, pas une route Vercel.
Déploiement séparé obligatoire.

---

## 3. Adapter la cadence à la fraîcheur réelle

Si l'API a 2-3 jours de latence, resynchroniser toutes les 5 minutes ne rend
**aucune** donnée plus fraîche.

| Nature de la donnée | Cadence |
|---|---|
| Métriques journalières | 1×/heure |
| Répartitions sur fenêtre glissante | 1×/jour |
| Données immuables (durée d'une vidéo) | 1× seulement |
| Leads / commentaires entrants | à chaque passage |

Garde-fou via `integrations.last_synced_at` (la colonne existe déjà).

> Gain YouTube sur ce seul point : **12×**.

---

## 4. Horodater même en cas d'échec

```javascript
await supa.from('integrations')
  .update({ last_synced_at: new Date().toISOString() })
  .eq('profile_id', profileId).eq('provider', 'youtube');
```

Sinon un compte au jeton révoqué relance ses appels à chaque passage,
indéfiniment, et brûle le quota de **tous les autres élèves**.

Une heure de retard sur un compte en panne vaut mieux qu'un quota épuisé pour
tout le monde. L'erreur reste tracée dans `last_snapshot_error`.

---

## 5. Utiliser la taille de lot maximale

Le coût d'un appel ne dépend pas du nombre d'identifiants qu'il porte.

⚠️ **Vérifier la limite réelle de chaque endpoint** : elle peut être en nombre
d'ids pour l'un et en **caractères** pour l'autre.

> YouTube : `videos.list` accepte **50 ids**, mais le filtre `video==` de
> l'Analytics API est borné à **500 caractères** (~40 ids). Une seule constante
> partagée entre les deux finissait par violer l'une des limites.

---

## 6. Fenêtre de rattrapage plus large que l'intervalle

Si le cron demande `J-1 → J-0` et saute un passage, le jour manqué n'est
**jamais** rattrapé — définitivement, si l'API ne renvoie que la valeur courante.

Demander `J-3 → J-0` coûte le même appel et absorbe trois jours de panne.

> Six jours consécutifs manquaient en juin sur un profil. Hors fenêtre de
> rattrapage : perdus.

---

## 7. Aucun échec silencieux

```javascript
if (res.ok) { /* traiter */ }   // ❌ et rien d'autre
```

Un quota dépassé renvoie 403, la condition est fausse, le code continue, et une
ligne **vide** est écrite — indiscernable d'une vraie absence. Si un garde-fou
empêche ensuite le rattrapage, la journée est perdue pour toujours.

Décider explicitement :
- **interrompre** si la donnée est essentielle (un trou se rattrape au passage
  suivant, une ligne fausse reste) ;
- **tracer et continuer** si c'est un complément.

```bash
# Chercher le motif dans une intégration
grep -n "if (.*\.ok)" chemin/vers/fichier.ts
```

---

## 8. Journaliser en base, jamais dans les logs

Les logs Supabase et Vercel ne sont consultés par personne — c'est une règle du
projet.

```sql
select * from cron_runs order by ran_at desc;
```

Table **vide = aucun incident depuis 30 jours**.

Deux principes : n'écrire **que** les passages en échec (288 lignes/jour sinon,
pour dire que tout va bien), et **purger automatiquement** par trigger.

---

## 9. Une vue de santé qui ne coûte rien

Une **vue** SQL : rien à maintenir, rien à nettoyer, toujours à jour.

```sql
select * from yt_sante_donnees;
```

Elle doit alerter quand le retard dépasse la fenêtre de rattrapage — au-delà, les
journées perdues le sont définitivement.

> Elle a immédiatement trouvé six jours absents que personne n'avait vus.

---

## 10 bis. À retirer le jour où Google validera l'application

Les intégrations **YouTube** et **Google Calendar** affichent un encadré
« Google affichera un avertissement — c'est normal », avec quatre étapes pour
passer l'écran de sécurité de Google (triangle rouge, « Paramètres avancés »,
lien « non sécurisé »).

Cet écran disparaîtra dès que l'application sera validée par Google. À ce
moment-là, **ces instructions deviendront fausses** et devront être retirées.

Le texte vit à un seul endroit : `lib/onboarding/integrationConfig.ts`, dans le
champ `instructions` de `youtube` et `google`. Les trois écrans qui l'affichent
(wizard, réglages élève, réglages coach) le lisent depuis là.

---

## 10. Vérifier le parcours de première connexion

Le chemin de *backfill* initial est souvent une **copie partielle** du cron.
Les comparer ligne à ligne.

> `lib/yt-fetch.ts` (première connexion) ne récupérait que **3 des 7 sources** de
> la copie Deno. Quatre cartes restaient vides sur l'écran de quelqu'un qui
> venait de connecter son compte.

Question de contrôle : **après connexion, l'écran est-il complet immédiatement ?**

---

## 11. Lancer le bon vérificateur de types

**`tsc` et `npm run build` ne couvrent pas `supabase/functions/`.**

```bash
npx deno check supabase/functions/poll-leads/index.ts
```

> Une erreur y a vécu des mois sans être vue. Elle masquait un vrai défaut : un
> faux zéro écrit quand la donnée était inconnue.

---

## 12. Isolation des erreurs entre élèves

Un profil qui plante ne doit jamais empêcher les autres d'être traités.

```javascript
try {
  await snapshotProfile(profile.profile_id);
} catch { profileErrors.push('snapshot_failed'); }
```

✅ Déjà en place dans `poll-leads`, avec `mapWithConcurrency(profiles, 5, ...)`.

---

## 13. Le temps d'exécution n'est presque jamais la contrainte

Budget Edge Function : **150 s**. À concurrence 5, 40 profils tiennent en moins
de 65 s même en scénario pessimiste.

⚠️ **Paralléliser davantage n'aide pas** : les mêmes appels partent, juste plus
vite — le quota s'épuise plus tôt dans la journée. La contrainte est le **nombre
d'appels**, pas leur vitesse.

---

## Commandes de contrôle

```bash
# Vérification de types Deno (obligatoire avant déploiement)
npx deno check supabase/functions/poll-leads/index.ts

# Déploiement Edge Function (ne part PAS avec git push)
npx supabase functions deploy poll-leads --project-ref nvjgwtetyuatnkjihmtw --no-verify-jwt
```

```sql
-- Tout va bien ?
select * from cron_runs order by ran_at desc;   -- vide = aucun incident
select * from yt_sante_donnees;                 -- 'ok' partout
```

---

## Voir aussi

- [`youtube-scalabilite.md`](./youtube-scalabilite.md) — l'audit YouTube complet
- [`audit-metriques-youtube.md`](./audit-metriques-youtube.md) — l'audit des chiffres
- Skill `audit-metrique-bout-en-bout` — la méthode réutilisable
  (`~/.claude/skills/audit-metrique-bout-en-bout/SKILL.md`)
