# Sources de leads Instagram — pipeline coach

Documentation de référence : tout calcul de "nombre de leads IG" (KPI, export, autre page) doit reproduire ces **3 sources cumulées**, pas seulement `instagram_leads`. Découvert le 2026-08-03 après un bug où le KPI "Leads totaux" de la fiche client (`components/pages/coach/PageClientDetail.tsx`) affichait 3 alors que le pipeline visuel (`components/pipeline/PagePipeline.tsx`) en affichait 6 pour le même élève — écart exact expliqué par l'oubli de la 3e source ci-dessous.

**Fonction canonique : `fetchIgLeadsCount` (`lib/salesCallStats.ts`)** implémente ces 3 sources — tout nouvel écran affichant un total "Leads IG" doit l'appeler plutôt que réécrire la logique (une 3e copie locale dans `PageClientDetail.tsx`, désynchronisée du fix de dédup par date la plus ancienne, a été découverte et supprimée en août 2026). Pour un total "Leads" incluant aussi YouTube (ce que les 3 écrans utilisateur affichent réellement — accueil élève, fiche coach, "Mes stats"), utiliser `fetchAllLeadsCount` — voir `docs/integrations-ready-at-vs-onboarding-completed-at.md` pour la 4e source (calls YouTube bookés) et la référence de date à utiliser (`integrations_ready_at`, plus `first_connected_at`/`connected_at`).

## Les 3 sources

### 1. `instagram_leads` — détection automatique
Une ligne est créée automatiquement dès qu'un compte Instagram commente un post avec un mot-clé, répond à une story, ou envoie un DM détecté par le webhook. Filtre standard : `.eq('profile_id', pid).is('archived_at', null).eq('not_a_lead', false)`.

### 2. `prospect_links` — lien Calendly généré manuellement
Créé par le coach quand il génère un lien Calendly personnalisé pour relancer un prospect précis (`app/api/client/prospect-links/route.ts`). Cette table cherche une correspondance dans `instagram_leads` par `ig_username` pour poser `ig_lead_id`, **mais ce champ peut être `null`** si le coach a tapé un `ig_username` qui n'a jamais généré de ligne `instagram_leads` (prospection manuelle, pas de commentaire/story détecté). Dans ce cas, `prospect_links` existe sans équivalent dans `instagram_leads` — c'est volontaire, pas un bug.

`PagePipeline.tsx` (~lignes 1219-1220) fait l'union de ces deux sources, dédupliquée par `ig_username` :
```ts
const allUsernames = new Set<string>([
  ...data.leads.map(l => l.ig_username.toLowerCase()),      // instagram_leads
  ...data.prospects.map(p => p.ig_username.toLowerCase()),  // prospect_links (nommé "prospects" côté API, ne pas confondre avec la table `prospects` séparée pour YouTube)
]);
```

### 3. Calls IG directs sans lead — la source la plus souvent oubliée
`calls` avec `source='ig_description'` ou `source='ig_bio'`, `ig_lead_id IS NULL`, `lead_deleted != true` — un prospect qui a cliqué directement sur un lien Short.io placé en bio ou en description de post IG, **sans jamais commenter ni envoyer de DM**. Il n'existe donc **aucune trace** dans `instagram_leads`, mais un vrai call de vente a bien été booké.

`PagePipeline.tsx:1339-1348`, commentaire explicite dans le code :
```ts
// ── Calls IG description / bio (sans ig_lead_id) ────────────────────────────
// Ces calls viennent d'un clic sur un lien Short.io en description de post IG ou en bio IG.
// Ils n'ont pas de lead DM mais apparaissent dans l'onglet IG directement en call_booked.
const igLinkCalls = data.calls.filter(c => {
  if (c.ig_lead_id) return false;
  if (c.lead_deleted) return false;
  const src = c.source?.toLowerCase() ?? '';
  return src === 'ig_description' || src === 'ig_bio';
});
```
Ces calls sont comptés individuellement par `call.id` (pas par `ig_username`, ils n'en ont pas) — pas de déduplication à faire avec les sources 1+2, ce sont des personnes distinctes.

**Piège découvert le 2026-08-03** : la source 3 doit **impérativement** filtrer `.neq('ignored', true)`, comme le fait déjà `route.ts:31` pour tous les calls du pipeline. Sans ce filtre, le compte inclut aussi les calls que le coach a "supprimés" depuis le pipeline — `PagePipeline.tsx` marque `ignored=true` plutôt que d'effacer physiquement la ligne. Vérifié en base sur le compte de test Christian : 26 calls `ig_description`/`ig_bio` sans lead au total, dont **23 marqués `ignored=true`** (tests nettoyés manuellement) — seuls 3 sont réellement actifs et visibles dans le pipeline. Oublier ce filtre fait exploser silencieusement le compteur avec des données que le coach pensait avoir supprimées.

## Formule complète

```
Leads IG totaux = |union(ig_username de instagram_leads, ig_username de prospect_links)|
                 + count(calls avec source ∈ {ig_description, ig_bio} ET ig_lead_id IS NULL ET lead_deleted != true ET ignored != true)
```

## Vérifié en base (compte test, 2026-08-03)

Pour le client "Christian Penkov" (`profile_id=a02e5927-7b39-4b7d-b112-0a43b30e9f09`) :
- `instagram_leads` (not_a_lead=false) : 3 lignes
- `prospect_links` : 3 lignes, mais **toutes** pointent vers un `ig_username` déjà présent dans `instagram_leads` — aucun apport net dans ce cas précis (source 2 peut apporter des leads supplémentaires sur d'autres comptes, à ne pas ignorer pour autant)
- Calls IG directs sans lead : 3 lignes (RPLZ, Sapos, Leroy — `source='ig_description'`/`'ig_bio'`, `ig_lead_id IS NULL`)
- **Total réel : 6**, cohérent avec le comptage visuel du pipeline
