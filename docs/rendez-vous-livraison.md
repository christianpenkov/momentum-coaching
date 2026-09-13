# Le rendez-vous de livraison — qui fait quoi, et quand

**À imprimer ou garder ouvert pendant le rendez-vous.** Ce document dit *qui* et *quand*.
Le *comment* détaillé, avec les vérifications à chaque étape, est dans
`docs/transfert-de-compte.md` §12 — ce document y renvoie au lieu de le recopier, pour
que les deux ne divergent jamais.

**Le critère de tri est unique :** une étape se fait **en sa présence** si elle exige *son*
identifiant, *son* accès à son nom de domaine, *sa* carte, *son* adresse, ou *sa*
décision. Tout le reste, tu le fais seul, après.

---

## 🟢 AVANT — toi seul

| ☐ | Quoi | Pourquoi maintenant |
|---|---|---|
| ☐ | Vérifier que la plateforme est saine (§5 0.3) | pour distinguer après coup « le transfert a cassé ça » de « ça n'allait déjà pas » |
| ☐ | Avoir sous la main ses identifiants provisoires de coach (voir ci-dessous) | il en a besoin pour connecter ses intégrations |
| ☐ | Ouvrir ce document et `supabase/email-templates/README.md` | |

**Son compte coach existe déjà**, verrouillé tant que ses 7 intégrations ne sont pas
connectées — c'est voulu :

```
identifiant : c9351afb-1df3-4dd7-93fb-76ef20afc5f5
e-mail      : quennel.provisoire@example.com   ← provisoire, à remplacer
```

---

## 🤝 PENDANT — avec lui, dans CET ordre

L'ordre n'est pas esthétique : **on commence par ce qui met du temps à se valider**, pour
que ça tourne pendant qu'on fait le reste.

### 1. Resend — EN PREMIER (la vérification DNS peut prendre jusqu'à 72 h)

| ☐ | Lui | Détail |
|---|---|---|
| ☐ | Crée son compte sur `resend.com` | gratuit, 3 000 e-mails/mois |
| ☐ | **Domains → Add Domain** → saisit `notifications.<son-domaine>` | ⚠️ **un sous-domaine, jamais la racine** (voir le piège ci-dessous) |
| ☐ | Région : **`eu-west-1` (Irlande)** | ses élèves sont en Europe |
| ☐ | Se connecte chez son **hébergeur de nom de domaine** et colle **tels quels** les enregistrements que Resend affiche | tu ne peux pas les préparer à l'avance : la clé DKIM est propre à son compte |
| ☐ | **API Keys → Create** → te donne la clé | tu t'en serviras plus tard, à deux endroits |

> 🪤 **Pourquoi le sous-domaine est obligatoire.** Si Quennel a déjà une boîte mail sur son
> domaine (Google Workspace, Outlook…) et qu'on configure Resend sur la **racine**, les
> enregistrements MX entrent en conflit : **toute sa messagerie basculerait vers Resend, et
> il ne recevrait plus ses propres e-mails.** Le sous-domaine isole complètement l'envoi de
> la plateforme. Source : base de connaissances Resend, « How do I avoid conflicting with
> my MX records ».

→ **La vérification tourne maintenant. On passe à la suite sans l'attendre.**

### 2. Son adresse e-mail réelle

| ☐ | Tu notes | Elle servira à |
|---|---|---|
| ☐ | son adresse personnelle | remplacer l'adresse provisoire de son compte coach **et** recevoir les alertes « exploitation » (« Instagram déconnecté — *élève* ») |

### 3. Les trois comptes de destination

| ☐ | Lui | Vérification sur place |
|---|---|---|
| ☐ | **GitHub** : crée son compte (s'il n'en a pas) | la page `github.com/<son-identifiant>` existe |
| ☐ | **Supabase** : crée une organisation (**Free** suffit) → `Organization Settings → Team → Invite` → ton adresse, rôle **`Administrator`** | ⚠️ **tu acceptes l'invitation sur place**, et tu vois bien 2 organisations |
| ☐ | **Vercel** : crée son compte | ⚠️ vérifier qu'**aucun projet ne s'appelle déjà `momentum-plateforme`** — sinon le transfert imposerait un autre nom, et **tous les liens de bio de ses élèves casseraient** (§3) |
| ☐ | **Vercel** : `Account Settings → Tokens → Create` → **sans limite de projet, expiration 1 jour** → te le donne | il sert **uniquement** à accepter le transfert (étape Vercel ci-dessous) — il le révoquera ensuite |

> ⚠️ **Pourquoi un jeton temporaire non limité, et pas le jeton définitif.** Le jeton
> définitif doit être limité au projet (`--project momentum-plateforme`). Or ce projet
> **n'existe pas encore sur son compte** tant que le transfert n'a pas eu lieu : impossible
> de créer un jeton limité à un projet absent. D'où deux jetons, dans cet ordre.

### 4. Ses 7 intégrations — en dernier, Stripe tout à la fin

| ☐ | Lui | |
|---|---|---|
| ☐ | Se connecte sur la plateforme avec les **identifiants provisoires** | le verrou ouvre automatiquement l'assistant de connexion |
| ☐ | Connecte : **Instagram, YouTube, Calendly, Fathom, Short.io, Google** | |
| ☐ | **Stripe en dernier** | c'est la seule dont le report coûterait cher |
| ☐ | Le verrou se lève tout seul à la 7ᵉ | preuve immédiate que tout est branché |

> ✅ **Rien ne sera à reconnecter après le transfert.** Les jetons dépendent des
> applications OAuth (Meta, Google, Calendly, Fathom, Stripe), qui **restent chez toi**.
> Le transfert ne les voit pas passer (§0 ter, décisions D2 à D4).

### 5. La seule décision qui lui revient

| ☐ | Question | Ce qu'il faut qu'il sache |
|---|---|---|
| ☐ | **Plan Vercel : Hobby ou Pro ?** | Hobby **interdit l'usage commercial** (« être payé pour créer ou héberger le site »). Ce n'est pas une limite technique : **aucune erreur jusqu'au jour d'une suspension**. Pro ≈ 20 $/mois. (§4) |

---

## 🔵 APRÈS — toi seul

### Le soir même

| ☐ | Quoi | Comment |
|---|---|---|
| ☐ | Remplacer son adresse provisoire | Supabase → **Authentication → Users** → son compte → modifier l'e-mail. *Sans risque : pour un coach, l'adresse ne vit que dans `auth.users`* |
| ☐ | Vérifier que ses 7 intégrations sont bien là | requête de l'étape **A11** du §12 |

### Dès que Resend affiche « Verified »

⚠️ **Pas avant** : basculer vers un domaine non vérifié fait rebondir les e-mails.

| ☐ | Où | Nouvelle valeur |
|---|---|---|
| ☐ | Vercel `RESEND_API_KEY` | **sa** clé |
| ☐ | Supabase → Authentication → Emails → **SMTP → Password** | **la même** clé |
| ☐ | Vercel `ALERTES_EMAIL_EXPEDITEUR` | `Momentum <noreply@notifications.son-domaine>` |
| ☐ | Supabase → SMTP → **Sender email** | la même adresse |
| ☐ | Vercel `ALERTES_EMAIL_EXPLOITATION` | **son** adresse réelle |
| ☐ | Vercel `ALERTES_EMAIL_TECHNIQUE` | 🔒 **ne change pas** — reste la tienne, définitivement |
| ☐ | **Redéployer** | une variable modifiée n'atteint pas un déploiement en ligne |
| ☐ | Tester : une **vraie invitation** + un **vrai « mot de passe oublié »** | |

> ⚠️ **La clé Resend vit à DEUX endroits** (Vercel et le SMTP Supabase). En changer une
> sans l'autre casse la moitié des e-mails, en silence.
>
> ⚠️ **Toutes les variables Vercel se posent avec `printf`, jamais `echo`** — `echo`
> ajoute un retour à la ligne qui corrompt la valeur.
>
> ✅ **Tu ne supprimes pas ton domaine chez Resend.** Ton compte sert tes autres projets ;
> Momentum cesse simplement de l'utiliser dès que la clé change.

### Le lendemain, après 24 h de collecte saine — le transfert

Le détail et les vérifications sont au **§12, blocs B et C**. Voici seulement qui clique :

| ☐ | Pilier | Qui | Particularité |
|---|---|---|---|
| ☐ | **GitHub** | toi : *Settings → Danger Zone → Transfer ownership* | ⚠️ **il doit accepter** via le lien reçu par e-mail — pas besoin de rendez-vous, mais il faut le prévenir |
| ☐ | **Vercel** | toi : générer le code de transfert | voir l'encadré ci-dessous |
| ☐ | **Supabase** | toi seul : *Project Settings → General → Transfer project* | possible sans lui : tu es propriétaire de la source **et** administrateur de la cible |
| ☐ | Rebrancher ce poste | toi : `PROJET.json`, puis `git remote set-url`, `npm run vercel -- link` | `npm run verifier-cible` doit être entièrement vert |
| ☐ | Vérifications **V1 → V7** | toi, immédiatement | §12 bloc B6 |
| ☐ | Vérifications **V8 → V14** | toi, le lendemain | §12 bloc C |

#### Le transfert Vercel par code — valable 24 heures

Le transfert classique depuis le tableau de bord exige d'être **membre des deux comptes**,
ce que ton montage n'offre pas. Vercel propose un transfert par **code** : tu le génères
depuis ton compte, et il est accepté depuis le sien.

```bash
# 1. Toi, depuis TON compte — génère le code (valable 24 h)
curl -s -X POST "https://api.vercel.com/projects/momentum-plateforme/transfer-request" \
  -H "Authorization: Bearer <TON jeton Vercel>" -H "Content-Type: application/json" -d '{}'
# → {"code":"xxxxxxxx-xxxx-…"}

# 2. Accepté avec SON jeton temporaire (étape 3 du rendez-vous)
curl -s -X PUT "https://api.vercel.com/projects/transfer-request/<le code>" \
  -H "Authorization: Bearer <SON jeton temporaire>" -H "Content-Type: application/json" -d '{}'
```

⚠️ **Ne PAS passer `newProjectName`** : sans ce champ, le nom `momentum-plateforme` est
conservé. Le changer changerait l'adresse `*.vercel.app` inscrite dans tous les liens de
bio de ses élèves.

⚠️ **Le code expire au bout de 24 h.** Le générer seulement au moment de l'accepter.

**Juste après le transfert, lui :**

| ☐ | Quoi |
|---|---|
| ☐ | **Révoquer le jeton temporaire** (*Account Settings → Tokens*) |
| ☐ | Créer le **jeton définitif, limité au projet** : `npx vercel tokens add "chris-momentum" --project momentum-plateforme` → te le donner |
| ☐ | Toi : le ranger dans `.vercel-token` à la racine de ce dossier (ignoré par git) |

> ⚠️ **Jamais `vercel login` avec son compte.** La session Vercel est **globale à la
> machine** : tous tes autres projets basculeraient sur son compte. Le jeton, lui, vit dans
> ce dossier et ne touche que ce projet (§6).

### Plus tard

| ☐ | Quoi | Quand |
|---|---|---|
| ☐ | Rejouer l'**audit d'isolation** dans les deux sens | dès qu'il a ses propres élèves — `docs/isolation-multi-coach.md` |
| ☐ | Confirmer que `cron-refresh-tokens` est repassé avec le nouveau `CRON_SECRET` | lundi 14/09 après 7 h — c'est le seul cron pas encore vu depuis la rotation du 12/09 |
