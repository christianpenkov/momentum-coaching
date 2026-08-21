# Rapports de call — vente et coaching

**À lire avant toute modification d'une modale de rapport.** Le parcours de vente
compte 17 étapes et 5 sorties ; cette carte n'existe nulle part ailleurs que dans
le code.

---

## 1. Deux flux, deux modales

Le type du call détermine tout :

| `call_type` | Modale | Étapes | Qui remplit |
|---|---|---|---|
| `calendly` | `components/ui/RapportModal.tsx` | 17 | le propriétaire du lien Calendly (`coach_id`) |
| `google` | `components/ui/SessionRapportModal.tsx` | 3 | le coach, sur une séance avec son élève |

Le prédicat unique est `isCoachingCall()` (`lib/sessionRapport.ts`) : `call_type === 'google'`.

⚠️ `calls.coach_id` **n'est pas le coach humain** — voir `docs/calls-coach-id-piege.md`
avant tout filtrage par « propriétaire ».

Les deux modales sont montées par un **chargeur** (`RapportModalLoader`,
`SessionRapportModalLoader`) et jamais directement : c'est lui qui résout le
brouillon avant le premier rendu.

---

## 2. Le parcours de vente

```
                    show_up  ── No-show ──────────────────────► [SOUMET : no_show]
                       │
                       ├──── Appel reporté ──► rescheduled_check
                       │                            │
                       │              ┌─────────────┴──────────────┐
                       │        (créneau trouvé)            (rien trouvé)
                       │              ▼                            ▼
                       │      rescheduled_found            rescheduled_how
                       │              │                    │      │      │
                       │              │            Calendly │ manuel│ inconnu
                       │              │                    │      ▼      │
                       │              │                    │  *_manual_  │
                       │              │                    │    date     │
                       │              └────────────────────┴──────┴──────┘
                       │                             ▼
                       │                    [SOUMET : rescheduled] ──► rescheduled_done
                       │
              Oui, présent
                       ▼
                   qualified  (oui / non)
                       ▼
                    closed
          ┌────────────┼────────────────────┐
     lead closé    2ème call          à recontacter
          ▼            ▼                    │
       revenue   second_call_check          │
          │              │                  │
          │   ┌──────────┴─────────┐        │
          │  found              how ──manuel──► *_manual_date
          │   └──────────┬─────────┘        │
          └──────────────┴──────────────────┘
                         ▼
                     comment   ◄── point de convergence
                         │
                  [SOUMET tout d'un bloc]
                         │
          ┌──────────────┴───────────────┐
   outcome closed                    autres
   (saisie initiale)                     │
          ▼                              ▼
      payment ──► createDeal ──► celebration / second_call_done / fermeture
```

**Les 5 outcomes possibles** : `no_show`, `closed`, `rescheduled`, `second_call`,
`to_recontact`.

**Le parcours de coaching** est linéaire : `attended` → (présent) `topic_notes` →
`done`. Un no-show soumet directement depuis la première étape.

---

## 3. La frontière brouillon / rapport soumis

C'est la règle la plus importante du chantier.

| | Où | Compté dans les stats |
|---|---|---|
| **Brouillon** | table `call_rapport_drafts` | **jamais** |
| **Rapport soumis** | colonnes de `calls`, `deals`, `session_reports` | oui |

Le marqueur « rapport rempli », unique dans toute l'app (`lib/sessionRapport.ts`) :

```ts
const reportFilled = call.outcome != null || call.session_completed === true || call.session_no_show === true;
```

Un call qui a un brouillon reste « rapport à remplir » : la carte s'affiche
normalement, seul le libellé du bouton change (« Reprendre » au lieu de
« Remplir »).

**Rien n'est écrit dans `calls` avant la soumission finale.** Avant ce chantier,
une étape intermédiaire posait `qualified` sur des rapports jamais terminés — et
cette colonne alimente le KPI « % Qualifié » de `PageClientStats`. C'est
structurellement impossible aujourd'hui : `buildRapportPatch` place toujours
`qualified` dans le même patch que `outcome`.

---

## 4. Ajouter une question au rapport de vente

Quatre endroits, dans cet ordre :

1. **`lib/rapportPatch.ts`** — ajouter le champ à `RapportAnswers` et à
   `EMPTY_ANSWERS`, puis le faire figurer dans le patch du ou des outcomes
   concernés.
2. **`lib/rapportPatch.test.ts`** — un test qui vérifie que le champ part bien, et
   seulement quand il doit partir.
3. **`components/ui/RapportModal.tsx`** — ajouter l'étape au type `RapportStep`,
   puis un `<RapportChoiceStep>` avec sa `value` (sans quoi le retour arrière ne
   montrera pas la réponse déjà donnée).
4. **La route** `app/api/calls/[id]/rapport/route.ts` — la liste blanche est
   **stricte** : un champ non déclaré est ignoré en silence.

**Rien d'autre à toucher.** Ni la base (le payload du brouillon est libre, non
contraint), ni la route de brouillon (elle relaie sans interpréter).

Pour le rapport de coaching, l'équivalent est `SessionAnswers` dans
`SessionRapportModal.tsx` et la route `session-rapport`.

---

## 5. Ce qu'il ne faut pas faire

**N'écrivez jamais en base hors de `submitRapport`.** C'est la dispersion — onze
fonctions écrivaient au fil de l'eau — qui a produit le bug d'origine. Une
écriture ajoutée ailleurs le réintroduit.

**Ne faites pas dépendre la `key` du chargeur de `updated_at`.** Le brouillon est
chargé **une seule fois**, au montage. Si la clé change à chaque sauvegarde, la
modale se remonte à chaque frappe et perd la saisie en cours.

**N'ajoutez pas de garde « déjà demandé » persistant dans un chargeur.** En
développement React monte deux fois (StrictMode) : un `ref` qui survit au
démontage bloque la requête du second montage, et l'écran reste sur
« Chargement… » indéfiniment. Le garde `alive` suffit.

**Ne rendez pas l'upsert `pipeline_overrides` bloquant.** Il est en
fire-and-forget dans `rapport/route.ts` : le rendre bloquant ferait échouer des
rapports valides sur une erreur de pipeline.

**Utilisez `goTo` et non `setStep`** pour avancer. `setStep` court-circuite la pile
d'historique, et le bouton Retour de l'étape suivante devient mort.

**N'écrivez pas de brouillon vide.** Ouvrir puis refermer une modale sans rien
saisir ne doit rien créer, sinon la carte annonce « Commencé · étape 1/… » pour un
rapport où l'on n'a rien fait.

---

## 6. La purge

`purge_call_rapport_drafts()`, cron quotidien à 3h45, supprime les brouillons
inactifs depuis **30 jours**.

Ce n'est pas une question de place — un brouillon pèse quelques centaines
d'octets. C'est une question de fiabilité : passé un mois, on ne se souvient plus
de ce qu'on avait répondu, et reprendre des réponses qu'on ne reconnaît pas est
plus risqué que repartir de zéro, parce qu'on validerait un rapport sans savoir ce
qu'il contient.

⚠️ **Elle supprime LE BROUILLON, jamais le rapport à remplir.** Ce statut vient de
`calls.outcome IS NULL`, pas de l'existence d'une ligne dans
`call_rapport_drafts`. Après purge, la carte reste affichée et son bouton repasse
de « Reprendre » à « Remplir ».

Un repère intermédiaire existe : à partir de **2 jours** (`lib/draftAge.ts`), la
pastille affiche « il y a N jours » — on avertit avant d'effacer.

---

## 7. L'échec est silencieux, par conception

`lib/useRapportDraft.ts` avale toutes ses erreurs : une sauvegarde de brouillon ne
bloque rien, n'affiche rien, ne fait jamais échouer une action de l'utilisateur.
C'est l'inverse exact de `patchRapport`, qui **doit** lever — un `outcome` non
persisté qui célèbre un deal est un bug grave.

**Conséquence à connaître** : si la route casse en production (variable d'env
manquante, migration non appliquée), personne ne s'en aperçoit. L'app se comporte
exactement comme avant ce chantier, les brouillons ne sont juste jamais gardés.

D'où deux garde-fous :
- un `console.warn('[rapport-draft] …')` sur chaque échec ;
- **une vérification manuelle après chaque déploiement** : ouvrir un rapport,
  saisir, fermer, rouvrir. Trente secondes, et c'est la seule chose qui prouve que
  la fonctionnalité marche.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/rapportPatch.ts` | **Seul** endroit qui décide de ce qui part en base (fonction pure) |
| `lib/rapportPatch.test.ts` | 15 tests, les 5 chemins terminaux — `npm test` |
| `lib/useRapportDraft.ts` | Chargement et sauvegarde du brouillon, best-effort |
| `lib/usePendingDrafts.ts` | Listing pour les cartes, une requête pour toute la liste |
| `lib/draftAge.ts` | Seuil et libellé de l'ancienneté |
| `components/ui/RapportModal.tsx` | Parcours de vente (17 étapes) |
| `components/ui/SessionRapportModal.tsx` | Parcours de coaching (3 étapes) |
| `components/ui/RapportChoiceStep.tsx` | Une question à choix, avec l'état sélectionné |
| `components/ui/PendingRapportCard.tsx` | Carrousel « rapports en attente », 3 écrans |
| `app/api/calls/[id]/rapport/route.ts` | Écriture du rapport (liste blanche stricte) |
| `app/api/calls/[id]/rapport-draft/route.ts` | Brouillon : GET / PUT / DELETE |
| `lib/callAccess.ts` | Contrôle d'appartenance, définition **unique** |
| `supabase/migrations/20260820190000_call_rapport_drafts.sql` | Table, RLS, purge |
