import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { signalerIncident } from '@/lib/incidents';
import {
  classerReponseSupabase, estBruitNavigateur, nettoyerCorps, nettoyerUrl, normaliserMessage, tronquer,
} from '@/lib/incidentsClassement';

// POST /api/sante/incident-client
//
// Reçoit les pannes que seul le navigateur voit (lib/incidentsNavigateur.ts) et les
// écrit comme incidents.
//
// ── Rien de ce qui arrive ici n'est cru sur parole ─────────────────────────────────
//
// N'importe qui peut poster sur cette route. Donc :
//   · la gravité et l'empreinte sont calculées ICI, jamais reçues ;
//   · une requête Supabase rapportée est RECLASSÉE par la même règle que côté serveur ;
//   · un appelant sans session ne peut produire qu'un incident `normale` — il ne peut
//     pas déclencher d'e-mail immédiat ;
//   · la taille est bornée et le débit limité par adresse, pour qu'un robot ne puisse
//     pas remplir la base (plan gratuit : lecture seule à 500 Mo). La RPC a en plus sa
//     propre garde de débordement.
//
// Pourquoi la route accepte quand même les appels SANS session : un écran de connexion
// qui plante est précisément le cas où personne n'a de session. `/api/client-log` exige
// une session, et c'est juste pour lui — il écrit du journal brut, pas un incident borné.
//
// Répond toujours 204 : le navigateur n'a rien à apprendre de ce qui a été retenu.

const TAILLE_MAX = 16_000;
const PAR_MINUTE = 30;
const debits = new Map<string, { debut: number; n: number }>();

function autorise(cle: string): boolean {
  const maintenant = Date.now();
  const d = debits.get(cle);
  if (!d || maintenant - d.debut > 60_000) {
    if (debits.size > 2_000) debits.clear();
    debits.set(cle, { debut: maintenant, n: 1 });
    return true;
  }
  d.n++;
  return d.n <= PAR_MINUTE;
}

/** Un chemin d'écran sans ses identifiants : `/clients/<id>/stats`, pas un uuid par élève. */
function cheminStable(chemin: unknown): string {
  return String(chemin ?? '').split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\/\d+(?=\/|$)/g, '/<n>')
    .slice(0, 200);
}

const texte = (v: unknown, max: number) => (v == null ? null : tronquer(String(v), max));

export async function POST(request: Request) {
  const vide = new NextResponse(null, { status: 204 });
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'inconnue';
    if (!autorise(ip)) return vide;

    const brut = await request.text();
    if (!brut || brut.length > TAILLE_MAX) return vide;
    let s: Record<string, unknown>;
    try { s = JSON.parse(brut); } catch { return vide; }
    if (!s || typeof s !== 'object') return vide;

    let utilisateur: string | null = null;
    try {
      const supabase = await createServerClient();
      const { data } = await supabase.auth.getUser();
      utilisateur = data.user?.id ?? null;
    } catch { /* sans session : incident `normale` au plus */ }

    const chemin = cheminStable(s.chemin);
    const contexte = {
      chemin_ecran: texte(s.chemin, 300),
      utilisateur,
      navigateur: texte(request.headers.get('user-agent'), 300),
    };

    if (s.type === 'supabase') {
      const methode = String(s.methode ?? 'GET').toUpperCase().slice(0, 10);
      const url = String(s.url ?? '');
      const statut = Number(s.statut);
      const corps = typeof s.corps === 'string' ? s.corps : null;
      const c = classerReponseSupabase({ methode, url, statut, corps });
      if (!c) return vide;
      const action = c.service === 'rpc' ? `rpc ${c.cible}()` : `${methode} ${c.cible}`;
      await signalerIncident({
        source: 'vercel-navigateur',
        gravite: utilisateur ? c.gravite : 'normale',
        titre: `Base refusée depuis l’écran ${chemin} — ${action} : ${c.message.slice(0, 120)}`,
        empreinte: ['navigateur-supabase', c.service, c.cible, methode, c.code, chemin, normaliserMessage(c.message)],
        detail: {
          type: 'supabase_refus_navigateur',
          methode, statut, url: nettoyerUrl(url),
          code: c.code, message: c.message, details: c.details, hint: c.hint,
          corps_reponse: nettoyerCorps(corps),
          ...contexte,
        },
      });
      return vide;
    }

    if (s.type === 'rendu' || s.type === 'fenetre' || s.type === 'promesse') {
      const message = String(s.message ?? '');
      if (s.type !== 'rendu' && estBruitNavigateur(message, typeof s.fichier === 'string' ? s.fichier : null)) return vide;
      const nom = texte(s.nom, 100);
      const libelle = s.type === 'rendu'
        ? (s.globale ? 'Plateforme entière en erreur' : 'Écran en erreur')
        : s.type === 'fenetre' ? 'Erreur JavaScript' : 'Promesse rejetée non gérée';
      await signalerIncident({
        source: 'vercel-navigateur',
        // Un écran qui affiche sa page d'erreur est cassé pour la personne qui le
        // regarde : critique. Une exception isolée qui ne casse rien de visible :
        // normale, dans le récapitulatif du matin.
        gravite: s.type === 'rendu' && utilisateur ? 'critique' : 'normale',
        titre: `${libelle} — ${chemin} : ${message.slice(0, 140)}`,
        empreinte: ['navigateur', s.type, chemin, nom, normaliserMessage(message)],
        detail: {
          type: `navigateur_${s.type}`,
          erreur: {
            nom,
            message: tronquer(message, 2_000),
            pile: texte(s.pile, 4_000),
            digest: texte(s.digest, 100),
            fichier: texte(s.fichier, 300),
            ligne: typeof s.ligne === 'number' ? s.ligne : null,
            colonne: typeof s.colonne === 'number' ? s.colonne : null,
          },
          ...contexte,
        },
      });
    }
  } catch {
    // Jamais d'erreur rendue au navigateur : il est déjà en train de signaler une panne.
  }
  return vide;
}
