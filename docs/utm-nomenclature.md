# Nomenclature UTM — un rôle par champ

Référence des paramètres de suivi utilisés dans tous les liens générés par la
plateforme. Ce document existe parce que ces rôles n'étaient écrits nulle part, ce qui a
produit des champs portant plusieurs sens à la fois et des attributions impossibles à
interpréter.

---

## Les cinq champs

| Champ | Question | Valeurs | Exemple |
|---|---|---|---|
| `utm_source` | **Où** — la plateforme | `ig`, `yt` | `ig` |
| `utm_medium` | **Comment** — le canal | `bio`, `description`, `dm`, `story` | `description` |
| `utm_campaign` | **Quoi** — la nature du lien | `calendly`, `lm-<motclé>` | `lm-guide` |
| `utm_content` | **Depuis quoi** — le contenu d'origine | identifiant de post, de vidéo ou de séquence | `18056185901693457` |
| `utm_term` | **Qui** — le prospect | pseudo Instagram | `incogniton.734` |

Règle unique : **un champ, une question.** Si une information peut répondre à deux
questions, c'est qu'elle est mal rangée.

### Précisions

**`utm_content` ne contient JAMAIS un pseudo.** C'est le champ que « Performance par
contenu » compare à l'identifiant d'un post pour rattacher un rendez-vous. Un pseudo à
cet endroit rend la comparaison impossible, et le rendez-vous n'est attribué à aucun
contenu. Le prospect a son propre champ : `utm_term`.

**`utm_content` est vide pour les liens en bio.** Un lien en bio ne vient d'aucun contenu
précis : il n'y a rien à attribuer, et c'est normal.

**`leadmagnet` n'est pas un canal.** Un lead magnet est envoyé *par* un canal (le plus
souvent `dm`, parfois `description`). Sa nature est portée par `utm_campaign`
(`lm-<motclé>`), pas par `utm_medium`.

---

## Contraintes Calendly

Calendly transmet **uniquement** les cinq UTM standards, plus `salesforce_uuid`. Les
paramètres sur mesure ne passent pas : « Calendly does not currently support custom
parameters ». Un `utm_post_id` serait purement et simplement supprimé.

Chaque valeur est limitée à **255 caractères**.

`salesforce_uuid` reste volontairement **libre**. Il est disponible pour un besoin futur,
et résiste mieux aux redirections que les UTM d'après la documentation Calendly. On ne
l'utilise pas aujourd'hui : un champ nommé « salesforce_uuid » contenant un identifiant
Instagram recréerait exactement le problème de lisibilité que ce document corrige.

---

## Comment un rendez-vous est rattribué

Deux mécanismes coexistent, chacun pour un parcours. Ils se complètent sans trou.

**Parcours 1 — le prospect a commenté un mot-clé** (lead magnet)

Le rattachement se fait **en base**, jamais par les UTM :

```
commentaire #GUIDE
  → ligne dans instagram_lead_lm_history (ig_user_id + mot-clé)
  → lead dans instagram_leads
  → le call reçoit calls.ig_lead_id
```

La table « Performance LM » remonte ce chemin à l'envers : mot-clé → interactions →
leads → calls. **Inutile donc d'écrire le lead magnet dans les UTM du lien Calendly** :
aucune lecture ne va le chercher là.

**Parcours 2 — clic direct depuis une description**

Le rattachement se fait par `utm_content`, comparé à l'identifiant du post :
`c.utm_content === p.id` (PageClientStats). C'est pour ce parcours que `utm_content`
doit rester propre.

**Parcours 3 — clic depuis la bio**

Aucun rattachement à un contenu, par nature. Le rendez-vous est compté, mais aucun post
n'en est crédité.

---

## Où les liens sont générés

| Point de génération | `utm_content` reçoit | État |
|---|---|---|
| Lien Calendly par prospect (Gérer mes liens) | identifiant du post | Correct |
| Lien Calendly en description | identifiant du post | Correct |
| Lien Calendly en bio | vide | Correct, par nature |
| Lien Calendly de séquence story | identifiant de séquence | Correct |
| Lead magnet automatique après commentaire (webhook) | identifiant du post | Corrigé le 2026-08-19 |
| Lead magnet automatique après story (webhook) | identifiant de séquence | Corrigé le 2026-08-19 |

Les deux derniers écrivaient le **pseudo** dans `utm_content`, ce qui recréait l'anomalie
à chaque envoi automatique.

---

## Surveillance

La vue **`utm_anomalies`** signale en permanence les écarts, sans rien bloquer :

```sql
SELECT anomalie, count(*) FROM utm_anomalies
WHERE anomalie IS NOT NULL GROUP BY anomalie;
```

Elle détecte : un domaine dans `source`, un `utm_content` qui n'est pas un identifiant de
contenu, un `utm_medium` hors nomenclature, une plateforme inconnue, et une contradiction
entre `source` et `utm_medium`.

Le choix de ne rien bloquer est délibéré : une contrainte stricte rejetterait un nouveau
canal légitime (LinkedIn, newsletter, publicité). La vue rend le désordre **visible**
sans empêcher d'évoluer.

---

## Migration du 2026-08-19

Sauvegarde : `_backup_calls_utm_20260819`.

- Ajout de la colonne `calls.utm_term`, jusque-là inexistante alors que le champ était
  déjà écrit dans les liens : l'information partait vers Calendly et se perdait
- 23 pseudos déplacés de `utm_content` vers `utm_term`
- `source` nettoyé du domaine du raccourcisseur (`ubizenai.s.gy_description` →
  `yt_description`)
- Lecture et stockage de `utm_term` ajoutés aux trois points d'entrée des rendez-vous
  (webhook Calendly, `sync-calendly`, `calendly-fetch`)

Vérifié après migration : aucune attribution perdue. Les deux rendez-vous porteurs de
chiffre d'affaires concernés n'étaient déjà pas attribués avant, leur `utm_content`
contenant un pseudo que la comparaison ne pouvait pas satisfaire.

---

## Ce qui reste à traiter

**Contradiction `source` / `utm_medium` sur 9 rendez-vous.** Quand un rendez-vous est
reprogrammé, le webhook Calendly fait hériter `source` de l'ancien mais reprend
`utm_medium` du nouveau clic. Les deux champs décrivent alors deux moments différents :
d'où vient le prospect, et par où il a replanifié.

Décision prise : **créditer le premier contact**. C'est le contenu qui a créé
l'opportunité ; le DM n'a servi qu'à replanifier un rendez-vous déjà acquis. `utm_medium`
doit donc hériter comme `source`. Correction du webhook et mise à jour des 9 rendez-vous
existants à faire.

**Valeurs hors nomenclature laissées en l'état** : `linkedin_post`, `test_bio`,
`utm_medium = post`. Ce sont des essais manuels ou un canal non encore formalisé. Les
réécrire inventerait une attribution qui n'a jamais existé.
