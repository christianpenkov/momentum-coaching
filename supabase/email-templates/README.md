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
| `00-invite-user.html` | Invite user — **une seule ligne change**, voir ci-dessous |

Les cinq nouveaux sont calqués **au pixel** sur le gabarit d'invitation qui existait
déjà : carte 480 px, rayon 20 px, bandeau ardoise 36/40, pastille blanche 72×72 rayon
18, titre 22 px `-0.2px`, corps 14 px, bouton **ardoise** (et non encre) rayon 12,
mentions 12 px `#a3a39e`, pied « MOMENTUM COACHING » 11 px.

### ⚠️ La seule modification apportée à « Invite user » : l'URL du logo

Le gabarit d'origine pointait le logo en **dur** :

```html
<img src="https://momentum-plateforme.vercel.app/logo-momentum.png" …>
```

C'est une **adresse de plus où vit l'origine de la plateforme**, et la pire de toutes :
elle est dans le tableau de bord, donc **aucun `grep` du dépôt ne peut la voir**. Le jour
où le projet Vercel est renommé ou passe sur son domaine définitif, le logo disparaît de
**tous** les e-mails d'invitation — et seul le destinataire s'en aperçoit.

Remplacée par la variable universelle :

```html
<img src="{{ .SiteURL }}/logo-momentum.png" …>
```

`{{ .SiteURL }}` est disponible dans **tous** les gabarits (vérifié dans la documentation
Supabase le 2026-09-12) et suit la configuration du projet. Une adresse à tenir au lieu
de six.

⚠️ **Corollaire : le logo dépend désormais de « URL Configuration → Site URL ».** S'il est
faux — une adresse de développement oubliée, par exemple — le logo casse dans les six
e-mails d'un coup. **À vérifier avant de coller**, et c'est de toute façon à vérifier :
c'est ce même réglage qui construit les liens de connexion à l'intérieur des messages.

*Vérifié le 2026-09-12 : `public/logo-momentum.png` existe dans le dépôt et répond en
HTTP 200 (52 ko, `image/png`).*

## ⚠️ Trois de ces six e-mails ne partent JAMAIS

Mesuré dans le code le 2026-09-12. À savoir avant de passer du temps à en peaufiner un
que personne ne recevra.

| Gabarit | Part ? | Déclenché par |
|---|---|---|
| **00 Invite user** | ✅ | `inviteUserByEmail` — le coach invite un élève |
| **01 Confirm sign up** | ✅ | `signUp` sur `/signup` |
| **04 Reset password** | ✅ | `resetPasswordForEmail` sur `/login` |
| 02 Magic link | ❌ | `signInWithOtp` n'est appelé nulle part |
| 03 Change email | ❌ | `updateUser` n'est jamais appelé avec un e-mail, seulement un mot de passe |
| 05 Reauthentication | ❌ | jamais déclenchée |

Les trois dormants restent en place **exprès** : Supabase exige qu'un gabarit existe, et
le jour où l'un de ces parcours est ouvert, l'e-mail sera déjà à la marque plutôt qu'au
gabarit par défaut. Mais **ne pas les traiter comme du travail prioritaire**.

### Le code à 6 chiffres a été RETIRÉ du lien magique

`{{ .Token }}` est un code à usage unique, alternative au clic sur le lien. Il ne
fonctionne que si l'application expose un champ pour le saisir, via `verifyOtp`.

**Mesuré : aucun appel à `verifyOtp`, aucun champ de saisie de code dans toute
l'application.** Le code était donc inutilisable — et l'afficher était pire que de
l'omettre : le destinataire cherche un champ qui n'existe pas, et conclut que la
plateforme est cassée.

⚠️ **Il reste dans `05-reauthentication.html`**, parce que ce parcours-là n'a **que** le
code comme mécanisme (Supabase n'y envoie aucun lien). Comme il n'est jamais déclenché,
c'est sans conséquence — mais si la réauthentification est activée un jour, **il faudra
d'abord construire l'écran de saisie**, sinon l'e-mail promettra une action impossible.

**La règle générale :** ne jamais afficher dans un e-mail une action que l'application ne
sait pas honorer. Une instruction sans destination se lit comme une panne.

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
hiérarchie, pas une décoration. »*

⚠️ **Le bouton est en ardoise `#3a6a86`, pas en encre.** C'est le choix du gabarit
d'invitation d'origine, et les cinq autres s'y alignent — la cohérence entre les six
e-mails prime sur une lecture personnelle de la charte.

## Contraintes techniques respectées

- **Styles en ligne uniquement.** Gmail supprime les blocs `<style>`, Outlook ignore la
  moitié du CSS moderne. Aucune classe, aucune feuille externe.
- **Tables, pas de `flex` ni de `grid`.** Outlook rend le HTML avec le moteur de Word.
- **Une seule image distante : le logo**, avec `width`, `height` et `alt` renseignés.
  ⚠️ Beaucoup de clients bloquent les images par défaut : le destinataire voit alors un
  cadre blanc de 72 px portant le mot « Momentum ». C'est acceptable parce que la carte
  reste lisible sans lui — **aucune information ne dépend de l'image**.
- **Entités HTML pour les accents** (`&eacute;`, `&agrave;`…) : certains clients
  affichent encore mal l'UTF-8 dans un corps collé à la main.

## Les variables Supabase utilisées

| Variable | Où |
|---|---|
| `{{ .SiteURL }}` | **les six** — l'URL du logo |
| `{{ .ConfirmationURL }}` | 00, 01, 02, 03, 04 |
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
