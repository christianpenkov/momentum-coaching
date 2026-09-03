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
| Instagram — métriques de compte | ✅ 2026-08-22 | quota par utilisateur (non partagé) | [instagram-scalabilite.md](./instagram-scalabilite.md) |
| Instagram — contenus | ✅ 2026-08-30 | **~6 appels / 100 posts / nuit** (était 801) | [handoff-appels-instagram-scalabilite.md](./handoff-appels-instagram-scalabilite.md) |
| Short.io | ✅ 2026-08-31 | **coût indépendant du nombre d'élèves** | [shortio-api.md](./shortio-api.md) |
| Calendly | ✅ 2026-08-31 | **quota par jeton (non partagé)** — 60 req/min/élève | — |
| Stripe | ✅ 2026-09-02 | **~3 840 appels/jour à 40 élèves, ~2 % de la limite** | — |

> **Stripe, audité le 2026-09-02** : le volume d'appels n'a jamais été le risque
> (2 appels × 48 passes × 40 élèves, limiteur 20 req/s partagé). Les vrais
> défauts étaient de **justesse**, pas d'échelle, et sont corrigés : la copie
> Deno écrivait les remboursements à `paid_at NULL` (invisibles de toutes les
> fenêtres, et elle écrasait la ligne correcte du webhook toutes les 30 min) ;
> les remboursements **tardifs** n'étaient jamais vus (la fenêtre filtrait sur
> la date de la CHARGE, pas du remboursement — passe `/v1/refunds` ajoutée) ;
> et `refreshDealStatus` Deno était une copie amputée (pas de désactivation de
> lien à l'annulation) — remplacée par un appel à `/api/stripe/deal-effects`,
> qui exécute la règle unique de `lib/dealStatus.ts`. Pattern réutilisable :
> quand une Edge Function a besoin d'un code qui vit dans `lib/`, une petite
> route Vercel authentifiée CRON_SECRET vaut mieux qu'une copie Deno figée.

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
| Instagram Graph | **4800 × impressions/24h** | **non**, par utilisateur |
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

⚠️ **Changer une cadence oblige à revérifier la DATE écrite.** Un instantané
quotidien porte une date ; tant qu'il n'y a qu'un passage par jour, on ne se pose
pas la question. Dès qu'il y en a plusieurs, il faut décider explicitement lequel
clôture la journée écoulée — sinon les passages de l'après-midi réécrivent la
ligne de la veille avec le trafic du jour. Aucune erreur, aucun log, juste des
chiffres faux tous les jours.

> Instagram : en passant de 1 à 6 passages/jour, la ligne de la veille n'est plus
> réécrite qu'au **premier** passage suivant minuit, et seulement dans le premier
> créneau. Trois branches, isolées en fonction pure testée
> (`datesDuSnapshot`) — parce qu'aucune des trois erreurs possibles ne se voit.

⚠️ **Étaler les profils par un décalage dérivé de leur identifiant**, jamais par
la dérive naturelle des horodatages. La seconde marche, mais par accident : elle
disparaît dès qu'un événement remet tous les profils en phase (panne longue,
reconnexions groupées), et ils tombent alors tous dans la même invocation.

---

## 3 bis. Ne jamais écrire un ÉTAT ACTUEL sur une ligne datée

Deux natures de données se ressemblent dans une réponse d'API et n'ont rien à
voir :

| | exemple | valable pour |
|---|---|---|
| **métrique datée** | `insights?metric=reach&period=day&since=…` | la journée demandée |
| **état actuel** | `?fields=followers_count` | aujourd'hui, point |

Mélangées dans un même objet, un `...metrics` sur une ligne datée écrit l'état
d'aujourd'hui sur une date passée. Le rattrapage aggrave tout : il rejoue de
vieilles journées et les tamponne toutes avec la valeur du jour.

> Instagram : `ig_followers` venait de `followers_count`. Constaté en base le
> 2026-08-30 — les lignes du 22 juillet au 18 août, **toutes écrites le 27 août**
> par le rattrapage, portaient **toutes 255 abonnés**, la valeur live ce jour-là.
> La colonne n'était pas un historique mais « la dernière valeur connue au moment
> où la ligne a été touchée ». Les deux graphiques qui la lisent en héritaient.
>
> Le chemin Node portait **déjà** la garde, avec un commentaire décrivant le même
> incident du 2026-07-06 (« 60 jours d'historique aplatis »). La copie Deno ne
> l'avait jamais reçue. Motif « deux copies, une seule à jour ».

> Short.io, 2026-08-31 : troisieme occurrence, et cette fois la colonne n'est meme
> pas une metrique. `shortio_link_daily_snapshots.original_url` porte la destination
> du lien **au dernier passage du cron**, pas celle du jour de la ligne. Une vue de
> sante qui s'en servait pour dater une migration voyait des journees anterieures
> tamponnees « deja migree », et allait sortir une fausse alerte.
>
> **Question de controle, moins chere que la regle** : cette colonne serait-elle
> differente si la ligne avait ete ecrite hier plutot qu'aujourd'hui ? Si non, elle
> decrit le present, quelle que soit la date de sa ligne.

**Le correctif qui tient** : séparer les deux natures dans le type de retour
(`{ jour, compte }`), pour que `...jour` ne PUISSE plus emporter l'état. Une
règle dans un commentaire se reperd à la copie suivante ; une frontière dans le
type, non.

⚠️ **Mesurer avec un signal spécifique.** `updated_at` de la ligne ne prouve
rien : d'autres écrivains (calls, Stripe) la touchent au même passage. Poser une
**valeur sentinelle** dans la colonne visée, relancer, et regarder si elle
survit — c'est le seul test qui distingue « mon bloc n'a pas écrit » de « la
ligne n'a pas bougé ».

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

⚠️ **La capacité de groupage se vérifie avec LE jeton du projet sur L'HÔTE du
projet, jamais depuis la doc seule.** Les grands fournisseurs ont plusieurs
variantes d'API dont les capacités diffèrent en silence.

> Instagram : la doc Meta décrit des « requêtes groupées » (50 sous-requêtes en un
> appel HTTP), et c'était la solution retenue dans un handoff. Testée, elle est
> **inaccessible** avec un jeton Instagram Login (« Cannot call API for app … on
> behalf of user 0 »). Le mécanisme réellement disponible — la lecture multi-objets
> `?ids=` — n'était cité nulle part dans la page consultée.

---

## 5 bis. Re-tester toute « parade » documentée dans le code

Un commentaire qui justifie un surcoût structurel (« on ne peut pas grouper parce
que… ») décrit l'état de l'API **au jour où il a été écrit**. Le re-tester coûte
quelques minutes ; le croire coûte une architecture construite autour d'une
contrainte qui n'existe plus.

> Instagram : « un appel groupé perd TOUTES les métriques du groupe si Meta en
> refuse une seule » justifiait **8 appels par post**. Testé sur 14 posts couvrant
> trois ans : l'appel groupé rend exactement les mêmes métriques que les appels
> unitaires, dans les 14 cas. Le refus portait sur l'**objet**, pas sur la
> métrique. La parade coûtait 8× et ne rattrapait rien.

Question de contrôle : **la parade a-t-elle été vérifiée, ou seulement héritée ?**

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

## 10 ter. Aucun hook React après un retour anticipé

Trois occurrences trouvées le 2026-08-21, dont deux vieilles de plusieurs mois.

```jsx
function MonComposant() {
  const [a] = useState();
  if (!data) return <Empty />;   // ← sortie anticipée
  const [b] = useState();        // ← JAMAIS exécuté quand data est vide
}
```

React compte les hooks à chaque rendu. Si le nombre change, il lève l'erreur
**#300** et la page casse — d'où les « this page couldn't load ».

Le piège : ça marche tant que la condition est toujours fausse. Le plantage
n'apparaît qu'au moment du chargement d'une nouvelle période, ou en changeant de
type de contenu.

**Les trois cas** : `PageClientStats` (mesure de largeur), `ModalShell` (toutes
les modales de la plateforme), `PageLiens/TabLm` (25 hooks après le retour
« Non disponible sur YouTube »).

Balayage du motif sur tout le dépôt :

```bash
# Cherche un hook situé après un return anticipé, dans chaque composant
python3 - <<'EOF'
import re, io, os
hook = re.compile(r'(useState|useEffect|useCallback|useMemo|useRef|useQuery)\s*[<(]')
early = re.compile(r'^  (?:if\s*\(.+?\)\s*return|return\s+(?!\()\S)')
for base in ['app', 'components', 'lib']:
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.next')]
        for f in files:
            if not f.endswith(('.tsx', '.ts')): continue
            p = os.path.join(root, f)
            lines = io.open(p, encoding='utf-8').read().split('
')
            starts = [(i, m.group(1)) for i, l in enumerate(lines)
                      if (m := re.match(r'^(?:export default |export )?function ([A-Za-z0-9_]+)', l))]
            starts.append((len(lines), '_'))
            for k in range(len(starts) - 1):
                a, nom = starts[k]; b = starts[k + 1][0]
                if not nom[0].isupper() and not nom.startswith('use'): continue
                fr = None
                for i in range(a + 1, b):
                    l = lines[i]
                    if l.strip().startswith(('//', '*')): continue
                    if fr is None and early.match(l): fr = i
                    elif fr is not None and hook.search(l):
                        print(f'{p} :: {nom} (return L{fr+1} -> hook L{i+1})'); break
EOF
```

Résultat attendu : **aucune ligne**.

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

---

## 5 ter. Un appel qui prend un COMPTE, pas un utilisateur, se mutualise

Avant de compter « appels × élèves », regarder ce que l'appel prend en paramètre.
S'il est indexé sur une ressource **partagée** (un domaine, un compte, une chaîne),
tous les élèves qui la partagent demandent la même chose — et le cron la demande
une fois par élève.

> Short.io, mesuré le 2026-08-31 : `fetchShortioLinks` et `fetchClicsShortio`
> prennent un **domaine**. Trois élèves sur `ubizenai.s.gy` récupéraient trois fois
> la même liste et le même flux. À 40 élèves : **80 à 360 appels par passage**
> contre un budget de **50 par minute et par domaine** — soit 1,6 à 7 minutes
> d'attente au limiteur, **au-delà des 150 s** de la fonction. C'était le vrai mur,
> avant même le quota.

Un cache **par invocation**, vidé à chaque démarrage, qui mémorise la **promesse**
et non le résultat : deux profils traités en parallèle attendent le même appel au
lieu d'en lancer deux. Le coût cesse alors de dépendre du nombre d'élèves.

⚠️ **La clé du cache ne doit contenir que la ressource partagée.**

> Les trois profils du même domaine ont **trois clés d'API différentes**. Inclure la
> clé aurait empêché tout partage : le correctif n'aurait rien corrigé, sans que rien
> ne le signale.

⚠️ **Ne jamais mettre un échec en cache** — retirer l'entrée pour que l'appelant
suivant retente avec SES identifiants, sinon une clé révoquée sur un profil fait
échouer tous les autres.

⚠️ **Vérifier que personne ne MUTE le résultat partagé.** Un `push` ou un `sort` sur
un tableau désormais commun corrompt les profils suivants. Ici : vérifié que
`syncLmClickStream` et `snapshotOldDomainLinks` ne font que `filter` et itérer.

---

## 7 bis. Un appel qui échoue toujours ne se voit nulle part

Le point 7 dit de ne pas avaler les échecs. Voici ce que ça coûte quand on l'oublie.

> `poll-leads` appelait `/api/stripe/client-data` avec `Bearer CRON_SECRET` à chaque
> passage et pour chaque profil. Cette route s'authentifie par **session
> utilisateur** : elle répondait **401 depuis toujours**, avalé par un
> `if (res.ok)` sans `else`. Preuve : la colonne `mrr` est vide sur **toutes** les
> lignes de la base. Coût du silence : **345 600 invocations Vercel par mois** à
> 40 élèves — 35 % du quota gratuit dépensé en réponses 401.

Question de contrôle, à poser sur chaque appel interne d'un cron : **quelle colonne
cet appel remplit-il, et est-elle réellement remplie en base ?** Si la réponse est
« aucune », l'appel est mort — quel que soit ce que son code prétend faire.

