# Les requêtes qui échouent en silence

> Écrit le 2026-09-05, après avoir découvert que le journal des ventes était vide
> **depuis toujours** sur tous les écrans, sans que rien ne l'ait jamais signalé.

---

## Le défaut, en trois lignes

```ts
const { data: events } = await supa
  .from('deal_events')
  .select('id, deal_id, kind, label, created_at, meta');  // ← la colonne s'appelle `at`
```

PostgREST répond **HTTP 400**. L'erreur n'est pas destructurée, donc jamais lue.
`data` vaut `null`. Le `?? []` en aval en fait une liste vide. L'écran affiche
une section sans contenu.

**Et un journal vide ressemble exactement à un journal sans événement.**

Aucune alerte. Aucun test rouge. Aucun symptôme. Une fonctionnalité qui n'a
jamais existé pour ses utilisateurs, et dont personne ne pouvait deviner
l'absence — pas même en la regardant.

---

## La règle

> **Partout où une liste vide est un résultat plausible, l'erreur doit être lue.**

C'est le seul moyen de distinguer *« il ne s'est rien passé »* de *« je n'ai pas
pu demander »*. Les deux produisent le même écran ; seule l'erreur les sépare.

```ts
const { data, error } = await supa.from('…').select('…');
if (error) console.error('[contexte] …', error.message);
```

Le corollaire est le vrai critère de tri : sur les ~430 requêtes du dépôt qui
jettent leur erreur, la plupart lisent quelque chose d'optionnel et ne méritent
rien. **Celles qui comptent sont celles dont le vide s'affiche.**

---

## Les pièges PostgREST qui produisent ce 400

### 1. Un nom de colonne qui n'existe pas

Le plus courant, et le plus difficile à voir : `created_at` est tellement
attendu qu'on ne le vérifie pas. `deal_events` porte `at`.

### 2. `order` n'accepte PAS les alias du `select`

C'est ce qui a fait échouer le **premier correctif**, posé à moitié :

```ts
.select('id, label, created_at:at, meta')   // ✅ l'alias marche
.order('created_at', { ascending: true })   // ❌ 400 : `order` veut le nom RÉEL
```

Mesuré :

```
order=created_at  →  HTTP 400  column deal_events.created_at does not exist
order=at          →  3 lignes
```

Corriger le `select` sans le `order` ne corrige rien. **Les deux clauses lisent
le même schéma.**

### 3. Un champ absent du `select` mais lu ensuite

Ne produit pas de 400 — produit `undefined`, ce qui est pire : le code continue
et prend une décision fausse. Vu le 2026-09-04 sur `stripe_payment_link_id`, où
un `as` masquait le champ manquant à la compilation.

⚠️ **Un cast `as` sur le résultat d'une requête supprime la seule protection
automatique qui existe.** Sans lui, TypeScript signale le champ absent — c'est
d'ailleurs ce qui a sauvé `refund_explique` le 2026-09-05.

---

## Comment le vérifier, en trente secondes

Interroger PostgREST **directement** et lire le statut HTTP. C'est la seule
mesure qui tranche, parce qu'elle voit ce que le code jette.

```bash
npx vercel env pull /tmp/env --environment=production --yes
# puis, avec NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY :
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  "$URL/rest/v1/deal_events?select=id,kind,label,created_at:at&order=at.asc&limit=3"
```

`200` = la requête passe. `400` = le corps de la réponse nomme la colonne fautive.

---

## Ce qui a été essayé et rejeté

Un script statique qui aurait relu tous les `.select()` / `.order()` du dépôt et
comparé chaque colonne au schéma réel. **Abandonné**, et le motif vaut d'être
gardé :

| Découpage essayé | Faux positifs |
|---|---|
| fenêtre de 1 200 caractères après `.from()` | **710** |
| jusqu'au prochain `.from()` | **2** |
| jusqu'au prochain `;` | **458** |

Associer un `.select()` à son `.from()` par recherche de texte ne marche pas ici :
les chaînes portent d'énormes commentaires entre leurs clauses, et ces
commentaires contiennent des `;` et des noms de tables. Il faudrait analyser le
TypeScript pour de vrai.

**Livrer un contrôle qui signale du code juste, c'est fabriquer l'alerte qu'on
n'ouvre plus** — le défaut même qu'il prétend empêcher. Deux faux positifs sur un
test qui doit bloquer un `git push`, c'est déjà trop.

La garde retenue est donc ciblée et certaine : lire l'erreur là où le vide
s'affiche.
