-- Fuseau horaire IANA de l'utilisateur (ex: 'Europe/Paris', 'Asia/Dubai').
-- Remplace la règle produit "tout le monde voit l'heure de Paris" (2026-07-25),
-- abandonnée le 2026-08-18 au profit du comportement standard du marché
-- (Google Calendar) : chacun voit les heures dans SON fuseau, passé compris.
--
-- Rôle exact de cette colonne : elle sert UNIQUEMENT aux notifications envoyées
-- par le serveur (rappels push, invitations, réponses), qui n'ont aucun moyen de
-- connaître le fuseau du navigateur au moment de l'envoi. À l'écran, c'est
-- TOUJOURS Intl.DateTimeFormat().resolvedOptions().timeZone du navigateur qui
-- fait autorité — cette colonne n'est jamais lue pour afficher à quelqu'un sa
-- propre heure. Elle est en revanche lue pour afficher le fuseau de l'élève à
-- côté de sa proposition de créneau.
--
-- Écriture : lib/UserContext.tsx, au montage et à chaque retour au premier plan,
-- uniquement si la valeur détectée diffère de celle déjà en base (sans ce garde,
-- chaque bascule d'onglet sur mobile déclencherait un UPDATE).
--
-- Pas de contrainte CHECK sur la valeur : la base IANA évolue (nouveaux fuseaux,
-- renommages) et un CHECK figé rejetterait un jour une valeur légitime envoyée
-- par un navigateur à jour. La valeur vient du navigateur, jamais d'une saisie
-- manuelle, et tout le code de lecture se replie sur Europe/Paris si elle est
-- absente ou invalide (isValidTimeZone, lib/timezone.ts).

alter table profiles add column if not exists timezone text;

-- Backfill : tous les comptes existants ont été créés sous la règle "tout en heure
-- de Paris" et sont en pratique en France. Les initialiser à Europe/Paris garantit
-- qu'une notification envoyée AVANT que l'utilisateur ait rouvert l'app (donc avant
-- la première détection navigateur) reste identique à aujourd'hui — aucun
-- changement de comportement visible tant que rien n'a été détecté.
update profiles set timezone = 'Europe/Paris' where timezone is null;

comment on column profiles.timezone is 'Fuseau IANA du dernier appareil vu (ex: Europe/Paris, Asia/Dubai). Sert aux notifications SERVEUR uniquement — à l''écran le navigateur fait autorité. Écrit par lib/UserContext.tsx quand la détection diffère. Backfill initial : Europe/Paris pour tous les comptes antérieurs au 2026-08-19.';

-- Note RLS : aucune nouvelle policy nécessaire. Les policies de `profiles` sont
-- créées hors de ce dossier (le schéma initial n'est pas versionné ici), mais une
-- policy UPDATE pour le propriétaire de la ligne existe forcément — attestée par
-- PageClientSettings.tsx qui écrit déjà avatar_url et full_name via le client de
-- session, sans service role. Une colonne ajoutée hérite de cette policy, les
-- policies portant sur la ligne et non sur la colonne. Même raisonnement que
-- 20260803000000_add_onboarding_wizard_progress.sql.
--
-- Ce raisonnement reste à confirmer par un test réel : un GRANT UPDATE restreint
-- à une liste de colonnes ferait échouer l'écriture SILENCIEUSEMENT côté client
-- Supabase (erreur retournée, pas levée). Vérification prévue à l'étape 3.
