# Les e-mails d'authentification — gabarits versionnés

**Pourquoi ces fichiers existent.** Les gabarits d'e-mail d'auth vivent dans le **tableau
de bord Supabase**, c'est-à-dire hors du dépôt : personne ne les relit, rien ne dit
qu'ils ont changé, et une modification ne laisse aucune trace. C'est le même angle mort
que les jobs cron-job.org (`AGENTS.md`) ou la configuration Stripe
(`docs/stripe-paiements.md`) — et sur ce projet, il a déjà coûté cher.

Ces fichiers sont donc la **source de vérité**. Le tableau de bord en est une copie.

⚠️ **Modifier un gabarit dans le tableau de bord sans reporter ici crée une divergence
qu'aucune alerte ne verra.** Modifier ici d'abord, coller ensuite.

## Où coller quoi

Tableau de bord → **Authentication → Emails → Templates**

| Fichier | Gabarit Supabase |
|---|---|
| `01-confirm-sign-up.html` | Confirm sign up |
| `02-magic-link.html` | Magic link or OTP |
| `03-change-email.html` | Change email address |
| `04-reset-password.html` | Reset password |
| `05-reauthentication.html` | Reauthentication |
| *(absent)* | **Invite user** — déjà au design Momentum, **ne pas y toucher** |

## La charte n'est pas inventée

Toutes les couleurs viennent de `DESIGN.md`, à la racine du dépôt :

| | |
|---|---|
| Fond | `#fbfbf7` (crème) |
| Carte | `#ffffff`, bordure `#eeeae0` |
| Encre | `#1a1815` |
| Texte secondaire | `#797569` |
| En-tête / accent | `#3a6a86` (bleu ardoise) |
| Encart | `#f7f4ec` |

Et l'intention, citée du même fichier : *« Momentum ressemble à un cabinet de conseil
premium et discret, jamais à une app grand public ludique. La couleur est un outil de
hiérarchie, pas une décoration. »* D'où l'ardoise réservée au seul bandeau, et le bouton
en encre plutôt qu'en couleur.

## Contraintes techniques respectées

- **Styles en ligne uniquement.** Gmail supprime les blocs `<style>`, Outlook ignore la
  moitié du CSS moderne. Aucune classe, aucune feuille externe.
- **Tables, pas de `flex` ni de `grid`.** Outlook rend le HTML avec le moteur de Word.
- **Aucune image distante.** Le logo est un glyphe sur fond blanc arrondi : pas de
  chargement à autoriser, pas de lien mort le jour où un fichier bouge, et le rendu est
  identique images bloquées — ce qui est le cas par défaut chez beaucoup de clients.
- **Entités HTML pour les accents** (`&eacute;`, `&agrave;`…) : certains clients
  affichent encore mal l'UTF-8 dans un corps collé à la main.

## Les variables Supabase utilisées

| Variable | Où |
|---|---|
| `{{ .ConfirmationURL }}` | 01, 02, 03, 04 |
| `{{ .Token }}` (code à 6 chiffres) | 02, 05 |
| `{{ .NewEmail }}` | 03 |

⚠️ **Après avoir collé, envoyer un e-mail de test pour chacun.** Une variable mal
orthographiée ne provoque aucune erreur : elle s'affiche telle quelle dans le message
reçu, et le lien de connexion est simplement absent.

---

# Le chemin d'envoi — et ce qui change le jour de la livraison

Il y a **deux chaînes d'e-mail** dans la plateforme, et elles ne se configurent pas au
même endroit :

| | Ce qu'elle envoie | Où se règle l'expéditeur |
|---|---|---|
| **Resend, via l'application** | les 3 alertes de santé | variables Vercel |
| **SMTP Supabase** | invitation, confirmation, mot de passe oublié… | tableau de bord Supabase |

## ⚠️ La clé Resend vit à DEUX endroits

C'est le piège de cette configuration, et c'est exactement la leçon du `CRON_SECRET` à
sept endroits : **en changer une sans l'autre casse la moitié des e-mails, en silence.**

```
RESEND_API_KEY                       → variable Vercel      (alertes)
Authentication → Emails → SMTP → Password → la MÊME clé Resend (e-mails d'auth)
```

## Le réglage SMTP à poser dans Supabase

**Authentication → Emails → SMTP Settings → Enable custom SMTP**

```
Host                    smtp.resend.com
Port                    465
Username                resend
Password                <la clé API Resend>
Sender email address    noreply@<domaine vérifié dans Resend>
Sender name             Momentum
```

⚠️ **Ne pas utiliser Gmail comme SMTP.** Supabase l'avertit lui-même (« designed for
sending personal rather than transactional email »), et ce n'est pas cosmétique : Gmail
plafonne à quelques centaines d'envois par jour, bien moins en relais. **À 40 élèves
invités, l'invitation cesse simplement d'arriver** — sans erreur visible.

⚠️ **Penser à Rate Limits** (même menu) : la limite d'envoi par défaut de Supabase est
très basse. Une session d'invitation de dix élèves d'affilée se ferait étrangler.
À relever une fois le SMTP personnalisé en place.

⚠️ **Vérifier URL Configuration** : le *Site URL* construit les liens **à l'intérieur**
de ces e-mails. S'il est faux, les invitations pointent dans le vide — et le gabarit,
lui, aura l'air parfait.

## Ce qui change à la livraison, et ce qui ne change PAS

| | Aujourd'hui | Le jour J |
|---|---|---|
| `RESEND_API_KEY` (Vercel) | clé de Chris | **clé du repreneur** |
| Mot de passe SMTP (Supabase) | clé de Chris | **la même clé du repreneur** |
| `ALERTES_EMAIL_EXPEDITEUR` | `noreply@ubizenai.com` | `noreply@<son domaine>` |
| `ALERTES_EMAIL_EXPLOITATION` | Chris | **le repreneur** — c'est lui qui doit relancer son élève |
| **`ALERTES_EMAIL_TECHNIQUE`** | Chris | 🔒 **reste Chris, définitivement** |

> 🔒 **`ALERTES_EMAIL_TECHNIQUE` n'est pas un oubli.** Elle porte les alertes qu'un
> développeur est seul à pouvoir traiter — un cron qui s'est tu, une fonction en ligne
> qui n'est pas celle du dépôt, une migration divergente, une relation lisible sans RLS.
> Les basculer sur le repreneur « par symétrie » les enverrait à quelqu'un qui ne peut
> rien en faire, et personne ne le remarquerait. **Décision prise le 2026-09-12, à ne
> pas rouvrir sans motif.**

## L'ordre des opérations

Le seul élément qui **attend**, c'est la vérification DNS du domaine chez Resend. Tout le
reste est instantané.

1. Le repreneur crée son **compte Resend** (gratuit) et ajoute **son domaine** → lance la
   vérification DNS **en premier**, c'est ce qui prend du temps.
2. Pendant la propagation : tout le reste du rendez-vous.
3. Domaine vérifié → poser la clé **aux deux endroits** (Vercel + SMTP Supabase), puis
   `ALERTES_EMAIL_EXPEDITEUR` et `ALERTES_EMAIL_EXPLOITATION`.
4. **Redéployer** — une variable modifiée n'atteint pas un déploiement déjà en ligne.
5. Tester : une invitation réelle, et un « mot de passe oublié » réel.

⚠️ **Aucune de ces étapes n'a besoin de précéder le transfert Supabase ou Vercel.** Les
deux clés voyagent avec leurs projets respectifs : `RESEND_API_KEY` est une variable
Vercel, le mot de passe SMTP fait partie de la configuration du projet Supabase. L'ordre
entre « basculer les e-mails » et « transférer les projets » est donc libre — seule la
vérification DNS impose un délai, et elle ne dépend ni de l'un ni de l'autre.
