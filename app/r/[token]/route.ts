import { after } from 'next/server';
import {
  construireDestination,
  champsDuClic,
  genererClickId,
  motifRobot,
  empreinteIp,
  selDuJour,
  HOTES_AUTORISES,
  CLE_HOTE_PAR_DEFAUT,
} from '@/lib/click-redirect';

/**
 * Route de redirection qui pose le Click ID sur les liens Calendly PARTAGÉS.
 *
 *   lien Short.io → /r/<chemin>?utm_…&d=<chemin Calendly>&p=<profil>
 *                 → 302 → calendly.com/<chemin>?utm_…&salesforce_uuid=<click_id>
 *
 * Trois règles gouvernent ce fichier. Aucune n'est négociable :
 *
 * 1. **Fail-open absolu.** La redirection part TOUJOURS. Aucune attente bloquante,
 *    aucune lecture en base sur le chemin normal : la destination se déduit
 *    entièrement de l'URL. Une panne de la base ne peut donc pas empêcher un
 *    prospect de réserver un rendez-vous.
 *
 * 2. **Jamais d'erreur affichée.** Un prospect qui voit une page d'erreur est un
 *    rendez-vous perdu. Tous les chemins d'échec redirigent.
 *
 * 3. **Pas d'open redirect.** L'hôte de destination n'est jamais dans l'URL : il
 *    est écrit en dur dans `HOTES_AUTORISES`. `d` ne porte que le chemin.
 *
 * L'échec d'écriture de la ligne de clic n'est pas silencieux pour autant : c'est
 * `clics_sante_redirection` qui le voit, en comparant ce compteur à celui de
 * Short.io. On ne peut pas journaliser une panne de base dans la base — c'est
 * précisément ce que le second compteur existe pour couvrir.
 *
 * Voir docs/click-id.md.
 */

// Runtime edge : démarrage à froid négligeable sur un saut de redirection, et le
// prospect attend cette réponse. `after()` y fonctionne (waitUntil de la plateforme).
export const runtime = 'edge';
// Chaque clic doit être compté : une réponse mise en cache ne passerait pas ici.
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function redirige(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      // Un 302 mis en cache ferait disparaître les clics suivants du compteur.
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      // Ne pas transmettre l'URL de provenance à Calendly : elle porte le Click ID
      // et les UTM, qui ne regardent que nous.
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/**
 * Repli quand `d` est absent ou malformé — un lien fabriqué à la main, ou une
 * destination Short.io éditée hors de la plateforme.
 *
 * C'est le SEUL endroit où la route lit la base, et c'est assumé : sur ce chemin
 * il n'y a de toute façon pas de destination à construire, donc l'indisponibilité
 * de la base ne dégrade rien qui fonctionnait.
 */
async function calendlyDuCoach(profileId: string | null): Promise<string | null> {
  if (!profileId || !SUPABASE_URL || !SERVICE_KEY) return null;
  const entetes = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  try {
    // Le coach porte son Calendly sur `profiles`, l'élève sur `clients` — même
    // règle que `getCalendlyUrl` dans app/api/client/story-sequences/route.ts.
    for (const requete of [
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}&select=calendly_url`,
      `${SUPABASE_URL}/rest/v1/clients?profile_id=eq.${profileId}&select=calendly_url`,
    ]) {
      const res = await fetch(requete, { headers: entetes });
      if (!res.ok) continue;
      const lignes = await res.json();
      const url = lignes?.[0]?.calendly_url;
      if (typeof url === 'string' && url.startsWith(HOTES_AUTORISES[CLE_HOTE_PAR_DEFAUT])) return url;
    }
  } catch {
    // Fail-open : on redirigera vers l'hôte par défaut plutôt que d'échouer.
  }
  return null;
}

async function enregistrerLeClic(ligne: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/link_clicks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(ligne),
  }).catch(() => {
    // Volontairement avalé : la redirection est déjà partie, et il n'y a rien de
    // plus à tenter. L'écart remonte dans clics_sante_redirection.
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const parametres = new URL(request.url).searchParams;

  // `p` vient de l'URL, donc de l'extérieur : une valeur qui n'a pas la forme d'un
  // identifiant ne part pas jusqu'à la base. La clé étrangère refuserait de toute
  // façon la ligne, mais autant ne pas émettre la requête.
  const pBrut = parametres.get('p');
  const profileId = pBrut && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pBrut)
    ? pBrut
    : null;
  const clickId = genererClickId();
  const destination = construireDestination(parametres, clickId);

  // ── Repli : rien à construire depuis l'URL ────────────────────────────────
  if (!destination) {
    const repli = await calendlyDuCoach(profileId);
    // Dernier recours : l'hôte de la liste blanche. Le prospect atterrit sur une
    // page qui existe, jamais sur une erreur.
    return redirige(repli ?? HOTES_AUTORISES[CLE_HOTE_PAR_DEFAUT]);
  }

  // ── Le chemin normal : on répond AVANT d'écrire quoi que ce soit ──────────
  const userAgent = request.headers.get('user-agent');
  const secPurpose = request.headers.get('sec-purpose');
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
  const maintenant = new Date();

  if (profileId) {
    after(async () => {
      const { platform, medium, content_id } = champsDuClic(parametres);
      // Le motif est écrit à côté du verdict : sans lui, une sur-détection ou une
      // sous-détection ne se diagnostique plus après coup.
      const motif = motifRobot(userAgent, secPurpose);
      await enregistrerLeClic({
        id: clickId,
        profile_id: profileId,
        occurred_at: maintenant.toISOString(),
        link_path: token,
        platform,
        medium,
        content_id,
        // Marqué, jamais jeté : sans la ligne, impossible de mesurer le bruit ni
        // d'expliquer un écart avec le compteur de Short.io.
        is_bot: motif !== 'aucune',
        bot_motif: motif,
        ip_hash: await empreinteIp(ip, process.env.CLICK_IP_HASH_SECRET, selDuJour(maintenant)),
      });
    });
  }

  return redirige(destination);
}
