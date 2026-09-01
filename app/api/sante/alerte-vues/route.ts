import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
  {
    cle: 'sante_ventes_sur_encaissement',
    source: 'ventes_sante_sur_encaissement',
    titre: 'Une vente a encaissé plus que son montant contracté',
    detection: 'toute_ligne',
    surveille: 'Qu’aucun deal n’ait reçu plus d’argent qu’il n’en a contracté.',
    signifie:
      'Un trop-perçu fait dépasser 100 % de collecte, et dans les totaux il vient effacer la dette d’un autre client. C’est le garde-fou du cash, celui qui rattrape ce qu’aucune garde à l’écriture n’attrape.',
    quoiFaire: [
      '`select * from ventes_sante_sur_encaissement;`',
      'Vérifier si un paiement a été rattaché au mauvais deal, ou si le montant contracté a été révisé à la baisse après coup.',
      'Ne jamais sommer des paiements à la main pour trancher : `lib/dealCash.ts` porte la règle unique.',
    ],
    docs: ['docs/stripe-paiements.md', 'lib/dealCash.ts'],
  },
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
    titre: 'Un cron s’est tu',
    detection: 'alerte',
    surveille:
      'Que chaque cron inscrit laisse une trace de passage, succès OU échec, dans le délai qui lui est propre.',
    signifie:
      'Un cron qui ne tourne plus n’échoue pas : il se tait, et un silence ne se distingue pas d’un succès. C’est la panne la plus coûteuse de la plateforme parce qu’elle est la plus discrète — les données cessent simplement d’arriver, et personne ne le voit avant des semaines.',
    quoiFaire: [
      '`select * from crons_sante;`',
      'Ouvrir le job correspondant sur cron-job.org et regarder ses derniers passages et son URL.',
      '⚠️ Les crons vivent à DEUX endroits : pg_cron dans la base (`select jobname, schedule, active from cron.job;`) et cron-job.org. Le tableau de correspondance est dans AGENTS.md.',
    ],
    docs: ['AGENTS.md, section « Les crons vivent à DEUX endroits »'],
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
    cle: 'sante_cron_runs',
    source: 'cron_runs',
    titre: 'Un cron a échoué de façon actionnable',
    detection: 'toute_ligne',
    surveille:
      'Les échecs de cron qui demandent une action. Les incidents passagers et auto-réparés en sont volontairement absents.',
    signifie:
      'Le contrat de cette table est « vide = aucun incident ». Une ligne veut donc dire qu’un traitement a échoué et ne se réparera pas tout seul. ⚠️ Ne jamais y ajouter d’incident auto-réparé : le jour où elle contient des lignes qu’on ne peut pas traiter, on prend l’habitude de ne plus la lire, et elle ne sert plus le jour d’un vrai incident.',
    quoiFaire: [
      '`select fonction, ran_at, erreurs from cron_runs order by ran_at desc;`',
      'Elle se purge d’elle-même à 30 jours.',
      'Si l’erreur est en réalité passagère et se répare seule, la classer dans `estIncidentPassager` (poll-leads) ET poser une vue qui surveille sa conséquence — jamais l’une sans l’autre.',
    ],
    docs: ['AGENTS.md, section Santé de la plateforme'],
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

  const { data: dejaEnvoyees } = await supabase.from('alertes_plateforme').select('cle');
  const envoyees = new Set((dejaEnvoyees ?? []).map((a: any) => a.cle));

  const resultats: Record<string, string> = {};
  const aRearmer: string[] = [];

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
