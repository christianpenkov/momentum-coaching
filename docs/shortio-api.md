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
