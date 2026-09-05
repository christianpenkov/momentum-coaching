import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { EMPREINTES_EDGE } from '@/lib/empreintes-edge.generated';
import { MIGRATIONS_DEPOT } from '@/lib/migrations-depot.generated';

// GET /api/sante/alerte-vues
//
// Prévient par e-mail quand une vue de santé se met à alerter.
//
// ── Pourquoi cette route existe ──────────────────────────────────────────────
//
// La plateforme comptait onze vues de santé et UNE SEULE alerte par e-mail, celle du
// plafond de stockage. Les dix autres attendaient qu'on pense à les regarder. Une
// surveillance qu'il faut penser à consulter n'est pas une surveillance : c'est une
// documentation. Le jour où une vente est mal datée, où un euro est crédité à deux
// contenus, ou où un cron meurt, personne ne l'apprend — sauf en tombant dessus des
// semaines plus tard, quand la donnée fausse s'est déjà propagée partout.
//
// ── La contrainte qui a dicté la forme ───────────────────────────────────────
//
// Cet e-mail arrivera peut-être dans un an, chez quelqu'un qui n'a jamais vu ce code —
// ou chez le même, qui ne s'en souviendra plus. Un message du type « ventes_sante_date :
// 2 lignes » serait alors strictement inutile : il faudrait retrouver ce qu'est cette
// vue, pourquoi elle existe, et quoi faire. Chaque alerte porte donc, en toutes
// lettres : ce que la vue surveille, ce que l'alerte veut dire, la gravité réelle, les
// premières vérifications, et un PROMPT PRÊT À COLLER dans Claude Code qui nomme le
// projet et la marche à suivre.
//
// ── Anti-répétition ──────────────────────────────────────────────────────────
//
// Une alerte par clé, envoyée UNE fois (table `alertes_plateforme`). Une alerte qui
// revient tous les matins est ignorée dès la troisième fois — donc au moment où elle
// compte. Quand la vue redevient propre, la ligne est effacée ici même : l'alerte se
// réarme toute seule pour la prochaine fois.
//
// ── Pourquoi ici et pas dans pg_cron ─────────────────────────────────────────
//
// Même raison que `alerte-stockage` : la clé Resend vit dans les variables Vercel, et
// cette route est le seul endroit qui l'a légitimement sous la main. `poll-leads`
// (porteur du CRON_SECRET) appelle ici une fois par jour. Aucun secret ne se déplace,
// aucun planificateur externe à créer.

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PROJET_SUPABASE = 'nvjgwtetyuatnkjihmtw';
const DOSSIER = 'C:\\Users\\chris\\Projet Quennel Momentum\\orbit';

type Surveillance = {
  /** Clé d'anti-répétition. Ne jamais la changer : elle identifie l'alerte dans la table. */
  cle: string;
  /** Le nom exact de la vue ou de la table à interroger. */
  source: string;
  /** Titre de l'e-mail, lisible sans contexte. */
  titre: string;
  /**
   * Comment reconnaître une anomalie.
   *
   * ⚠️ `etat <> 'ok'` n'est JAMAIS un filtre d'anomalie sur ce projet : plusieurs vues
   * renvoient des états légitimes (`non_connectee`, `vente sans rendez-vous`,
   * `rapportée avant le rendez-vous`). Les chercher comme des pannes a déjà fait
   * remonter 23 faux positifs. Deux formes seulement : `alerte` (colonne `etat` qui
   * commence par ALERTE ou SILENCIEUX) et `toute_ligne` (la vue est vide quand tout va
   * bien).
   */
  detection: 'alerte' | 'toute_ligne';
  /** Ce que la vue surveille, en une phrase compréhensible sans le code. */
  surveille: string;
  /** Ce que l'alerte veut dire concrètement, et ce que ça coûte. */
  signifie: string;
  /** Ce qu'il faut faire, dans l'ordre. */
  quoiFaire: string[];
  /** Les documents qui portent le contexte complet. */
  docs: string[];
};

const SURVEILLANCES: Surveillance[] = [
  {
    cle: 'sante_migrations',
    source: 'migrations_sante',
    titre: 'Un changement de base de données n’existe que dans la base',
    detection: 'toute_ligne',
    surveille:
      'Que chaque migration appliquée à la base ait bien son fichier dans le dépôt, et réciproquement. La clé de rapprochement est le NOM : celui passé à `apply_migration` doit être exactement celui du fichier, horodatage retiré.',
    signifie:
      'Un changement de schéma appliqué sans fichier n’existe QUE dans la base de production : invisible au dépôt, perdu à toute reconstruction, et impossible à comprendre plus tard puisque personne n’a écrit pourquoi. ⚠️ Il ne produit AUCUN symptôme — la base fonctionne, les écrans fonctionnent, les tests passent. Le 3 septembre 2026, sept migrations étaient dans ce cas, venues de quatre sessions différentes, dont celle qui crée toute la surveillance des crons ; deux migrations ultérieures agissaient sur une table qu’aucun fichier ne créait.',
    quoiFaire: [
      '`select * from migrations_sante;` — la colonne `nom` donne la migration concernée.',
      '« appliquée sans fichier » : le SQL EXACT est récupérable, ne rien reconstruire de tête — `select name, version, array_to_string(statements, chr(10)) from supabase_migrations.schema_migrations where name in (\'…\');` rend les instructions d’origine, commentaires compris. Écrire le fichier manquant dans `supabase/migrations/` avec ce contenu VERBATIM, en le marquant comme reconstitution.',
      '⚠️ Ne se rabattre sur l’inspection de l’état (`pg_get_viewdef`, `pg_get_functiondef`, `information_schema.columns`) que si `statements` est vide (migrations anciennes). L’état final ne distingue pas « n’a jamais existé » de « ajoutée puis retirée », et perd tous les commentaires — donc le pourquoi. Trouvé le 2026-09-05 sur `avatar_maj_le` / `retrait_avatar_maj_le`, une colonne posée puis retirée en quatre minutes : l’état seul aurait fait conclure « rien à reconstituer ».',
      '« fichier jamais appliqué » ne dit RIEN du contenu. Le changement peut très bien être déjà en base, posé par `execute_sql` ou depuis le dashboard, sans laisser de ligne à son nom — c’était le cas le 2026-09-04 pour `publications_youtube`. Ne pas partir chercher une fonctionnalité manquante à l’écran : commencer par lire l’état réel.',
      '⚠️ Et « l’objet existe » ne suffit pas à décider. Le fichier peut différer de ce qui tourne, et le réappliquer changerait alors le comportement sans que rien ne le signale. Comparer les DEUX définitions NORMALISÉES — commentaires retirés, espaces réduits, puis `md5` — avant de conclure. Le 2026-09-04, elles ne différaient que par des alias de colonnes que Postgres supprime au stockage : appliquer était donc prouvé sans effet, et la migration a pu être enregistrée sans risque.',
      'Puis appliquer par `apply_migration` sous le nom EXACT du fichier, ce qui inscrit la ligne manquante. Les instructions étant idempotentes (`create or replace`, `create index if not exists`), rejouer ne change rien.',
      '⚠️ Cause la plus fréquente : un nom différent des deux côtés. Renommer le fichier pour qu’il corresponde au nom appliqué (ou l’inverse) suffit alors.',
      '⚠️ Ne couvre que le récent : 185 migrations anciennes n’ont aucun fichier et il n’existe pas de clé fiable pour les rapprocher. Les deux bornes, et la mesure qui les justifie, sont dans `20260903200000_migrations_sante.sql`.',
    ],
    docs: [
      'supabase/migrations/20260903200000_migrations_sante.sql',
      'scripts/manifeste-migrations.mjs',
      'AGENTS.md',
    ],
  },
  {
    cle: 'sante_acces_lecture',
    source: 'acces_sante_lecture',
    titre: 'Une donnée est lisible depuis le navigateur sans que la RLS ne s’applique',
    detection: 'toute_ligne',
    surveille:
      'Un invariant, pas une liste : toute relation de `public` que `anon` ou `authenticated` peut lire DOIT appliquer la RLS — `security_invoker = true` pour une vue, RLS activée pour une table.',
    signifie:
      'Une vue sans `security_invoker` s’exécute avec les droits de son PROPRIÉTAIRE : la RLS des tables sources est contournée, et la vue rend TOUTES les lignes de tous les coachs. Si `anon` peut la lire, aucune session n’est même nécessaire — la clé `anon` est publique par construction, elle est dans le bundle JS de chaque élève. ⚠️ Cette vue existe parce que Supabase pose des privilèges par défaut sur `public` : toute vue nouvellement créée y est immédiatement lisible par `anon` et `authenticated`, SANS qu’aucun `grant` n’apparaisse dans le diff. Le verrouillage du 2 septembre 2026 a été défait dès le lendemain par deux `create view` ordinaires, exposant les ventes, montants et identifiants Stripe de tous les coachs.',
    quoiFaire: [
      '`select * from acces_sante_lecture;` — la colonne `protection` dit ce qui manque.',
      'Vue lue seulement par le serveur (toutes les vues de santé) : `revoke select on public.<vue> from anon, authenticated;` puis `grant select on public.<vue> to service_role;`',
      'Vue réellement lue par le navigateur : `alter view public.<vue> set (security_invoker = true);` — la RLS s’applique alors, `service_role` continue de tout voir.',
      'Table : `alter table public.<table> enable row level security;` puis écrire les policies, ou aucune policy si seul le serveur la lit.',
      '⚠️ Ne PAS retirer les privilèges par défaut du schéma (`alter default privileges … revoke`) : les tables applicatives en dépendent, le navigateur les lit avec `authenticated` protégé par la RLS.',
    ],
    docs: [
      'supabase/migrations/20260903170000_verrou_structurel_lecture_public.sql',
      'docs/security-notes.md',
      'AGENTS.md, section « Un `profile_id` est PUBLIC »',
    ],
  },
  {
    cle: 'sante_edge_version',
    source: 'edge_sante_version',
    titre: 'Une fonction en ligne n’exécute pas le code du dépôt',
    detection: 'alerte',
    surveille:
      'Que chaque Edge Function tournant chez Supabase exécute bien le code présent dans le dépôt. Elle compare l’empreinte du code source (`index.ts` + tous ses imports locaux) à celle que la fonction remonte elle-même à chaque passage.',
    signifie:
      'Une correction validée et enregistrée dans le dépôt n’est PAS active en production, et rien d’autre ne peut le dire. Une Edge Function ne part pas avec `git push` : elle demande une commande à part, et l’oublier ne casse rien de visible. Le 3 septembre 2026, `poll-leads` a tourné deux jours avec du code vieux de huit commits, dont un correctif qui empêchait l’origine d’un lead (« Cold DM », « commentaire », « description YouTube ») d’être écrasée toutes les cinq minutes — un champ que six écrans lisent, dont toute l’attribution des paiements. ⚠️ `crons_sante` ne pouvait pas le voir : elle prouve qu’un cron TOURNE, jamais qu’il tourne le BON code. Et la date de mise à jour affichée par le tableau de bord Supabase MENT (prouvé sur `refresh-ig-posts` : date au 02/08, contenu du 20/08).',
    quoiFaire: [
      '`select * from edge_sante_version where etat like \'ALERTE%\';` — `empreinte_du_depot` contre `empreinte_en_ligne`.',
      'Redéployer la fonction nommée : `npm run deployer-edge <nom>` (elle vérifie les types, régénère l’empreinte, puis déploie — dans cet ordre).',
      '⚠️ Vérifier d’abord `git status` : le déploiement envoie la COPIE DE TRAVAIL. Si une autre session a du travail en cours dans ce fichier, déployer depuis un arbre propre — `git worktree add --detach /tmp/wt HEAD` puis `npm run deployer-edge <nom>` depuis là.',
      'Si l’alerte persiste après un redéploiement réussi, c’est l’empreinte qui est périmée et non le code : `npm run empreintes-edge`, puis commiter et pousser (Vercel recalcule l’attendu à chaque construction).',
      '« hors crons inscrits » et « non instrumentee » ne sont PAS des anomalies : la première désigne une fonction qui n’est pas un cron inscrit (`call-reminders` et `send-pending-dm3` tournent en pg_cron), la seconde une fonction qui ne remonte pas encore son empreinte.',
    ],
    docs: [
      'scripts/empreintes-edge.mjs (le motif complet en en-tête)',
      'AGENTS.md, section « Vérifier qu’une Edge Function tourne bien le code du dépôt »',
      'docs/checklist-scalabilite.md',
    ],
  },
  {
    cle: 'sante_ventes_date',
    source: 'ventes_sante_date',
    titre: 'Une vente est datée autrement qu’à la tenue de son rendez-vous',
    detection: 'alerte',
    surveille:
      'Que la date d’une vente (`deals.signed_at`) tombe bien sur la tenue d’un des rendez-vous du prospect, et non sur l’instant où le rapport a été rempli.',
    signifie:
      'Une vente est datée du moment de la SAISIE du rapport. Comme les brouillons vivent 30 jours, un rendez-vous de fin de mois rapporté le mois suivant fait basculer son chiffre d’affaires dans le mauvais mois — sur tous les écrans à la fois, donc sans qu’aucun ne contredise l’autre. C’est le défaut corrigé le 1er septembre 2026 sur quatre ventes.',
    quoiFaire: [
      'Regarder la ligne : `select * from ventes_sante_date where etat like \'ALERTE%\';`',
      'Vérifier si le chemin d’écriture a régressé — `app/api/payments/links/route.ts` doit appeler `dateDeVente` de `lib/callSeries.ts`.',
      'Si la donnée seule est fausse, `node scripts/redater-ventes.mjs` simule sans rien écrire, puis `--appliquer`.',
    ],
    docs: ['docs/perimetre-stats-referentiel.md (règle 7)', 'lib/callSeries.ts'],
  },
  {
    cle: 'sante_ventes_contenu',
    source: 'ventes_sante_contenu',
    titre: 'Le même euro est crédité à deux contenus différents selon l’écran',
    detection: 'alerte',
    surveille:
      'Que les deux lectures de l’attribution d’une vente concordent : la copie figée `deals.first_touch_content_id`, que lisent les quatre routes de paiement, et le contenu recalculé depuis le rendez-vous, que lit l’onglet Business micro.',
    signifie:
      'Un contenu est crédité d’une vente sur un écran et un autre sur un autre. Tant que ça concorde personne ne voit rien ; le jour où ça diverge, deux écrans donnent deux réponses à « quel contenu a rapporté cet argent ». C’est le mécanisme d’`instagram_leads` : une copie que personne ne confronte à sa source finit par mentir.',
    quoiFaire: [
      '`select * from ventes_sante_contenu where etat like \'ALERTE%\';`',
      'Comparer `deals.first_touch_content_id` au `utm_content` du call, et à `prospect_links.content_id` en repli.',
      '« vente sans rendez-vous » n’est PAS une anomalie : un upsell n’a aucun contenu à créditer.',
    ],
    docs: ['AGENTS.md, section Santé de la plateforme', 'lib/attribution-roles.ts'],
  },
  {
    cle: 'sante_ventes_montants',
    source: 'ventes_sante_montants',
    titre: 'Un élève a saisi un montant que ses statistiques n’affichent pas',
    detection: 'toute_ligne',
    surveille:
      'Que les deux écritures du cash concordent : le montant saisi dans le rapport de call (`calls.revenue`) et le deal qui en découle (`deals.amount_total`).',
    signifie:
      'Les écrans lisent `deals`. Une ligne ici signifie qu’un élève a déclaré un montant dans son rapport et que ses statistiques en affichent un autre — ou aucun. L’écart entre les deux champs est lui-même une information : on ne supprime rien, on comprend d’où vient la divergence.',
    quoiFaire: [
      '`select * from ventes_sante_montants;`',
      'Une correction faite depuis la page Paiements ne réécrit pas le rapport : c’est le cas le plus fréquent et il est légitime.',
      'Si le deal manque complètement, c’est le chemin d’écriture des paiements qu’il faut regarder.',
    ],
    docs: ['docs/stripe-paiements.md', 'docs/perimetre-stats-referentiel.md (règle 7)'],
  },
  // ── RETIREE DES E-MAILS le 2026-09-05 — `ventes_sante_sur_encaissement` ─────
  //
  // La vue existe toujours et reste interrogeable ; elle n'ecrit simplement plus
  // a l'exploitant de la plateforme. Decision de Chris, et elle est juste :
  //
  //   « un trop-percu qui est la depuis un mois, c'est pas de ma faute mais de
  //     l'user — que ca m'envoie pas de mails a moi pour ca »
  //
  // Un sur-encaissement fausse les chiffres D'UN COACH, sur SES clients, et lui
  // seul sait qui a paye quoi. L'exploitant ne connait pas ces clients : il ne
  // peut ni trancher ni corriger. Une alerte qu'on ne peut pas traiter est une
  // alerte qu'on apprend a ignorer — et c'est celles qui comptent qui trinquent.
  //
  // Le cas est desormais pris en charge la ou il appartient :
  //   · a l'ECRITURE  — `orphans/route.ts` refuse un rattachement qui ferait
  //     depasser le montant contracte, en affichant les chiffres, et exige une
  //     confirmation explicite. L'erreur ne peut plus se commettre distraitement.
  //   · a la LECTURE  — la fiche du client affiche « X EUR verses en trop » avec
  //     un bouton « Rembourser le trop-percu ». C'est l'ecran du coach, celui de
  //     la personne qui peut agir.
  //
  // Regle generale a retenir avant d'ajouter une surveillance ici : n'y mettre
  // que ce que l'EXPLOITANT peut reparer — cron arrete, code en ligne perime,
  // acces ouvert, stockage sature, migrations divergentes. Jamais une donnee
  // metier d'un compte client.
  {
    cle: 'sante_stripe_rattachement',
    source: 'stripe_sante_rattachement',
    titre: 'Un encaissement Stripe n’est revendiqué par aucune vente',
    detection: 'toute_ligne',
    surveille:
      'Que chaque encaissement enregistré chez nous soit rattaché à une vente.',
    signifie:
      'De l’argent est entré sans qu’on sache pour quoi. Le plus souvent un paiement de test, ou un rattachement manqué par le webhook. ⚠️ Cette vue ne voit QUE ce qu’un chemin d’écriture a déjà enregistré : un webhook jamais délivré ne laisse aucune trace et reste invisible ici. Seule la passe de `sync-stripe-payments` ferme ce trou-là.',
    quoiFaire: [
      '`select * from stripe_sante_rattachement;`',
      'Retrouver le paiement dans le dashboard Stripe et voir à quoi il correspond.',
      'Si c’est un paiement de test, le supprimer de `deal_payments` — sinon il masquera une vraie anomalie en s’y mélangeant.',
    ],
    docs: ['docs/stripe-paiements.md'],
  },
  {
    cle: 'sante_clics_redirection',
    source: 'clics_sante_redirection',
    titre: 'La redirection qui pose le Click ID ne compte plus les clics',
    detection: 'alerte',
    surveille:
      'Que les clics comptés par Short.io et ceux comptés par notre route `/r/` restent du même ordre, lien par lien.',
    signifie:
      'La route qui pose le Click ID est cassée, ou un lien partagé pointe encore droit sur Calendly. Conséquence : les rendez-vous venus d’un lien de bio ou de description ne sont plus reliés au clic qui les a produits, et le taux clic → call redevient faux. ⚠️ Elle détecte une PANNE, pas une parité exacte : les deux filtres à robots ne classeront jamais identiquement.',
    quoiFaire: [
      '`select * from clics_sante_redirection where etat like \'ALERTE%\';`',
      'Ouvrir un lien de bio et vérifier qu’il passe bien par `/r/` avant d’arriver sur Calendly.',
      '⚠️ Si le domaine de la plateforme ou le nom du projet Vercel a changé, c’est la cause : l’adresse est écrite dans la destination de TOUS les liens partagés. La procédure complète est dans `docs/click-id.md`.',
      '« lien non redirigé » n’est PAS une anomalie : la réécriture n’a pas encore atteint ce lien.',
    ],
    docs: ['docs/click-id.md'],
  },
  {
    cle: 'sante_crons',
    source: 'crons_sante',
    titre: 'Un cron s’est tu, ou tourne beaucoup trop souvent',
    detection: 'alerte',
    surveille:
      'Que chaque cron inscrit laisse une trace de passage, succès OU échec, dans le délai qui lui est propre — et qu’il n’en laisse pas quatre fois trop. Deux états possibles : `SILENCIEUX` et `ALERTE cadence trop rapide`.',
    signifie:
      'SILENCIEUX : un cron qui ne tourne plus n’échoue pas, il se tait, et un silence ne se distingue pas d’un succès. C’est la panne la plus coûteuse de la plateforme parce qu’elle est la plus discrète — les données cessent simplement d’arriver, et personne ne le voit avant des semaines. — CADENCE TROP RAPIDE : le planificateur appelle le cron bien plus souvent que prévu. Ça ne casse rien de visible, et c’est justement le problème : un cron trop rapide passe tous les autres contrôles, sa trace est fraîche, ses données sont à jour, `cron_runs` reste vide puisqu’il ne rate rien. Il a l’air PLUS sain que la normale. Le 4 septembre 2026, `sync-calendly` et `notify-rapport` tournaient toutes les minutes au lieu de toutes les 30 minutes — 30× la cadence prévue, depuis une date inconnue — et ça n’a été découvert qu’en cherchant d’où venaient 5 Go d’egress consommés en une semaine sur un quota MENSUEL de 5 Go. Ça consomme aussi le quota d’appels Calendly (60/min par jeton), qui devient la contrainte réelle à 40 élèves.',
    quoiFaire: [
      '`select nom, etat, passages_du_jour, cadence_attendue from crons_sante;` — `passages_du_jour` contre `cadence_attendue` dit l’ampleur de l’écart.',
      'SILENCIEUX : ouvrir le job correspondant sur cron-job.org et regarder ses derniers passages et son URL.',
      'CADENCE TROP RAPIDE : ouvrir le job sur cron-job.org et corriger son INTERVALLE. ⚠️ La correction est là-bas, pas dans le dépôt — ni l’URL ni la cadence d’un job cron-job.org ne se lisent dans le code.',
      '⚠️ Les crons vivent à DEUX endroits : pg_cron dans la base (`select jobname, schedule, active from cron.job;`) et cron-job.org. Le tableau de correspondance est dans AGENTS.md.',
      '⚠️ `cadence_attendue` est la cadence NOMINALE, saisie à la main depuis cron-job.org — jamais déduite de l’observation. Si un job a légitimement changé de fréquence, c’est cette colonne qu’il faut mettre à jour, sinon l’alerte criera en permanence.',
    ],
    docs: [
      'AGENTS.md, section « Les crons vivent à DEUX endroits »',
      'supabase/migrations/20260904120000_crons_sante_cadence_trop_rapide.sql',
    ],
  },
  {
    cle: 'sante_ig_periodes',
    source: 'ig_sante_periodes',
    titre: 'La portée Instagram d’une période courante n’est plus rafraîchie',
    detection: 'alerte',
    surveille:
      'Que la portée dédupliquée de la semaine en cours, du mois en cours et de tout l’historique soit remesurée régulièrement. Le cron passe toutes les 6 h ; l’alerte se déclenche à 24 h.',
    signifie:
      'Les appels à Meta échouent de façon durable. Un échec isolé est normal et se répare au passage suivant — c’est pour ça que cette vue regarde la conséquence et non les erreurs. Quatre auto-réparations ratées d’affilée, en revanche, veut dire que la mesure ne repart plus.',
    quoiFaire: [
      '`select * from ig_sante_periodes where etat like \'ALERTE%\';`',
      'Vérifier le jeton du profil concerné : `select provider, status, expires_at from integrations where profile_id = \'…\';`',
      '⚠️ Cause connue et invisible : la perte de l’accès avancé Meta sur `instagram_business_basic` coupe TOUS les comptes sauf celui de l’administrateur, pendant que les jetons continuent de se rafraîchir normalement.',
      'Le rattrapage des périodes ANCIENNES n’est pas surveillé et n’est jamais une panne : il avance d’une période par passage.',
    ],
    docs: ['docs/checklist-scalabilite.md', 'supabase/functions/poll-leads/index.ts'],
  },
  {
    cle: 'sante_ig_insights_posts',
    source: 'ig_sante_insights_posts',
    titre: 'La collecte des statistiques de publications Instagram est en défaut',
    detection: 'alerte',
    surveille: 'Que les statistiques de chaque publication Instagram continuent d’arriver.',
    signifie:
      'Les chiffres par contenu se figent. ⚠️ Deux états ne sont PAS des pannes : `depreciation_metrique_probable` signale qu’une métrique Meta vient de disparaître, ce que la plateforme encaisse toute seule ; et `posts_muets_definitif` concerne les publications antérieures au passage en compte professionnel, sur lesquelles Meta ne rendra jamais rien.',
    quoiFaire: [
      '`select * from ig_sante_insights_posts where etat like \'ALERTE%\';`',
      'Vérifier le jeton et les permissions du profil concerné.',
    ],
    docs: ['docs/checklist-scalabilite.md'],
  },
  {
    cle: 'sante_yt_donnees',
    source: 'yt_sante_donnees',
    titre: 'La collecte YouTube est en défaut',
    detection: 'alerte',
    surveille: 'Que les statistiques YouTube continuent d’arriver, par chaîne et par vidéo.',
    signifie: 'Les chiffres YouTube se figent, sans que rien ne casse à l’écran.',
    quoiFaire: [
      '`select * from yt_sante_donnees where etat like \'ALERTE%\';`',
      'Vérifier le jeton YouTube du profil concerné dans `integrations`.',
    ],
    docs: ['docs/checklist-scalabilite.md'],
  },
  {
    // ⚠️ La clé ne change PAS : elle identifie l’alerte dans `alertes_plateforme`.
    // Seule la SOURCE a changé, de `cron_runs` vers `cron_runs_actifs`.
    cle: 'sante_cron_runs',
    source: 'cron_runs_actifs',
    titre: 'Un cron a échoué de façon actionnable',
    detection: 'toute_ligne',
    surveille:
      'Les échecs de cron qui demandent ENCORE une action — c’est-à-dire ceux dont la cause n’a pas été corrigée (`cron_runs.resolu_le` nulle). Les incidents passagers et auto-réparés en sont volontairement absents.',
    signifie:
      'Le contrat de cette vue est « vide = aucun incident ». Une ligne veut donc dire qu’un traitement a échoué et ne se réparera pas tout seul. ⚠️ Ne jamais y ajouter d’incident auto-réparé : le jour où elle contient des lignes qu’on ne peut pas traiter, on prend l’habitude de ne plus la lire, et elle ne sert plus le jour d’un vrai incident.',
    quoiFaire: [
      '`select id, fonction, ran_at, erreurs from cron_runs_actifs order by ran_at desc;`',
      'Corriger la CAUSE, puis marquer la ligne résolue — sans quoi elle bloque toute alerte ultérieure : `update cron_runs set resolu_le = now(), resolu_note = \'<le commit ou la migration qui corrige>\' where id = \'<id>\';`',
      '⚠️ Ne JAMAIS supprimer la ligne : effacer la preuve d’un incident pour faire taire une alerte est le geste que ce projet interdit partout ailleurs. On l’annote, elle reste lisible dans `cron_runs`.',
      '⚠️ Et ne jamais la marquer résolue « pour nettoyer » : tant que `resolu_le` est nulle, la ligne PROTÈGE — c’est elle qui dit qu’il reste quelque chose à faire.',
      'Si l’erreur est en réalité passagère et se répare seule, la classer dans `estIncidentPassager` (poll-leads) ET poser une vue qui surveille sa conséquence — jamais l’une sans l’autre.',
      '`cron_runs` garde tout l’historique 30 jours, résolu ou non, et se purge d’elle-même.',
    ],
    docs: [
      'AGENTS.md, section Santé de la plateforme',
      'supabase/migrations/20260905120000_cron_runs_incidents_resolus.sql',
    ],
  },
  {
    cle: 'sante_ig_vocaux',
    source: 'ig_vocaux_sante',
    titre: 'La capture des messages vocaux Instagram ne fonctionne plus',
    detection: 'toute_ligne',
    surveille:
      'Une ligne par élève dont le DERNIER message vocal reçu n’a pas de fichier dans le bucket `ig-vocaux`. Le chemin est recalculé à partir du message, il n’y a aucune colonne à tenir à jour.',
    signifie:
      '⚠️ La question posée est « est-ce cassé MAINTENANT ? », pas « un vocal a-t-il été perdu un jour ? ». Si le dernier vocal manque, la cause est encore active et le PROCHAIN vocal sera perdu aussi — là, il y a quelque chose à faire. Les pertes déjà rattrapées ne sont volontairement PAS signalées : elles n’appellent aucune action, puisque Meta ne ressert jamais un vocal, et l’écran les montre déjà une par une en « Non récupérable ». La première version de cette vue signalait toute perte des 48 dernières heures : son tout premier e-mail, le 2026-09-05, annonçait deux pertes déjà corrigées sur lesquelles il n’y avait rien à faire. Une alerte sans action possible est le début d’une alerte qu’on n’ouvre plus.',
    quoiFaire: [
      "La cause exacte est journalisée : `select created_at, message, data from webhook_debug_log where message ilike '%vocal%' order by created_at desc;` (14 jours de rétention).",
      "⚠️ Cause déjà rencontrée le 2026-09-04 : Meta sert un vocal avec `content-type: video/mp4`, que le bucket refusait (`mime type video/mp4 is not supported`). Corrigé par `typeAudio()` dans `lib/instagram-webhook-processor.ts`, qui ne fait confiance qu’à la déclaration `type: 'audio'` de la pièce jointe, pas à l’en-tête de transport.",
      'Autre piste : le plafond de 25 Mo du bucket, ou le quota de fichiers — voir `sante_stockage_fichiers`.',
      '⚠️ Le vocal déjà perdu ne se rattrape pas. Corriger la cause protège les suivants, rien d’autre. La vérification est donc d’envoyer un NOUVEAU vocal au compte concerné : dès qu’il est capturé, la vue se tait d’elle-même.',
      '⚠️ Un défaut INTERMITTENT reste détecté : tôt ou tard le dernier vocal est un vocal manqué. On perd la trace des échecs isolés déjà rattrapés, jamais celle d’un défaut qui dure.',
    ],
    docs: ['docs/conversations-instagram.md', 'lib/instagram-webhook-processor.ts'],
  },
  {
    cle: 'sante_stockage_fichiers',
    source: 'stockage_fichiers_sante',
    titre: 'Le stockage de fichiers approche du plafond',
    detection: 'alerte',
    surveille:
      'Le quota de FICHIERS du plan Supabase — 1 Go sur le gratuit — partagé par tous les buckets : avatars, vignettes, ressources, dépôts, vocaux de la messagerie, et messages vocaux Instagram.',
    signifie:
      '⚠️ C’est un quota SÉPARÉ de celui de la base, que surveille `base_sante_taille`. Aucune vue ne le regardait jusqu’au 2026-09-04, date à laquelle les messages vocaux Instagram ont commencé à être stockés — Meta refuse de les resservir après coup, donc c’est stocker ou perdre. Quand le gigaoctet est plein, les envois de fichiers échouent, en silence comme tout plafond. Le seuil de 70 % laisse environ trois semaines de préavis, parce que la rétention de 30 jours met un mois à atteindre son équilibre.',
    quoiFaire: [
      '`select * from stockage_fichiers_sante;` — la colonne `principaux_buckets` dit qui pèse.',
      'Si ce sont les vocaux Instagram (`ig-vocaux`) : soit passer Supabase en Pro (100 Go), soit raccourcir la rétention dans `app/api/instagram/purger-vocaux/route.ts` (RETENTION_JOURS).',
      'Dimensionnement mesuré le 2026-09-04 : 88 Ko par vocal, donc le gigaoctet tient jusqu’à ~9 vocaux par élève et par jour à 40 élèves.',
      '⚠️ Ne PAS purger en supprimant des lignes de `storage.objects` : ça vide l’index sans supprimer les octets, et le quota continue de monter pendant que la table dit le contraire. Seule l’API de stockage supprime réellement.',
    ],
    docs: ['docs/conversations-instagram.md', 'app/api/instagram/purger-vocaux/route.ts'],
  },
  {
    cle: 'sante_ig_dm',
    source: 'ig_dm_sante',
    titre: 'Les conversations Instagram ne se collectent plus, ou ne se purgent plus',
    detection: 'toute_ligne',
    surveille:
      'Que les DM Instagram des élèves qui ont donné leur accord continuent d’être enregistrés, que la reprise d’historique se termine, et que la quarantaine de 30 jours se vide bien.',
    signifie:
      '⚠️ Trois pannes très différentes derrière la même vue, la colonne `etat` les distingue. « collecte muette » : le webhook n’écrit plus, donc le coach voit des fils qui s’arrêtent net — et comme la rétention purge, la donnée manquante devient irrécupérable. « backfill bloque » / « backfill jamais demarre » : l’élève a donné son accord et son coach voit un écran vide, sans que rien ne le signale. « purge muette » : la quarantaine ne se vide plus, donc les conversations privées de l’élève restent stockées au-delà de ce qui lui a été annoncé, et la base grossit sans borne.',
    quoiFaire: [
      '`select * from ig_dm_sante;` — la colonne `sujet` donne le `profile_id` concerné.',
      '« collecte muette » : le signal repose sur un fait solide — un lead servi implique un DM parti, donc un echo, donc un message stocké. Vérifier d’abord que le worker tourne (`select * from crons_sante where nom like \'%webhook%\'`), puis que `enregistrer_message_ig` n’a pas été modifiée pour rendre `null` (elle rend `null` quand l’accord manque, c’est normal).',
      '« backfill jamais demarre » : le réveil part de la route de consentement. Relancer à la main `POST /api/instagram/backfill-conversations` avec le `profile_id`.',
      '« purge muette » : `select * from cron.job where jobname = \'purge-ig-messages-daily\';` puis `select public.purge_ig_messages();` à la main pour voir l’erreur.',
      '⚠️ Ne PAS « corriger » une collecte muette en désactivant la garde d’accord dans `enregistrer_message_ig`. Sans accord, l’absence de messages est le comportement attendu — et la vue ne regarde que les élèves qui ont accordé.',
    ],
    docs: [
      'docs/conversations-instagram.md',
      'supabase/migrations/20260904181000_conversations_instagram_purges_sante.sql',
    ],
  },
];

function promptClaudeCode(s: Surveillance, nb: number): string {
  return [
    `Dans le projet Momentum (${DOSSIER}), la vue de santé \`${s.source}\` alerte avec ${nb} ligne${nb > 1 ? 's' : ''}.`,
    ``,
    `Ce qu'elle surveille : ${s.surveille}`,
    `Ce que l'alerte veut dire : ${s.signifie}`,
    ``,
    `Commence par lire orbit/AGENTS.md en entier, puis ${s.docs.join(' et ')}.`,
    `Projet Supabase : ${PROJET_SUPABASE}.`,
    ``,
    `Établis la cause AVANT de proposer quoi que ce soit :`,
    ...s.quoiFaire.map((q) => `  - ${q}`),
    ``,
    `Ne corrige pas de données sans m'avoir montré, ligne par ligne, ce que la correction`,
    `changerait. Et si tu poses une nouvelle surveillance, qu'elle vérifie une conséquence`,
    `de la règle, jamais une réimplémentation de la règle.`,
  ].join('\n');
}

function corpsEmail(s: Surveillance, nb: number, apercu: string): string {
  const prompt = promptClaudeCode(s, nb);
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;line-height:1.55;color:#1a1815;max-width:640px">
  <p style="font-size:17px;font-weight:600;margin:0 0 4px">${s.titre}</p>
  <p style="margin:0 0 18px;color:#797569;font-size:13px">
    ${nb} ligne${nb > 1 ? 's' : ''} dans <code>${s.source}</code>. Cette alerte n'est envoyée qu'une fois ;
    elle se réarmera d'elle-même quand la vue redeviendra propre.
  </p>

  <p style="margin:0 0 6px"><strong>Ce que cette surveillance vérifie</strong></p>
  <p style="margin:0 0 18px">${s.surveille}</p>

  <p style="margin:0 0 6px"><strong>Ce que l'alerte veut dire</strong></p>
  <p style="margin:0 0 18px">${s.signifie}</p>

  <p style="margin:0 0 6px"><strong>Ce qu'on voit en base</strong></p>
  <pre style="margin:0 0 18px;padding:12px 14px;background:#f7f5f0;border:1px solid #eeeae0;border-radius:8px;font-size:12px;line-height:1.5;overflow-x:auto;white-space:pre-wrap">${apercu}</pre>

  <p style="margin:0 0 6px"><strong>Quoi faire, dans l'ordre</strong></p>
  <ol style="margin:0 0 18px;padding-left:20px">
    ${s.quoiFaire.map((q) => `<li style="margin:0 0 6px">${q}</li>`).join('')}
  </ol>

  <p style="margin:0 0 6px"><strong>À coller directement dans Claude Code</strong></p>
  <p style="margin:0 0 8px;color:#797569;font-size:13px">
    Ouvre un terminal dans <code>${DOSSIER}</code>, lance <code>claude</code>, et colle ceci :
  </p>
  <pre style="margin:0 0 18px;padding:14px 16px;background:#1a1815;color:#f0ede6;border-radius:8px;font-size:12px;line-height:1.6;overflow-x:auto;white-space:pre-wrap">${prompt
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>

  <p style="margin:0 0 6px"><strong>Où est le contexte complet</strong></p>
  <p style="margin:0 0 18px">${s.docs.map((d) => `<code>orbit/${d}</code>`).join('<br>')}</p>

  <p style="margin:0;padding-top:14px;border-top:1px solid #eeeae0;color:#797569;font-size:11px">
    Pour tout revoir toi-même : la liste complète des vues de santé est en tête d'<code>orbit/AGENTS.md</code>.<br>
    ⚠️ Sur ces vues, <code>etat &lt;&gt; 'ok'</code> n'est jamais un filtre d'anomalie — plusieurs états
    sont légitimes. Toujours <code>etat like 'ALERTE%'</code>.<br>
    Base Supabase : <code>${PROJET_SUPABASE}</code>.
  </p>
</div>`;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  // ── Mode « manifeste seulement » ────────────────────────────────────────────
  //
  // `?manifeste=1` recopie les deux inventaires du dépôt en base et s'arrête là :
  // aucune lecture de vue, aucun e-mail.
  //
  // ⚠️ POURQUOI IL EXISTE. Les deux surveillances de cohérence dépôt ↔ base comparent
  // un état VIVANT (ce qui tourne, ce qui est appliqué) à un INSTANTANÉ du dépôt. Tant
  // que cet instantané n'était réécrit qu'une fois par jour, tout ce qui bougeait après
  // ce passage — un déploiement d'Edge Function, une migration — faisait crier les vues
  // jusqu'au lendemain matin. Mesuré le 2026-09-04 : cinq lignes en alerte, **toutes
  // fausses**, alors que la fonction en ligne et les cinq fichiers correspondaient
  // exactement au dépôt.
  //
  // L'e-mail, lui, ne se trompait pas : il réécrit l'instantané avant de lire. Mais une
  // vue qui ment en journée finit par ne plus être ouverte, et c'est précisément le mode
  // de panne que ces surveillances existent pour fermer.
  //
  // `poll-leads` l'appelle une fois par heure. La fenêtre de mensonge passe de 24 heures
  // à une heure, pour 24 appels très légers par jour au lieu d'un — pas de lecture de
  // vue, pas de Resend, pas de table d'alertes.
  const manifesteSeulement = new URL(request.url).searchParams.get('manifeste') === '1';

  const { data: dejaEnvoyees } = manifesteSeulement
    ? { data: [] as { cle: string }[] }
    : await supabase.from('alertes_plateforme').select('cle');
  const envoyees = new Set((dejaEnvoyees ?? []).map((a: any) => a.cle));

  const resultats: Record<string, string> = {};
  const aRearmer: string[] = [];

  // ── L'empreinte du dépôt, inscrite en base AVANT toute lecture de vue ─────────
  //
  // `edge_sante_version` compare l'empreinte que chaque Edge Function remonte à celle
  // du dépôt. La base ne peut pas lire le dépôt : c'est cette route qui fait le pont,
  // et elle le fait ici plutôt qu'ailleurs pour une raison précise — Vercel la
  // reconstruit à chaque push, et `npm run prebuild` recalcule les empreintes à chaque
  // construction. La valeur inscrite est donc TOUJOURS celle du dépôt poussé, sans que
  // personne ne l'entretienne.
  //
  // ⚠️ AVANT la boucle, pas après : la vue est lue quelques lignes plus bas. L'écrire
  // ensuite ferait comparer, au premier passage suivant un déploiement, l'empreinte du
  // jour à celle de la veille — une fausse alerte à chaque mise à jour de la
  // plateforme, c'est-à-dire une alerte qu'on n'ouvre plus.
  //
  // ⚠️ Un échec d'écriture est SIGNALÉ, pas avalé. Sans ça, la table resterait sur ses
  // anciennes valeurs et la vue dirait « ok » en comparant deux fois du périmé — le
  // mode de panne exact que cette surveillance est censée fermer.
  const { error: erreurEmpreintes } = await supabase
    .from('edge_empreintes_attendues')
    .upsert(
      Object.entries(EMPREINTES_EDGE).map(([nom, empreinte]) => ({
        nom, empreinte, mis_a_jour_le: new Date().toISOString(),
      })),
      { onConflict: 'nom' },
    );
  if (erreurEmpreintes) {
    resultats['empreintes_edge'] = `inscription impossible: ${erreurEmpreintes.message}`;
  }

  // ── La liste des migrations du dépôt, même pont et mêmes raisons ─────────────
  //
  // La base ne peut pas lire `supabase/migrations/`. `migrations_sante` compare ce
  // qu'elle a enregistré à ce que le dépôt contient — encore faut-il le lui dire.
  //
  // ⚠️ Le `delete` compte autant que le `upsert` : sans lui, un fichier renommé ou
  // supprimé laisserait sa ligne, et la vue le signalerait éternellement comme
  // « fichier jamais appliqué ». Une alerte permanente est une alerte qu'on n'ouvre plus.
  // Il vient APRÈS, pour qu'une panne au milieu laisse des lignes en trop plutôt qu'une
  // table vide — trop de lignes fait crier à tort, une table vide ferait taire.
  const nomsDepot = MIGRATIONS_DEPOT.map(m => m.nom);
  const { error: erreurMigrations } = await supabase
    .from('migrations_du_depot')
    .upsert(
      MIGRATIONS_DEPOT.map(m => ({ ...m, mis_a_jour_le: new Date().toISOString() })),
      // ⚠️ Sur le NOM : cinq horodatages de fichiers sont en double dans le dépôt.
      { onConflict: 'nom' },
    );
  if (erreurMigrations) {
    resultats['migrations_depot'] = `inscription impossible: ${erreurMigrations.message}`;
  } else if (nomsDepot.length) {
    const { error: erreurMenage } = await supabase
      .from('migrations_du_depot')
      .delete()
      .not('nom', 'in', `(${nomsDepot.join(',')})`);
    if (erreurMenage) {
      resultats['migrations_depot'] = `menage impossible: ${erreurMenage.message}`;
    }
  }

  // Le pont est fait : en mode manifeste on s'arrête avant toute lecture de vue.
  if (manifesteSeulement) {
    return NextResponse.json({
      manifeste: true,
      empreintes: Object.keys(EMPREINTES_EDGE).length,
      migrations: MIGRATIONS_DEPOT.length,
      ...resultats,
    });
  }

  for (const s of SURVEILLANCES) {
    const { data, error } = await supabase.from(s.source).select('*').limit(2000);

    // ⚠️ Une erreur de lecture ne doit PAS être traitée comme « aucune anomalie ».
    // Une vue supprimée ou renommée rendrait toutes les alertes muettes en silence,
    // ce qui est exactement le contraire du but. On le signale, et on n'efface
    // surtout pas la mémoire d'une alerte déjà envoyée.
    if (error) {
      resultats[s.cle] = `illisible: ${error.message}`;
      continue;
    }

    const lignes = (data ?? []) as any[];
    const anomalies = s.detection === 'toute_ligne'
      ? lignes
      : lignes.filter((l) => typeof l.etat === 'string' && (l.etat.startsWith('ALERTE') || l.etat.startsWith('SILENCIEUX')));

    if (anomalies.length === 0) {
      if (envoyees.has(s.cle)) aRearmer.push(s.cle);
      resultats[s.cle] = 'ok';
      continue;
    }
    if (envoyees.has(s.cle)) { resultats[s.cle] = `deja_envoye (${anomalies.length})`; continue; }

    const apercu = anomalies.slice(0, 5)
      .map((l) => JSON.stringify(l, null, 1).replace(/[{}"]/g, '').trim())
      .join('\n\n') + (anomalies.length > 5 ? `\n\n… et ${anomalies.length - 5} autre(s).` : '');

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      resultats[s.cle] = 'RESEND_API_KEY manquant';
      continue;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'Momentum <noreply@ubizenai.com>',
        to: 'christianpenkov06@gmail.com',
        subject: `Momentum — ${s.titre}`,
        html: corpsEmail(s, anomalies.length, apercu),
      }),
    });

    // On n'inscrit la clé comme « envoyée » que si Resend a accepté. Sinon un échec
    // réseau condamnerait l'alerte au silence définitif.
    if (!res.ok) {
      resultats[s.cle] = `resend_${res.status}`;
      continue;
    }

    await supabase.from('alertes_plateforme').upsert({
      cle: s.cle,
      envoyee_le: new Date().toISOString(),
      contexte: `${s.source} : ${anomalies.length} ligne(s)`,
    }, { onConflict: 'cle' });
    resultats[s.cle] = `envoye (${anomalies.length})`;
  }

  // Réarmement : la vue est redevenue propre, l'alerte pourra resservir.
  if (aRearmer.length) {
    await supabase.from('alertes_plateforme').delete().in('cle', aRearmer);
  }

  return NextResponse.json({ ok: true, resultats, rearmees: aRearmer });
}
