import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';

/**
 * Santé des 7 intégrations obligatoires d'un élève.
 *
 * Une seule source : la vue `integrations_sante` (migration 20260829190000), qui
 * réunit la table `integrations` et les trois vues de fraîcheur. Rien n'est
 * recalculé ici — ni la liste des providers, ni les seuils de retard. Un écran qui
 * les redéciderait serait la copie suivante d'une règle qui doit valoir partout
 * pareil.
 *
 * Passe par la clé service et non par la RLS : la vue s'appuie sur trois vues
 * imbriquées (ig/yt/shortio_sante_donnees) qui, elles, ne sont pas en
 * `security_invoker`. L'autorisation est donc faite ici, explicitement, avec le
 * même `resolveTargetProfile` que les routes de paiement — un coach ne lit que ses
 * propres élèves, un élève que lui-même.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type IntegrationSante = {
  provider: string;
  libelle: string;
  connectee: boolean;
  connected_at: string | null;
  statut: string;
  erreur: string | null;
  derniere_donnee: string | null;
  retard_jours: number | null;
  etat_collecte: string | null;
  etat: 'non_connectee' | 'en_echec' | 'collecte_degradee' | 'ok';
};

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const demande = request.nextUrl.searchParams.get('profileId');
  const profileId = await resolveTargetProfile(user.id, demande);
  if (!profileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { data, error } = await supa
    .from('integrations_sante')
    .select('provider, libelle, connectee, connected_at, statut, erreur, derniere_donnee, retard_jours, etat_collecte, etat')
    .eq('profile_id', profileId);

  // Pas de `if (ok)` muet : une vue de santé qui échoue et rend une liste vide se
  // lirait « tout va bien », ce qui est exactement l'inverse de ce qu'elle sert à
  // dire. On remonte l'erreur pour que l'écran affiche un doute plutôt qu'un
  // faux calme.
  if (error) {
    console.error('[integrations/health]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ integrations: (data ?? []) as IntegrationSante[] });
}
