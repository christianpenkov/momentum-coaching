# Commits mixtes — à savoir avant de fouiller l'historique

Ce fichier recense les commits qui contiennent **plusieurs chantiers à la fois**, pour
éviter qu'une recherche du type « d'où vient cette modification ? » ne mène à une
fausse piste.

---

## `431adcc` — « Reintegre LeverCard (stat + formule de calcul) » (2026-08-18)

Le message ne parle que du chantier **audit des stats**, mais le commit contient deux
chantiers indépendants qui tournaient en parallèle ce jour-là.

| Fichier | Chantier réel |
|---|---|
| `components/analytics/PageClientStats.tsx` | **Audit stats** — réintégration du composant `LeverCard` |
| `app/globals.css` | **Cartes d'appel** — CSS mobile : avatars, hauteur des boutons, affichage de l'heure |
| `components/ui/CallCard.tsx` | **Cartes d'appel** |
| `lib/SupabaseClientsContext.tsx` | **Cartes d'appel** |

**Cause** : un `git add` trop large côté audit stats a happé des fichiers en cours
d'édition appartenant au chantier cartes d'appel.

**Conséquences** : aucune sur le code. Rien n'a été perdu ni écrasé, les deux contenus
sont intacts et le build passe. Le défaut est uniquement d'attribution dans
l'historique.

**Pourquoi l'historique n'a pas été réécrit** : un autre commit (`c598a3c`) avait déjà
été poussé par-dessus. Séparer proprement aurait imposé un force-push sur `main`
par-dessus du travail plus récent — risque réel de perte si une autre session ou une
autre machine travaille sur le dépôt, pour un problème purement cosmétique.

**Si tu cherches l'origine des modifications `CallCard.tsx` / `globals.css` de ce
commit** : elles appartiennent au chantier cartes d'appel, pas à l'audit des stats.

Une note git est également attachée au commit (`git log --notes` pour la voir).

---

## Comment éviter ça

Quand deux chantiers tournent en parallèle sur le même dépôt, toujours ajouter les
fichiers **un par un et nommément** (`git add chemin/fichier.ts`), jamais `git add -A`
ni `git add .`, et relire `git status` avant de commiter.
