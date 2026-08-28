# Stripe — la chaîne des paiements, et ce qui la casse

Ce document existe parce que **la configuration Stripe vit dans le dashboard, hors
du dépôt**. Rien dans le code ne dit quels événements sont écoutés, et une case
cochée par erreur dans l'interface peut faire passer un chiffre en négatif sans
qu'aucun test ne s'en aperçoive.

À lire avant de toucher à `app/api/webhooks/stripe/route.ts`, à
`lib/dealCash.ts` ou à la configuration du webhook.

---

## 1. La règle de l'argent — une seule, en un seul endroit

```
Cash encaissé net = Σ(succeeded) − Σ(refunded) − Σ(disputed)
```

Le **montant** fait foi, jamais un statut supplémentaire. La règle vaut pour un
remboursement total, partiel, ou plusieurs successifs.

Elle vit dans `lib/dealCash.ts` — **en deux copies synchronisées** :

```
lib/dealCash.ts                          ← 3 appelants côté site
supabase/functions/_shared/dealCash.ts   ← l'Edge Function sync-stripe-payments
              ↑
   un test de cohérence compare les deux implémentations
```

⚠️ **L'import direct est impossible**, et ce n'est pas une facilité : Deno exige
l'extension (`'../_shared/x.ts'`) que `tsc` refuse ; il n'y a ni `deno.json`, ni
`import_map.json` ; et le journal d'upload de `supabase functions deploy` prouve
que seuls les fichiers **sous `supabase/functions/`** partent avec la fonction.
Un module dans `lib/` aurait cassé la fonction au premier appel.

**Modifier l'une sans l'autre fait échouer `npm test`** avant tout déploiement.
Après toute modification de ce module, redéployer la fonction :

```bash
npx deno check supabase/functions/sync-stripe-payments/index.ts
npx supabase functions deploy sync-stripe-payments --project-ref nvjgwtetyuatnkjihmtw
```

### L'incohérence `ch_…` / `pi_…` qui rend le calcul juste

Un remboursement arrive sous l'identifiant de la **charge** (`ch_…`), alors qu'un
paiement comptant est enregistré sous celui de son **PaymentIntent** (`pi_…`).
Le `delete + insert` de `recordPayment` ne retrouve donc pas la ligne existante
et **crée une ligne séparée** — ce qui rend la soustraction correcte.

> ⚠️ **Ne JAMAIS « harmoniser » ces identifiants.** Le remboursement écraserait
> le paiement au lieu de s'ajouter à côté, et le net passerait **en négatif**, en
> silence. Vérifié en réel le 2026-08-26 : 200 € rendus sur un comptant de
> 1 000 € donnent bien deux lignes, `ch_…` remboursée et `pi_…` encaissée.

### Le seul comptage qui ne déduit PAS les remboursements

`guardInstallments` compte les `succeeded` pour couper un paiement en plusieurs
fois dont le bornage n'a pas pu être posé chez Stripe.

| Comptage | Question posée | Remboursements |
|---|---|---|
| Cash encaissé | « combien d'argent me reste-t-il ? » | **déduits** |
| Filet de bornage | « le client a-t-il été prélevé N fois ? » | **comptés** |

Un prélèvement remboursé **a eu lieu**. Lui appliquer la déduction — 3
prélèvements dont 1 remboursé compterait 2 sur 3 — empêcherait le filet de se
déclencher, et le client serait prélevé une 4ᵉ fois. C'est le seul endroit du
code où un bug coûte de l'argent réel.

---

## 2. Les 11 événements écoutés — et les 5 interdits

Endpoint **Momentum Webhook Connect** → `/api/webhooks/stripe`
Mode **Comptes connectés** · Charge utile **Instantané** · API **2025-02-24.acacia**

| Événement | Ce qu'il fait |
|---|---|
| `checkout.session.completed` | Enregistre le paiement, pose le bornage du plan |
| `charge.succeeded` | Enregistre un paiement comptant |
| `invoice.paid` | Enregistre une échéance de prélèvement automatique |
| `invoice.payment_failed` | Marque l'échec → la vente passe en impayée |
| `charge.refunded` | Ligne `refunded` séparée → le net baisse |
| `refund.failed` | Retire la ligne : le remboursement n'a pas abouti |
| `charge.dispute.created` | Ligne `disputed`, date limite, notification push |
| `charge.dispute.funds_reinstated` | Retire la ligne : litige gagné, l'argent revient |
| `customer.subscription.updated` | Lit `cancel_at_period_end` → « s'arrête après le … » |
| `customer.subscription.deleted` | La vente passe en **terminée**, `ended_by = 'stripe'` |
| `account.application.deauthorized` | L'élève a débranché Stripe |

### Ce qu'il ne faut jamais cocher

| Événement | Pourquoi |
|---|---|
| **`refund.created`** | Doublon de `charge.refunded` → le remboursement compte **deux fois** et le net passe en négatif. ⚠️ Stripe le suggère pourtant dans sa propre interface |
| `payment_intent.succeeded` | Double comptage avec `charge.succeeded` |
| `invoice.payment_succeeded` | Doublon d'`invoice.paid` |
| `invoice.created` | **Bloque la finalisation de TOUTES les factures du compte jusqu'à 72 h** si l'endpoint échoue |
| `invoice.updated` | Bruit pur |

✅ `readInvoiceSubscription` gère **les deux structures** de facture (acacia et
dahlia+) : une montée de version d'API ne demande rien.

---

## 3. Ce que Momentum fait chez Stripe — et ce qu'il ne fait jamais

**Quatre actions, toutes réversibles :**

1. Créer un lien de paiement — avec `restrictions[completed_sessions][limit] = 1`,
   sans quoi un client retrouvant le lien de l'échéance 1 dans ses messages
   pourrait la payer deux fois
2. Désactiver un lien (`active: false`) — réversible
3. Ajuster le montant des prélèvements à venir
4. Ajuster le nombre d'échéances

**Deux gestes que Momentum ne fait JAMAIS :** rembourser, et arrêter des
prélèvements. Les deux sont irréversibles chez Stripe — **un abonnement annulé
ne se réactive jamais**. L'élève les fait lui-même, Momentum constate.

### Ajuster un montant sans rien casser

```js
// 1. Nouveau Price : les prix Stripe sont IMMUABLES
const price = await stripe.prices.create({ unit_amount, currency, recurring, product }, opts)

// 2. Remplacer sur l'item EXISTANT
await stripe.subscriptions.update(subId, {
  items: [{ id: subItemId, price: price.id }],   // ⚠️ l'id est obligatoire
  proration_behavior: 'none',                    // ⚠️ sinon débit immédiat
}, opts)
```

- **Sans `items[0].id`**, Stripe n'écrase pas le tarif : il en **AJOUTE un
  second**, et le client est prélevé des deux. L'erreur ne se verrait qu'au
  prélèvement suivant.
- **Sans `proration_behavior: 'none'`**, Stripe répercute la différence sur les
  jours restants et facture tout de suite.
- ⚠️ **Ne jamais toucher au rythme dans cet appel.** Changer `interval`
  réinitialise l'ancre de facturation, et *« Stripe tente immédiatement le
  paiement lorsque l'ancre du cycle de facturation est réinitialisée »*.

C'est la **seule** raison pour laquelle un changement de rythme oblige à refaire
la vente.

Pour le **nombre d'échéances** : `subscriptionSchedules.update` avec
`phases[].duration` (`iterations` a été supprimé le 2025-09-30). ⚠️ Cet update
est un **remplacement complet** : tout paramètre non retransmis est effacé —
repasser `items`, `start_date`, `metadata`, `end_behavior: 'cancel'`.

---

## 4. Contraintes établies — ne pas re-chercher

| Sujet | Établi |
|---|---|
| Modifier le montant d'un **lien** | **Impossible** — prix immuable : désactiver + nouveau prix + nouveau lien |
| Modifier le montant d'un **prélèvement** | ✅ Possible et sûr, à rythme constant |
| Changer le **rythme** | ⚠️ Prélèvement immédiat → refaire la vente |
| Rembourser | Partiel possible ; ⚠️ le dashboard propose le **total par défaut** |
| Remboursement groupé | ✅ Plusieurs paiements cochés — **totaux uniquement** |
| Événements de remboursement | **Un par paiement**, jamais groupé |
| Délai côté client | **5 à 10 jours ouvrés** |
| Frais | **Jamais remboursés.** Montant variable → ne jamais le chiffrer à l'écran |
| Délai de réponse à un litige | **7 à 21 jours.** Passé le délai, l'argent est perdu automatiquement |
| Latence webhook | < 1 s en normal ; **1 min minimum** en cas de rejeu, jusqu'à 3 jours |
| Volume | 100 opérations/s — hors de portée à 20-40 élèves |
| Désactiver un lien en mode auto | ⚠️ **N'arrête PAS les prélèvements** |

### Libellés du dashboard, vérifiés sur écran réel

- Rembourser : le bouton s'appelle **« Remboursement »** (flèche ↩), en haut à
  droite de la page du paiement — pas « Rembourser »
- Arrêter des prélèvements : **« Annuler l'abonnement »**. Les écrans de Momentum
  le nomment ainsi, alors qu'ils ne disent jamais « abonnement » par ailleurs :
  chercher un bouton qui ne porte pas le nom annoncé est ce qui fait renoncer

---

## 5. Déployer un changement de calcul

Deux morceaux lisent la même règle. **À la livraison chez Quennel** :

1. **Déployer l'Edge Function d'abord, le site ensuite.** Pendant l'intervalle
   les chiffres sont *justes d'un côté, inchangés de l'autre*. Dans l'autre sens
   ils oscilleraient.
2. Choisir un moment creux.
3. Vérifier entre les deux avec la requête de contrôle ci-dessous.

Principe général : quand deux morceaux doivent s'accorder sur un calcul, les
déployer dans l'ordre où le décalage temporaire est *inoffensif*.

---

## 6. Requêtes de contrôle

**Cohérence encaissé / statut** — doit renvoyer zéro ligne :

```sql
select d.id, d.buyer_name, d.amount_total, d.status,
       coalesce(sum(case when p.status = 'succeeded' then p.amount
                         when p.status in ('refunded','disputed') then -p.amount
                         else 0 end), 0) as net
from deals d
left join deal_payments p on p.deal_id = d.id
where d.status not in ('canceled', 'ended')
group by d.id
having (d.status = 'paid'  and coalesce(sum(...), 0) < d.amount_total - 0.01)
    or (d.status = 'open'  and coalesce(sum(...), 0) >= d.amount_total - 0.01);
```

**Bornages non posés** — un plan qui prélèverait indéfiniment :

```sql
select id, buyer_name, installments_count, stripe_subscription_id
from deals
where payment_plan = 'installments_auto'
  and status = 'open'
  and stripe_subscription_id is not null;
-- puis GET /api/payments/schedule?dealId=… : une date de fin absente
-- révèle un bornage qui n'a pas été posé.
```

⚠️ Toute requête sur `calls` : `ignored is not true` **et** `call_type` explicite
(`'calendly'` = vente, `'google'` = coaching). Sans ça les chiffres sont faux.

---

## 7. Ce qu'un remboursement ne dit pas

Un remboursement dit qu'un **mouvement d'argent** a eu lieu. Jamais pourquoi.
Erreur de saisie, geste commercial, rétractation du client : trois raisons
courantes, deux conclusions opposées sur « cette vente a-t-elle eu lieu ».

D'où la règle, décidée le 2026-08-26 :

- **Le cash se corrige automatiquement** — c'est un fait constaté
- **L'appel n'est JAMAIS déclassé automatiquement** — seul le geste explicite
  « Annuler la vente » fait sortir un appel du taux de closing

Deux faits distincts, deux gestes distincts.
