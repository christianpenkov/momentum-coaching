# Short.io API — Documentation interne

Basée sur les tests réels effectués le 31 mai 2026 sur le compte `ubizenai.s.gy`.

---

## Authentification

Toutes les requêtes passent par la clé API stockée dans la table `integrations` de Supabase (`api_key`, `provider = 'shortio'`).

```
Authorization: {API_KEY}
Accept: application/json
```

Deux bases d'URL coexistent selon le type d'opération :
- **`https://api.short.io`** — CRUD (domaines, liens)
- **`https://api-v2.short.io`** — Statistiques

---

## Domaines

### Lister les domaines

```
GET https://api.short.io/api/domains
```

**Réponse (array) :**
```json
[
  {
    "id": 1796576,
    "hostname": "ubizenai.s.gy",
    "unicodeHostname": "ubizenai.s.gy",
    "state": "configured",
    "OrganizationId": "019e421d-1304-7367-835a-a1484c91ccf5",
    "httpsLinks": true,
    "caseSensitive": true,
    "linkType": "random",
    "qrScanTracking": true,
    "createdAt": "2026-05-19T21:21:33.000Z"
  }
]
```

**Champs utiles :**
| Champ | Type | Description |
|-------|------|-------------|
| `id` | number | ID du domaine — utilisé dans toutes les requêtes suivantes |
| `hostname` | string | Domaine court (ex: `ubizenai.s.gy`) |
| `state` | string | `configured` = opérationnel |
| `linkType` | string | `random` = path auto-généré, `increment` = compteur |

---

## Liens

### Lister les liens d'un domaine

```
GET https://api.short.io/api/links?domain_id={DOMAIN_ID}&limit=150
```

**Paramètres :**
| Param | Description |
|-------|-------------|
| `domain_id` | ID numérique du domaine |
| `limit` | Nombre de liens max (150 recommandé) |
| `offset` | Pagination |

**Réponse :**
```json
{
  "count": 3,
  "links": [
    {
      "id": "lnk_7xn2_COryZ0U4acoKiXbaPGMAg",
      "path": "bio-ig",
      "shortURL": "https://ubizenai.s.gy/bio-ig",
      "originalURL": "https://calendly.com/christianpenkov/30min?utm_source=...",
      "title": "Bio Instagram",
      "clicks": 0,
      "humanClicks": 0,
      "createdAt": "2026-05-19T21:30:00.000Z"
    }
  ]
}
```

**Champs utiles :**
| Champ | Description |
|-------|-------------|
| `id` | ID unique du lien (format `lnk_...`) — utilisé pour les stats |
| `path` | Slug court (ex: `bio-ig`, `78DV6H`) |
| `shortURL` | URL complète du lien court |
| `originalURL` | URL de destination avec UTM |
| `clicks` | Clics totaux (bots inclus) |
| `humanClicks` | Clics humains uniquement — **utiliser celui-ci** |

### Créer un lien

```
POST https://api.short.io/links
Content-Type: application/json
```

**Body :**
```json
{
  "domain": "ubizenai.s.gy",
  "originalURL": "https://calendly.com/...",
  "path": "bio-ig",
  "title": "Bio Instagram",
  "utmSource": "ubizenai.s.gy",
  "utmMedium": "bio",
  "utmCampaign": "bio-instagram"
}
```

**Réponse :**
```json
{
  "shortURL": "https://ubizenai.s.gy/bio-ig",
  "id": "lnk_...",
  "path": "bio-ig"
}
```

> **Note :** Si `path` est omis, Short.io génère un slug aléatoire.

### Supprimer un lien

```
DELETE https://api.short.io/links/{LINK_ID}
```

---

## Statistiques

Base URL : **`https://api-v2.short.io`** (différente du reste !)

### Stats d'un domaine (agrégées)

```
GET https://api-v2.short.io/statistics/domain/{DOMAIN_ID}?period=last30
```

**Paramètres `period` :**
| Valeur | Description |
|--------|-------------|
| `last30` | 30 derniers jours |
| `last7` | 7 derniers jours |
| `today` | Aujourd'hui |
| `yesterday` | Hier |

**Réponse :**
```json
{
  "humanClicks": 47,
  "botClicks": 3,
  "totalClicks": 50,
  "clicksChange": 12.5,
  "periodStart": "2026-05-01T00:00:00.000Z",
  "periodEnd": "2026-05-30T23:59:59.000Z",
  "clicksOverTime": [
    { "date": "2026-05-01", "clicks": 4, "humanClicks": 3 }
  ]
}
```

### Stats d'un lien individuel

```
GET https://api-v2.short.io/statistics/link/{LINK_ID}?period=last30
```

**Réponse :**
```json
{
  "humanClicks": 12,
  "botClicks": 1,
  "countries": [{ "country": "FR", "clicks": 10 }],
  "referrers": [{ "referrer": "instagram.com", "clicks": 8 }],
  "browsers": [{ "browser": "Safari", "clicks": 9 }],
  "os": [{ "os": "iOS", "clicks": 9 }],
  "social": [{ "social": "Instagram", "clicks": 8 }],
  "cities": [{ "city": "Paris", "clicks": 6 }],
  "clicksOverTime": [
    { "date": "2026-05-20", "clicks": 3, "humanClicks": 3 }
  ]
}
```

---

## Convention UTM utilisée dans Momentum

Tous les liens générés par la plateforme suivent ce schéma :

| Type de lien | `utm_source` | `utm_medium` | `utm_campaign` |
|-------------|-------------|-------------|----------------|
| Bio Instagram | domaine | `bio` | `bio-instagram` |
| Bio YouTube | domaine | `bio` | `bio-youtube` |
| Desc. contenu IG | domaine | `post` | `{post_id}` |
| Desc. contenu YT | domaine | `post` | `{video_id}` |
| DM prospect | `ig` ou `yt` | `dm` | `{username}_{post_id}` |
| Lead magnet | domaine | `leadmagnet` | `{keyword}` |

---

## Métadonnées stockées en Supabase

Table `integrations`, provider `shortio` :

```json
{
  "api_key": "sk_...",
  "metadata": {
    "domain": "ubizenai.s.gy",
    "domain_id": 1796576,
    "all_domains": [
      { "id": 1796576, "hostname": "ubizenai.s.gy" }
    ]
  }
}
```

---

## Limites connues

- **Rate limit :** Non documenté officiellement, dans les faits ~10 req/s sans blocage observé
- **`humanClicks` vs `clicks` :** Toujours utiliser `humanClicks` — les bots sont filtrés automatiquement par Short.io
- **Latence stats :** Les stats `api-v2` ont un délai de traitement de ~24-48h sur les dernières données
- **Pagination :** `limit=150` couvre la majorité des comptes ; au-delà utiliser `offset`
- **`path` unique :** Si un path existe déjà sur le domaine, Short.io retourne une erreur 409

---

## Piège n°1 : un élève peut avoir PLUSIEURS domaines

`metadata.domain` / `metadata.domain_id` ne décrivent que le domaine **actif** (celui
sélectionné dans les réglages). `metadata.all_domains` liste **tous** les domaines du
compte Short.io.

Quand un élève change de domaine (ex: `ubizenai.s.gy` → `link.ubizenai.com`), les liens
déjà créés sur l'ancien domaine **restent actifs** : ils sont toujours en description
des posts déjà publiés, et continuent d'être cliqués. Tout code qui n'interroge que
`domain_id` les rend donc invisibles — silencieusement, sans erreur.

**Symptôme observé (2026-08-17)** : dans Mes Stats → Funnel & Calls, « 3 calls bookés »
mais « 0 clic sur lien Calendly », alors que les clics existaient bien en base. Les 2
posts à l'origine des calls avaient leur lien Calendly sur l'ancien domaine.

**Règle** : tout appel qui LIT des liens ou des clics doit boucler sur `all_domains`,
avec un repli sur `[{ id: domain_id, hostname: domain }]` si le champ est absent
(comptes connectés avant son introduction).

| Fichier | Rôle | Multi-domaine |
|---|---|---|
| `supabase/functions/poll-leads/index.ts` | cron 30 min, écrit les snapshots | Oui (`snapshotOldDomainLinks`, 2026-08-14) |
| `app/api/shortio/stats/route.ts` | alimente Mes Stats | Oui (2026-08-17) |
| `lib/shortio-fetch.ts` | bouton « Rafraîchir » + click stream | Oui (2026-08-17) |
| `supabase/functions/backfill-shortio/index.ts` | backfill ponctuel | Oui (2026-08-17) |
| `app/api/shortio/links/route.ts` | crée/modifie un lien | Non nécessaire — le domaine cible est explicite dans la requête |
| `app/api/webhooks/instagram/route.ts` | crée le lien perso d'un lead | Non nécessaire — création sur le domaine actif du moment |

**Rate limit sur `last_clicks`** : interroger deux domaines dos à dos sur
`/statistics/domain/{id}/last_clicks` déclenche un 429 (observé en prod le 2026-08-14 :
`x-ratelimit-limit=60`, reset ~48 s). Le quota est partagé entre tous les profils du
même run. Lire l'en-tête `x-ratelimit-reset` et attendre ce délai exact avant un unique
retry — jamais un délai fixe deviné.

## Piège n°2 : deux profils peuvent partager le même domaine

Rien n'empêche deux comptes Momentum de pointer vers le même hostname Short.io. Dans ce
cas, l'API renvoie les **mêmes** `link_id` aux deux profils, et chacun écrit sa propre
ligne dans `shortio_link_daily_snapshots` (la contrainte unique porte sur
`profile_id, link_id, date`). Le profil qui ne possède pas le lien dans son
`content_links` écrit `link_category = null`.

Ce n'est pas un défaut d'isolation Supabase — chaque ligne porte bien le bon
`profile_id` — mais une conséquence du partage d'un domaine externe. En usage normal
(un domaine par élève) le cas ne se produit pas. Observé uniquement entre deux comptes
de test partageant temporairement `ubizenai.s.gy`.
