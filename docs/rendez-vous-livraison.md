# Le rendez-vous de livraison — qui fait quoi, et quand

**À garder ouvert pendant le rendez-vous.** Ce document dit *qui* et *quand*. Le *comment*
détaillé, avec les vérifications, est dans `docs/transfert-de-compte.md` §12 — ce document
y renvoie au lieu de le recopier, pour que les deux ne divergent jamais.

## Le montage retenu (décision du 2026-09-13)

**Le repreneur confie ses identifiants ; Chris gère tout ensuite, seul.** Le rendez-vous
se réduit donc à **collecter des accès et les éprouver**. Tout le reste se fait après.

Ce montage tient à **trois conditions**, et chacune fait échouer le reste si on l'oublie :

> 🔑 **1. Se connecter à chaque service PENDANT le rendez-vous, sur le poste de Chris.**
> GitHub, Vercel, Supabase et Resend envoient un code de vérification à la première
> connexion depuis un nouvel appareil — sur le téléphone ou la boîte mail du repreneur.
> Une première connexion faite *après* le rendez-vous bloque tout jusqu'à ce qu'il soit
> joignable. Connecté une fois devant lui, le poste devient un appareil de confiance.
>
> 🔑 **2. Ses identifiants dans le NAVIGATEUR, jamais dans le terminal.**
> `vercel login` ou `supabase login` avec son compte font basculer **tous les autres
> projets de la machine** sur son compte : la session des outils en ligne de commande est
> globale, pas liée au dossier (prouvé le 2026-09-04, §6). Pour agir en ligne de commande,
> on passe par un **jeton** rangé dans ce dossier.
>
> 🔑 **3. Supabase exige une INVITATION, même avec son mot de passe.**
> Le transfert d'un projet Supabase demande qu'**un même compte** soit propriétaire du
> projet d'origine *et* membre de l'organisation cible. Chris est propriétaire : c'est donc
> **le compte de Chris** qui doit être membre de l'organisation du repreneur. Son mot de
> passe à lui ne permet pas, à lui seul, de déclencher le transfert.

---

## 🤝 PENDANT — chaque étape, et ce qu'il faut AVOIR avant de passer à la suivante

L'ordre suit la durée de validation : **ce qui met du temps à se vérifier passe en premier**,
pour tourner pendant le reste.

### Étape 1 — Resend

*En premier : la vérification DNS peut prendre jusqu'à 72 h.*

1. Il crée son compte sur `resend.com`.
2. **Domains → Add Domain** → `notifications.<son-domaine>` — **un sous-domaine, jamais
   la racine**.
3. Région **`eu-west-1`**.
4. Il se connecte chez l'**hébergeur de son nom de domaine** et colle **tels quels** les
   enregistrements DNS que Resend affiche.

> 🪤 **Pourquoi jamais la racine.** Si son domaine porte déjà une boîte mail (Google
> Workspace, Outlook…), Resend sur la racine fait entrer les MX en conflit : **toute sa
> messagerie basculerait, et il ne recevrait plus ses propres e-mails.**

**✅ À AVOIR avant de passer à la suite :**

- [ ] identifiant + mot de passe **Resend**
- [ ] **connecté avec succès sur ton poste** (code de vérification passé)
- [ ] le domaine apparaît dans Resend, statut « Pending » — c'est normal, ça se vérifie tout seul
- [ ] identifiant + mot de passe de **l'hébergeur de son nom de domaine** — ⚠️ indispensable :
  si la vérification échoue dans deux jours, il faudra corriger un enregistrement, et sans
  cet accès tu seras bloqué
- [ ] **connecté avec succès** chez cet hébergeur

### Étape 2 — Son adresse e-mail

**✅ À AVOIR :**

- [ ] son adresse e-mail réelle

### Étape 3 — GitHub

1. Il crée son compte (s'il n'en a pas).
2. **Tu te connectes toi-même** avec ses identifiants, sur ton poste, dans le navigateur.

**✅ À AVOIR :**

- [ ] identifiant + mot de passe **GitHub**
- [ ] son **nom d'utilisateur** GitHub (tu en auras besoin pour le transfert)
- [ ] **connecté avec succès sur ton poste** — ⚠️ GitHub impose presque toujours la double
  authentification : c'est l'étape la plus susceptible de bloquer plus tard

### Étape 4 — Supabase

1. Il crée son compte, puis une **organisation** (plan **Free** suffit).
2. **Organization Settings → Team → Invite** → **ton adresse**, rôle **`Administrator`**.
3. **Tu acceptes l'invitation tout de suite**, depuis ta boîte mail.

**✅ À AVOIR :**

- [ ] **dans TON compte Supabase, deux organisations** : la tienne et la sienne
- [ ] ton rôle chez lui est bien **`Administrator`** (pas `Developer` : il faut pouvoir gérer
  les secrets)
- [ ] *(en secours)* ses identifiants Supabase

### Étape 5 — Vercel

1. Il crée son compte.
2. **Tu te connectes toi-même** avec ses identifiants, sur ton poste, **dans le navigateur**.

**✅ À AVOIR :**

- [ ] identifiant + mot de passe **Vercel**
- [ ] **connecté avec succès sur ton poste** (code passé)
- [ ] ⚠️ vérifié dans **son** tableau de bord qu'**aucun projet ne s'appelle
  `momentum-plateforme`** — sinon le transfert imposerait un autre nom, et **tous les liens
  de bio de ses élèves casseraient** (§3)

### Étape 6 — Ses 7 intégrations

1. Il se connecte sur Momentum avec ses **identifiants provisoires** :
   ```
   e-mail       : quennel.provisoire@example.com
   ```
   Le verrou ouvre automatiquement l'assistant de connexion.
2. Il connecte **Instagram, YouTube, Calendly, Fathom, Short.io, Google**.
3. **Stripe en dernier** — la seule intégration dont le report coûterait cher.

**✅ À AVOIR :**

- [ ] **le verrou est levé** : il voit son tableau de bord coach, pas l'assistant

> ✅ Rien ne sera à reconnecter après le transfert : les jetons dépendent des applications
> OAuth, qui restent chez Chris (§0 ter, décisions D2 à D4).

### Étape 7 — Sa seule décision

**✅ À AVOIR :**

- [ ] **Vercel Hobby ou Pro ?** — Hobby interdit l'usage commercial ; ce n'est pas une limite
  technique, donc aucune erreur jusqu'au jour d'une suspension. Pro ≈ 20 $/mois.

### ✔️ Le rendez-vous est terminé quand tout ceci est coché

| | |
|---|---|
| Resend | compte + connexion + domaine « Pending » + accès à l'hébergeur du domaine |
| E-mail | son adresse réelle |
| GitHub | identifiants + nom d'utilisateur + connexion passée |
| Supabase | **deux organisations dans ton compte**, rôle `Administrator` |
| Vercel | identifiants + connexion passée + aucun projet homonyme |
| Intégrations | verrou levé |
| Décision | Hobby ou Pro |

---

## 🔵 APRÈS — toi seul, quand tu as le temps

Aucune de ces étapes n'a besoin de lui.

### 1. Remplacer son adresse provisoire

Supabase → **Authentication → Users** → son compte → modifier l'e-mail. *Sans risque : pour
un coach, l'adresse ne vit que dans `auth.users`.*

### 2. Basculer les e-mails — dès que Resend affiche « Verified », pas avant

Détail dans `supabase/email-templates/README.md`.

| ☐ | Où | Valeur |
|---|---|---|
| ☐ | Resend (son compte) → **API Keys → Create** | copier la clé |
| ☐ | Vercel `RESEND_API_KEY` | **sa** clé |
| ☐ | Supabase → Authentication → Emails → **SMTP → Password** | **la même** clé |
| ☐ | Vercel `ALERTES_EMAIL_EXPEDITEUR` | `Momentum <noreply@notifications.son-domaine>` |
| ☐ | Supabase → SMTP → **Sender email** | la même adresse |
| ☐ | Vercel `ALERTES_EMAIL_EXPLOITATION` | **son** adresse |
| ☐ | Vercel `ALERTES_EMAIL_TECHNIQUE` | 🔒 **ne change pas** |
| ☐ | Redéployer, puis tester une vraie invitation et un vrai « mot de passe oublié » | |

⚠️ **La clé vit à deux endroits** : en changer une sans l'autre casse la moitié des e-mails.
⚠️ **Variables Vercel : `printf`, jamais `echo`.**
✅ **Tu ne supprimes pas ton propre domaine chez Resend** — il est l'expéditeur en service
jusqu'à la bascule, et il sert tes autres projets.

### 3. Le transfert — après 24 h de collecte saine

Détail et vérifications : **§12 blocs B et C**.

**GitHub**
1. Ton dépôt → *Settings → Danger Zone → Transfer ownership* → son nom d'utilisateur.
2. Connecté à **son** compte GitHub (navigateur) : accepter l'invitation reçue par e-mail.
3. Sur ton poste : `git remote set-url origin https://github.com/<son-identifiant>/momentum-coaching.git`
4. `git push origin main` — c'est le seul test qui prouve l'écriture.

**Vercel — le transfert par code**

Le bouton « Transfer » exige d'être membre des deux comptes, ce que ce montage n'offre pas.
Vercel propose un transfert **par code**, et avec ses identifiants tu fais les deux côtés.

1. Connecté à **son** compte Vercel (navigateur) → *Account Settings → Tokens → Create* →
   **sans limite de projet**, **expiration 1 jour**. Copier le jeton.
2. Dans ton terminal, avec **ton propre** jeton Vercel, générer le code (**valable 24 h**) :
   ```bash
   curl -s -X POST "https://api.vercel.com/projects/momentum-plateforme/transfer-request" \
     -H "Authorization: Bearer <TON jeton>" -H "Content-Type: application/json" -d '{}'
   # → {"code":"…"}
   ```
3. L'accepter avec **son** jeton temporaire :
   ```bash
   curl -s -X PUT "https://api.vercel.com/projects/transfer-request/<le code>" \
     -H "Authorization: Bearer <SON jeton temporaire>" -H "Content-Type: application/json" -d '{}'
   ```
4. Connecté à son compte : **révoquer** le jeton temporaire.
5. Créer le **jeton définitif, limité au projet** — le projet existe maintenant sur son
   compte, donc c'est possible — puis le ranger dans `.vercel-token` à la racine de ce
   dossier (ignoré par git).

⚠️ **Ne jamais passer `newProjectName`** : sans ce champ, le nom est conservé. Le changer
change l'adresse `*.vercel.app` inscrite dans tous les liens de bio.
⚠️ **Générer le code seulement au moment de l'accepter** : il expire en 24 h.
⚠️ **Pourquoi deux jetons.** Le définitif doit être limité au projet ; or avant le
transfert, le projet n'existe pas sur son compte — impossible de limiter un jeton à un
projet absent.

**Supabase**
- Depuis **ton** compte : *Project Settings → General → Transfer project* → son
  organisation. Possible seul : tu es propriétaire de la source et administrateur de la
  cible.

**Rebrancher ton poste**
- Mettre `PROJET.json` à jour, puis `npm run vercel -- link`
- `npm run verifier-cible` doit être **entièrement vert**
- Vérifications **V1 → V7** tout de suite, **V8 → V14** le lendemain

### 4. Plus tard

| ☐ | Quoi | Quand |
|---|---|---|
| ☐ | Rejouer l'**audit d'isolation** dans les deux sens | dès qu'il a ses propres élèves — `docs/isolation-multi-coach.md` |
| ☐ | Confirmer `cron-refresh-tokens` après la rotation du `CRON_SECRET` | lundi 14/09 après 7 h |
