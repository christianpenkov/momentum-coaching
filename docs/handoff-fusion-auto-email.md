# Handoff — fusionner automatiquement deux fiches qui partagent un e-mail exact

**Pour le chat Pipeline Leads.** Décision de Chris le 2026-09-07. Un second
handoff part au chat Mes Stats pour la partie comptage : voir
`handoff-fusion-auto-email-mes-stats.md`. **Les deux doivent être faits, et celui-ci
en premier** — Mes Stats corrige une conséquence de ce qui est décidé ici.

---

## Le problème

Une même personne peut occuper **deux fiches** : une fiche Instagram (elle a
commenté, donc `instagram_leads` existe) et une fiche e-mail (elle a réservé
depuis une bio ou une description, donc seulement un `call`).

Aujourd'hui, ces deux fiches ne se rejoignent que si le coach clique sur le
bandeau de doublon. Tant qu'il ne l'a pas fait, la personne est comptée **deux
fois** partout : dans « Leads » de Mes Stats, dans celui de « Gérer mes liens »,
et elle occupe deux cartes dans le pipeline.

## Pourquoi on peut automatiser, alors qu'on avait choisi de demander

Le mécanisme qui donne un e-mail à un lead Instagram :

```
Le lead commente         → instagram_leads (pseudo, AUCUN e-mail)
Il réserve via le DM     → calls.ig_lead_id + calls.invitee_email
                           ← c'est ICI que le lead acquiert un e-mail
Il réserve depuis la bio → calls.invitee_email, sans ig_lead_id
                           ← même e-mail : c'est la même personne
```

Décision de Chris, mot pour mot : *« on peut fusionner automatiquement sans
risquer d'erreurs ? oui je pense avec l'email exact vu que personne au monde n'a
exactement le même email »*.

L'objection écartée le 2026-08-27 (« un couple, une boîte contact@ ») l'avait déjà
été par lui : *« aucune adresse email peut être partagé »*.

⚠️ **Le seul faux positif connu reste** : les réservations de test de Chris avec
sa propre adresse. Il en existe une en base — `christianpenkov80@gmail.com` sur un
call rattaché à `christian_penkov`.

---

## Ce qu'il faut faire

### 1. Fusion automatique à l'arrivée d'un rendez-vous

Quand un call arrive avec un `invitee_email`, chercher un AUTRE call du même
élève portant **exactement** le même e-mail (insensible à la casse) et un
`ig_lead_id`. S'il existe, poser ce `ig_lead_id` sur le nouveau call.

⚠️ **Deux points d'entrée, pas un.** Le piège documenté le 2026-08-27 : seule la
route Vercel posait `prospect_id`, l'Edge Function ne le faisait pas, et **11 calls
sur 13 n'étaient jamais rattachés**. Les deux chemins doivent appeler la même
fonction :

- `supabase/functions/sync-calendly/index.ts` — **c'est celui qui tourne pour de
  vrai** (cron) ;
- `app/api/webhooks/calendly/route.ts`.

La leçon retenue à l'époque avait été d'écrire une fonction SQL partagée
(`resolve_prospect`). Faire pareil ici, ou l'étendre.

### 2. Respecter un refus déjà exprimé — ET une séparation

> ⚠️ **Ce point était incomplet dans la version initiale de ce handoff, et le trou
> était bloquant.** Corrigé par le chat Pipeline Leads le 2026-09-07 ; laissé ici
> parce que la raison de l'erreur vaut mieux que sa disparition.

`fusions_fiches` portait DEUX états : `fusionnee` et `refusee`. Ce handoff ne
demandait de garder que le second — et c'était insuffisant.

**« Séparer » n'écrivait pas un refus : il EFFAÇAIT la ligne**, délibérément, pour
que le bandeau repropose la paire. Le commentaire de
`app/api/client/pipeline/fusion/route.ts` le disait explicitement.

Avec une fusion automatique qui repasse toutes les 30 minutes, une paire sans
décision est une paire qu'on refusionne : la séparation du coach aurait été
défaite dans la demi-heure, en silence, indéfiniment.

**Résolution (arbitrée par Chris)** : un troisième état `separee`. Le bandeau
repose la question — c'est ce que « séparer » voulait dire — et la fusion
automatique s'abstient. Les deux gestes sont préservés au lieu de s'annuler.

La fonction doit donc s'abstenir sur `refusee` **et** `separee` :

```sql
and f.statut in ('refusee', 'separee')
```

Zéro décision en base au 2026-09-07 — le cas n'existe pas encore, ce qui rendait
la garde d'autant plus facile à oublier.

### 3. Rattrapage unique sur l'existant

Décision de Chris : *« je choisis les deux comme ça on a pas de trucs qui sont
différents de compta différente »*. Une migration qui, pour chaque élève,
rapproche les calls partageant un e-mail exact quand l'un porte un `ig_lead_id` et
l'autre non — **en épargnant les paires refusées**.

**Mesuré le 2026-09-07 : 0 paire à rattraper.** Sur 19 calls de vente avec e-mail,
aucun e-mail n'apparaît des deux côtés. Le rattrapage ne changera donc rien
aujourd'hui — il existe pour que la règle soit vraie sur tout l'historique, pas
seulement à partir de maintenant.

⚠️ **Et la fonction doit être verrouillée.** `revoke execute from anon` et
`from authenticated` ne suffisent PAS : `PUBLIC` garde `EXECUTE`, et les deux
rôles en héritent. Sur une fonction `SECURITY DEFINER` qui écrit dans `calls`,
cela la rend appelable sans aucune session. Révoquer aussi `from public`, puis
**mesurer** — `has_function_privilege('anon', …, 'EXECUTE')` doit rendre `false`.

⚠️ Ce zéro ne prouve rien sur l'avenir : la base ne contient que des données de
test. C'est la même erreur de raisonnement que celle corrigée dans le handoff du
2026-08-27, où « chevauchement = 0 » avait failli faire abandonner la détection.

### 4. Le bandeau de doublon reste

Il garde sa raison d'être pour les paires qui **ne partagent pas** d'e-mail — deux
fiches rapprochées par le nom seul. La fusion automatique lui retire seulement les
cas certains.

---

## Ce qui bouge dans le pipeline, et qu'il ne faut PAS « corriger »

Chris a posé la question : *« s'il book depuis YT ? dans pipeline leads comment on
fait pour les onglets, on ne le comptera pas dans youtube mais dans insta alors ?
ok pourquoi pas »*.

**C'est déjà le comportement du code**, et c'est le bon :

```
PagePipeline.tsx — nonIgCalls
  if (c.ig_lead_id) return false;   ← un call fusionné quitte YT / Autres
```

Une personne fusionnée apparaît donc dans l'onglet **Instagram**, via sa fiche
`instagram_leads`, avec tout son historique — y compris son rendez-vous YouTube.
Elle disparaît de l'onglet YouTube. C'est ce que Chris a validé.

⚠️ **Ne pas confondre avec l'attribution.** Poser `ig_lead_id` ne change PAS d'où
vient le rendez-vous : `calls.source` reste `yt_description`. La règle établie le
2026-08-29 tient toujours — *« l'attribution d'un call se lit sur sa source, jamais
sur son rattachement »* (`lib/canalDm.ts`, et les gardes posées dans
`story-sequences-stats` et `PageClientStats`). Une fusion qui ferait basculer un
call en « via DM » quelque part serait un bug.

---

## Vérification attendue

1. Deux calls du même élève, même e-mail, l'un avec `ig_lead_id` : après la
   fusion, les deux le portent.
2. Une paire marquée `refusee` **ou `separee`** : la fusion automatique ne
   s'applique pas.

⚠️ **Un cas positif d'abord.** Deux « ne fusionne pas » ne prouvent rien tant
qu'on n'a pas montré que la fonction fusionne quand elle doit : sans témoin
positif, ils peuvent venir d'une fonction qui ne marche simplement pas.
3. Le pipeline montre une seule carte, dans l'onglet Instagram.
4. `calls.source` est inchangé sur les deux lignes.
5. La chaîne d'attribution d'une vente désigne toujours le contenu d'origine, pas
   le lead Instagram.
