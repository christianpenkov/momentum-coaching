# Piège : `calls.coach_id` n'est PAS le coach

**À lire avant tout filtrage de la table `calls` par "propriétaire".**

Dans la table `calls`, la colonne `coach_id` ne désigne **pas** le compte coach humain (contrairement à `clients.coach_id`, cohérent partout ailleurs dans le schéma). Elle contient en réalité le **`profile_id` de l'élève** dont le lien Calendly a généré ce call — un nom hérité du sync Calendly historique, où le "propriétaire" du lien Calendly synchronisé était l'élève.

Confirmé dans `components/analytics/PageClientStats.tsx:5762` (déjà résolu correctement à cet endroit, commentaire en place) :
```ts
// Dans la table calls, coach_id = profile_id de l'élève (leadsProfileId dans le sync Calendly)
const callsOwnerId = profileId ?? user.id;
const callsQuery = supabase.from('calls').select('*')
  .eq('coach_id', callsOwnerId)
  .neq('ignored', true)
  .eq('call_type', 'calendly')
  .order('scheduled_at', { ascending: false }).limit(500);
if (onboardingFloor) callsQuery.gte('scheduled_at', onboardingFloor);
```

## Bug concret causé par ce piège (2026-08-03)

`app/api/coach/clients/[id]/sales-calls/route.ts` (fiche client, KPI "Calls bookés"/"Taux de closing"/"Cash contracté") a d'abord été écrit avec `.eq('coach_id', user.id)` (le vrai coach connecté) — résultat : quasiment aucun call retrouvé, tous les KPI à 0 ou très sous-estimés. Deux fausses pistes explorées avant de trouver la vraie cause :
1. Filtrer par `calls.client_id` — invalide, ce champ n'est renseigné que dans le cas particulier où le coach teste sur lui-même, jamais recalculé rétroactivement pour un prospect normal.
2. Filtrer par `calls.invitee_email` comparé à l'email Auth du client — fonctionnellement correct mais **inutilement compliqué** (nécessite une route service-role pour lire `auth.users`) alors que la vraie solution est un simple `.eq('coach_id', client.profile_id)`.

**Vérifié en base** (compte de test Christian, `profile_id=a02e5927-7b39-4b7d-b112-0a43b30e9f09`) : avec le bon filtre (`coach_id = profile_id élève`, `call_type='calendly'`, `ignored != true`, `status='active'`, `scheduled_at >= onboarding_completed_at`) → **8 calls bookés, 3 deals closés, 4500€ contracté**. Avec l'ancien filtre par email → 1 call, 1000€. L'écart est énorme, pas un détail.

## Bon pattern à réutiliser pour tout nouveau calcul sur `calls`

```ts
.from('calls')
.eq('coach_id', client.profile_id)   // PAS user.id, PAS client.id, PAS calls.client_id
.eq('call_type', 'calendly')          // ou 'google' pour le coaching — voir plus bas
.neq('ignored', true)                 // sinon les calls "supprimés" par le coach reviennent
```

**Note sur le coaching (`call_type='google'`)** : cette confusion ne s'applique qu'aux calls de vente (`call_type='calendly'`). Pour un call de coaching, `client_id` est déjà fiable (l'élève a nécessairement un compte au moment du booking, donc `client_id` est correctement posé dès la création) — pas besoin de ce détour par `coach_id`/`profile_id` dans ce cas.
