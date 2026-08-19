# `integrations_ready_at` vs `onboarding_completed_at` — ne pas confondre

**À lire avant tout filtrage "depuis quand cet élève génère des calls/leads réels".**

Deux champs sur `clients` qui se ressemblent dans leur nom mais répondent à des questions totalement différentes.

## `onboarding_completed_at`

Posé une seule fois, au moment où l'élève **choisit son mot de passe** lors de sa toute première connexion (`app/invite/callback/page.tsx:133`). Ne dit rien sur ses intégrations — un élève peut avoir ce champ posé depuis des semaines sans avoir connecté quoi que ce soit.

À utiliser uniquement pour des besoins liés au **compte** (badge de statut "compte créé", calcul de la semaine de programme via `getClientWeek`) — jamais comme filtre de date pour des calls ou des leads.

## `integrations_ready_at`

Posé automatiquement par un **trigger Postgres** (`recalc_integrations_ready_at`, migration `20260817000000_add_integrations_ready_at_gate.sql`) dès que les 7 intégrations obligatoires (Instagram, Calendly, YouTube, Stripe, Short.io, Google, Fathom) sont toutes connectées pour la **première fois**. Une fois posé, **ne redescend jamais** — une déconnexion ultérieure d'une intégration ne le réinitialise pas (voir mécanisme B ci-dessous).

C'est la référence unique à utiliser pour "depuis quand le pipeline Momentum de cet élève est-il opérationnel" — remplace `first_connected_at` (Calendly) et `connected_at` (Instagram/YouTube) qui étaient utilisés séparément avant ce chantier, avec des résultats divergents selon l'écran.

### Pourquoi ce champ existe (bug concret)

Avant ce chantier, chaque écran utilisait sa propre référence :
- Les calls étaient filtrés sur `integrations.first_connected_at` (Calendly).
- Les leads sur l'accueil élève étaient filtrés sur cette même date Calendly.
- Les leads sur "Mes stats" étaient filtrés sur la connexion Instagram/YouTube (différente).

Résultat observé en prod (compte de test Christian, `profile_id=a02e5927-...`) : un lead détecté sur Instagram le 9 juin, **avant** que Calendly soit connecté le 15 juin, disparaissait de l'accueil (filtré sur Calendly) mais restait visible sur "Mes stats" (filtré sur Instagram). Deux écrans, deux chiffres différents pour la même question.

## Gate d'onboarding — deux mécanismes distincts

`integrations_ready_at` sert aussi de base au gate d'accès (bloque les pages dépendantes des intégrations tant qu'il n'est jamais posé). Deux mécanismes séparés, ne pas les confondre :

- **Mécanisme A (gate initial)** — un élève qui n'a *jamais* eu ses 7 intégrations connectées voit un écran de blocage complet sur les pages dépendantes (accueil, stats, pipeline, calls, calendrier). Rien à perdre puisqu'il n'a jamais eu accès.
- **Mécanisme B (reconnexion ponctuelle)** — un élève déjà débloqué (`integrations_ready_at` posé) dont une intégration tombe plus tard (token expiré, déconnexion) voit un bandeau d'alerte + bouton "Se reconnecter" sur la page concernée, sans jamais masquer ses données déjà affichées. `integrations_ready_at` reste figé, il ne redevient pas bloqué comme un nouvel élève.

Le système de waiver par intégration (`clients.integrations_waived`, une carte de checkboxes permettant au coach d'exempter un élève d'une intégration) a été **supprimé** dans ce même chantier : les 7 intégrations sont obligatoires sans exception pour tout élève.

## Backfill des élèves déjà en base (non rétroactif)

Le gate ne s'applique qu'aux élèves invités après le déploiement de cette migration. Les élèves déjà en base ont été backfillés — mais **pas** avec la date de déploiement elle-même (ça aurait fait disparaître tout leur historique de leads/calls antérieurs). Backfill utilisé : la date de la donnée métier la plus ancienne connue pour chaque élève (premier lead Instagram détecté, ou premier call Calendly réservé) — jamais une date de connexion d'intégration, qui peut être artificielle sur un vieux compte de test avec un historique étalé/rejoué sur plusieurs mois.

## Bon pattern à réutiliser pour tout nouveau calcul de calls/leads "depuis connexion"

```ts
const { data: clientRow } = await supabase.from('clients')
  .select('integrations_ready_at').eq('profile_id', profileId).maybeSingle();
const integrationsReadyAt: string | null = clientRow?.integrations_ready_at ?? null;

// Calls : filtrer sur booked_at (date de réservation réelle), fallback scheduled_at
if (integrationsReadyAt) {
  query = query.or(`booked_at.gte.${integrationsReadyAt},and(booked_at.is.null,scheduled_at.gte.${integrationsReadyAt})`);
}
```

Ne jamais filtrer sur `integrations.connected_at` (réécrit à chaque reconnexion) ni sur une intégration spécifique (`first_connected_at` Calendly, `connected_at` Instagram) — ces deux approches ont chacune causé un écart de comptage entre écrans, corrigé dans ce chantier.

## Leads toutes sources : `fetchAllLeadsCount`

Le calcul du nombre de leads (`lib/salesCallStats.ts`) a la même exigence de cohérence. Trois écrans (accueil élève, fiche coach, "Mes stats") doivent afficher le même total pour le même élève — voir `docs/pipeline-leads-ig-sources.md` pour le détail des sources cumulées (Instagram + calls YouTube bookés).

`fetchIgLeadsCount` reste Instagram seul (nom honnête). `fetchAllLeadsCount` l'enveloppe et ajoute les calls YouTube bookés — c'est cette dernière qu'il faut appeler pour tout total "Leads" affiché à l'utilisateur, dans les écrans qui n'ont pas besoin d'une fenêtre calendaire navigable (semaine/mois glissant). "Mes stats" garde son propre calcul local car il gère aussi ce mode période (dédup dans une fenêtre bornée des deux côtés, badge "nouveaux" contextuel) — non couvert par `fetchAllLeadsCount`, qui ne gère qu'un simple seuil "depuis telle date". Les deux implémentations partagent la même logique métier (dédup par username sur la date la plus ancienne connue, filtre `booked_at`/fallback, inclusion YouTube) — si l'une évolue, vérifier que l'autre suit.

> **Cet avertissement a lâché.** Le 2026-08-19, les deux implémentations avaient
> divergé sur quatre points à la fois (date de démarrage, date de référence, dédup par
> personne, traitement des annulés), produisant 18 leads d'un côté et 17 de l'autre.
> Les cinq règles de périmètre qui doivent rester communes sont désormais écrites une
> seule fois dans **`docs/perimetre-stats-referentiel.md`** — à lire avant de toucher à
> un compteur de leads, de calls ou de revenus.
