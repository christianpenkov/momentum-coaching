/**
 * L'envoi des e-mails d'alerte de la plateforme — une seule règle, un seul endroit.
 *
 * ── Pourquoi ce module existe ──────────────────────────────────────────────────────
 *
 * Jusqu'au 2026-09-12, l'expéditeur ET le destinataire étaient écrits **en dur** dans
 * les trois routes qui alertent :
 *
 *     from: 'Momentum <noreply@ubizenai.com>'
 *     to:   'christianpenkov06@gmail.com'
 *
 * Le jour de la livraison, le repreneur n'aurait donc reçu AUCUNE alerte : tout le
 * dispositif dont AGENTS.md dit « aucune de ces vues n'a besoin d'être regardée,
 * l'e-mail prévient » serait resté aveugle pour lui — et personne ne s'en serait
 * aperçu, puisque les e-mails auraient continué d'arriver chez le développeur.
 *
 * ⚠️ C'est le mode de panne le plus vicieux d'une surveillance : elle ne tombe pas en
 * panne, elle change de destinataire. Rien n'échoue, rien n'alerte sur l'alerte.
 *
 * ── Aucun repli silencieux ─────────────────────────────────────────────────────────
 *
 * Les deux adresses viennent de l'environnement et **n'ont pas de valeur par défaut**,
 * délibérément — même raison que `MOMENTUM_REDIRECT_ORIGIN` (docs/click-id.md) : un
 * repli inscrirait une adresse que personne n'a décidée, et le jour du transfert on
 * enverrait les alertes du repreneur à l'ancien propriétaire sans qu'aucun réglage ne
 * l'ait dit.
 *
 * Config absente ⇒ on N'ENVOIE PAS, et on dit pourquoi dans la réponse de la route.
 * ⚠️ Corrigé le 2026-09-13 : ce commentaire affirmait que l'alerte « reste tracée dans
 * `alertes_plateforme` ». C'était faux — la clé n'y est inscrite QU'APRÈS un envoi
 * réussi, précisément pour que l'alerte reparte au passage suivant. Ce qui rend
 * désormais un canal cassé visible, c'est `sonderCanalAlerte()` ci-dessous et le
 * battement externe de `/api/sante/dispatch`.
 *
 * ⚠️ Corollaire à tenir : poser les variables sur Vercel AVANT de déployer ce module,
 * sinon les alertes se taisent le temps d'un déploiement.
 */

/**
 * À qui l'alerte s'adresse — et le critère est **qui peut agir**, pas la gravité.
 *
 *  `technique`    : seul un développeur peut faire quelque chose (un cron s'est tu, la
 *                   fonction en ligne n'est pas celle du dépôt, une migration diverge,
 *                   une relation est lisible sans RLS, la base approche du plafond).
 *                   Reste chez le mainteneur, même après la livraison.
 *
 *  `exploitation` : le COACH doit agir sur son élève (« Instagram déconnecté — X » :
 *                   il faut le relancer pour qu'il reconnecte). Ça n'a rien de
 *                   technique, et envoyer ça au développeur après la livraison ferait
 *                   que personne ne relancerait jamais l'élève.
 *
 * ⚠️ Les deux peuvent pointer sur la même adresse aujourd'hui, et c'est le cas avant la
 * livraison. Ce qui compte est que la DISTINCTION existe : le jour du transfert, seule
 * `exploitation` change de destinataire, et ça ne demande aucune modification de code.
 */
export type DestinationAlerte = 'technique' | 'exploitation';

export interface ResultatEnvoi {
  envoye: boolean;
  /** Renseigné seulement si `envoye` est faux — à journaliser tel quel. */
  raison?: string;
}

/**
 * Envoie un e-mail d'alerte via Resend.
 *
 * ⚠️ Ne lève jamais : une alerte qui plante la route qui l'émet empêcherait les
 * alertes SUIVANTES de partir. On rend la raison, l'appelant décide quoi en faire.
 */
export async function envoyerAlerte(
  sujet: string,
  html: string,
  destination: DestinationAlerte,
): Promise<ResultatEnvoi> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { envoye: false, raison: 'RESEND_API_KEY manquant' };

  const expediteur = process.env.ALERTES_EMAIL_EXPEDITEUR;
  if (!expediteur) return { envoye: false, raison: 'ALERTES_EMAIL_EXPEDITEUR manquant' };

  const cle = destination === 'technique' ? 'ALERTES_EMAIL_TECHNIQUE' : 'ALERTES_EMAIL_EXPLOITATION';
  const destinataire = process.env[cle];
  if (!destinataire) return { envoye: false, raison: `${cle} manquant` };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: expediteur, to: destinataire, subject: sujet, html }),
    });
    if (!res.ok) {
      // Le corps de la réponse porte le motif réel (domaine non vérifié, quota…) :
      // le perdre transformerait un diagnostic en devinette.
      const detail = await res.text().catch(() => '');
      return { envoye: false, raison: `Resend HTTP ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}` };
    }
    return { envoye: true };
  } catch (e) {
    return { envoye: false, raison: `Resend injoignable — ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Le canal d'alerte fonctionne-t-il ENCORE ? Rend `null` si oui, la raison sinon.
 *
 * ── Pourquoi une sonde ─────────────────────────────────────────────────────────────
 *
 * Une clé Resend révoquée, un domaine qui perd sa vérification, un quota épuisé : dans
 * les trois cas, TOUTES les alertes se taisent, et on ne l'apprend qu'au moment où l'une
 * d'elles devait partir — c'est-à-dire trop tard. Relevé par l'audit du 2026-09-13 : un
 * échec d'envoi n'était écrit nulle part.
 *
 * La sonde envoie donc un vrai e-mail, une fois par jour, à l'adresse de test officielle
 * `delivered@resend.dev` (resend.com/docs/dashboard/emails/send-test-emails) : il ne
 * sort pas de chez Resend, mais il exerce la clé, l'expéditeur et le quota exactement
 * comme une alerte. Il compte dans le quota (1/jour sur 100).
 *
 * ⚠️ La doc ne dit pas si cette adresse exige un domaine VÉRIFIÉ. On lit donc aussi
 * l'état du domaine quand la clé y a accès (`GET /domains`). Une clé « envoi seulement »
 * y répond 401/403 : ce n'est pas une panne, la sonde d'envoi reste alors le seul signal.
 *
 * Qui prévient si la sonde échoue ? Pas Resend, par construction : c'est le battement
 * externe (`/api/sante/dispatch` → healthchecks.io), qui cesse d'être envoyé.
 */
export async function sonderCanalAlerte(): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return 'RESEND_API_KEY manquant';
  const expediteur = process.env.ALERTES_EMAIL_EXPEDITEUR;
  if (!expediteur) return 'ALERTES_EMAIL_EXPEDITEUR manquant';
  if (!process.env.ALERTES_EMAIL_TECHNIQUE) return 'ALERTES_EMAIL_TECHNIQUE manquant';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: expediteur,
        to: 'delivered@resend.dev',
        subject: 'Momentum — sonde quotidienne du canal d’alerte',
        html: '<p>Envoi automatique de contrôle. Il ne quitte pas Resend.</p>',
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return `Resend refuse l’envoi (HTTP ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ''})`;
    }
  } catch (e) {
    return `Resend injoignable — ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    const domaine = expediteur.match(/@([^>\s]+)/)?.[1]?.toLowerCase();
    if (!domaine) return null;
    const res = await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null; // clé « envoi seulement » : pas une panne
    const json = await res.json() as { data?: { name?: string; status?: string }[] };
    const d = (json.data ?? []).find((x) => x.name?.toLowerCase() === domaine);
    if (d && d.status && d.status !== 'verified') {
      return `Le domaine d’envoi ${domaine} n’est plus vérifié chez Resend (statut : ${d.status}) — les alertes vers une autre adresse que celle du compte sont refusées`;
    }
  } catch {
    // Lecture de l'état du domaine impossible : l'envoi a réussi, on ne conclut rien de plus.
  }
  return null;
}
