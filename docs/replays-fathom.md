# Replays Fathom — qui enregistre, qui peut voir, où c'est stocké

Objectif de cette page : pouvoir modifier le replay d'un call sans relire le
webhook, le cron et la route de téléchargement en même temps.

---

## Le modèle en une phrase

**Chaque personne connecte son propre compte Fathom.** Un call peut donc avoir
zéro, un ou deux enregistrements — et c'est cette dernière possibilité qui
structure tout le reste.

| Situation | Enregistrements | Ce que voit chacun |
|---|---|---|
| Personne n'a Fathom | 0 | Pas de replay, section masquée |
| Un seul des deux a Fathom | 1 | Les **deux** le voient, via ce compte-là |
| Les deux ont Fathom | 2 | Chacun voit **le sien** |

Les calls de vente n'ont qu'un participant (vérifié : 0/47 en ont deux), donc la
troisième ligne ne concerne en pratique que le coaching. Il n'y a pourtant
**aucun cas particulier « coaching » dans le code** : la règle générale s'y réduit
d'elle-même, et rien ne casse si cette répartition change.

---

## Où c'est stocké, et pourquoi à deux endroits

### `calls.fathom_*` — ce qui s'AFFICHE

`fathom_recording_id`, `fathom_share_url`, `fathom_summary`,
`fathom_transcript`, `fathom_action_items`.

Le **premier** enregistrement arrivé, et il n'est **jamais écrasé** ensuite. Deux
bots dans la même réunion enregistrent la même conversation : le résumé et la
transcription sont les mêmes, les dupliquer par compte n'apporterait rien et
obligerait à réécrire le chemin de lecture de cinq écrans. Ne pas écraser garantit
aussi que le texte ne change pas sous les yeux de celui qui était en train de le lire.

### `call_recordings` — OÙ ALLER CHERCHER la vidéo

Une ligne par `(call, compte qui a enregistré)`.

| Colonne | Rôle |
|---|---|
| `call_id` | Le call. Cascade à la suppression. |
| `profile_id` | Le compte dont le Fathom a enregistré. **`NULL` = inconnu**, voir plus bas. |
| `fathom_recording_id` | Unique — c'est l'idempotence des webhooks. |
| `fathom_share_url` | Le lien de partage propre à CET enregistrement. |

**`profile_id NULL` ne veut pas dire « aucun accès ».** Ça veut dire « on ne sait
pas qui a enregistré » — lignes reprises d'avant la table, ou personne extérieure
à la plateforme. Le code retombe alors sur l'ancien comportement : essayer le
jeton de chaque participant, celui du lecteur d'abord. C'est un repli, pas une
erreur.

RLS activée **sans policy** : la table n'est atteignable qu'en `service_role`. Le
contrôle « qui a le droit de voir ce replay » est écrit **une seule fois**, dans
`lib/replayAccess.ts`, et testé. Le redire en policy SQL le dupliquerait, donc
garantirait la divergence.

---

## La règle d'accès — `lib/replayAccess.ts`

Fonction pure, 16 tests. C'est le seul endroit qui décide.

1. **Autorisé ?** Le lecteur est-il participant (coach ou élève) ? Sinon on ne
   touche aucun jeton et `essais` est vide.
2. **Dans quel ordre essayer ?** Le sien d'abord, puis ceux des autres.
3. **Avec quel jeton ?** Celui du **propriétaire** de l'enregistrement, et lui
   seul — les autres comptes n'ont pas ce fichier, les essayer serait un 403
   garanti. Sauf propriétaire inconnu : on tente alors chaque participant.

Ça n'ouvre aucun accès supplémentaire : la condition d'emprunt EST la condition
« cette personne a le droit de voir ce call ». Un élève ne peut pas atteindre le
call d'un autre élève, il n'est participant d'aucun côté.

---

## Le chemin d'écriture

Trois portes d'entrée, **la même logique** dans les trois :

| Entrée | Fichier |
|---|---|
| Webhook Fathom (temps réel) | `app/api/webhooks/fathom/route.ts` |
| Cron de rattrapage (15 min) | `supabase/functions/fathom-cron-sync/index.ts` |
| Rattachement manuel | `app/api/fathom/unmatched/route.ts` |

Ordre de décision du webhook et du cron :

```
0. Même réunion déjà rattachée ?  (URL de jonction exacte, call AVEC un enregistrement)
   → c'est le SECOND bot : on ajoute une ligne call_recordings, on ne touche pas à calls
1. URL de jonction exacte, call SANS enregistrement    → rattachement normal
2. Email invité + créneau ±30 min, call SANS enreg.    → repli
3. Rien                                                 → fathom_unmatched (manuel)
```

**L'étape 0 est la nouveauté, et le piège à ne pas défaire.** Avant elle, le
second enregistrement ne trouvait rien — les étapes 1 et 2 exigent
`fathom_recording_id IS NULL` — et tombait en « non rattaché », à traiter à la
main, **sur chaque call de coaching**.

⚠️ **Ne PAS lever `fathom_recording_id IS NULL` sur l'étape 2.** Deux calls
successifs avec la même personne tombent dans la même fenêtre de 30 minutes, et
c'est précisément ce filtre qui empêche le second enregistrement de se coller au
premier call. L'URL de jonction, elle, ne désigne qu'une réunion : c'est pour ça
que l'étape 0 s'appuie sur elle et sur rien d'autre. (100 % des calls de coaching
ont une URL — 22/22 en base.)

---

## Le chemin de lecture

`app/api/calls/[id]/fathom-download/route.ts` → `POST`, renvoie un MP4 temporaire.

- **Pourquoi un MP4 et pas l'iframe Fathom** : le lecteur Fathom embarqué fait
  planter WebKit sur iOS (toute la page se recharge). Une balise `<video>` native
  n'utilise pas ce lecteur du tout.
- **Mesuré** : 10 s à la première demande, 0,4 s ensuite (Fathom garde le fichier
  ~24 h), ~3,9 Mo/minute, requêtes de plage acceptées.
- **Le lien expire ~24 h** : il ne doit JAMAIS être stocké en base.
- La route renvoie aussi `shareUrl`, celui de l'enregistrement **effectivement
  servi**. C'est ce qui fait que « Voir sur Fathom » emmène chacun sur SA page.

L'autorisation est vérifiée **avant** le 404 « aucun enregistrement » : sinon un
inconnu distinguerait « ce call n'a pas de replay » de « ce call en a un que je ne
peux pas voir ».

⚠️ Cette route n'utilise pas `requireCallAccess` : celui-ci compare
`calls.client_id` (un `clients.id`) à un id de profil, ce qui ne matche jamais et
bloquerait l'élève. Voir `docs/calls-coach-id-piege.md`.

---

## Ce qui dépend d'un réglage HORS du dépôt

Le partage entre participants repose sur un réglage du compte Fathom de celui qui
a enregistré : **Options → Default Share Link Access → « Anyone with the link can
view »**. Avec « Only people added can view », l'autre participant tombe sur un
mur de connexion.

Deux autres réglages conditionnent l'existence même du replay : **Auto-Record
Settings → « All Meetings »**, et la section **Video Conferencing** (Zoom / Google
Meet / Teams en « Fully Enabled »).

Ces trois pannes sont **silencieuses** : un call sans replay est indistinguable
d'un call qui n'a pas eu lieu, rien ne remonte chez nous. D'où la consigne
affichée dans les Réglages des deux rôles — `components/ui/FathomSetupHint.tsx`,
qui est le seul endroit où ce texte existe.

---

## Ce qu'il ne faut pas faire

- **Écraser `calls.fathom_*` avec le second enregistrement.** Le texte affiché
  changerait sous les yeux du lecteur, sans rien apporter.
- **Vérifier l'idempotence sur `calls.fathom_recording_id`.** Elle ne connaît que
  le premier enregistrement ; le second repasserait à chaque retry. C'est
  `call_recordings.fathom_recording_id` qui fait foi.
- **Lever le filtre `IS NULL` sur le repli email+créneau** (voir plus haut).
- **Écrire une policy RLS sur `call_recordings`.** La règle vit dans
  `lib/replayAccess.ts` et nulle part ailleurs.
- **Stocker l'URL de téléchargement.** Elle expire en 24 h.
