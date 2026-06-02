import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APP_ID = process.env.INSTAGRAM_CLIENT_ID!;
const APP_SECRET = process.env.INSTAGRAM_CLIENT_SECRET!;

interface FieldStatus {
  active: boolean;
  source: 'app' | 'account' | 'both';
}

// GET /api/instagram/check-subscriptions
// Vérifie les souscriptions webhook IG à deux niveaux :
// 1. App-level (App Token) — quels fields sont souscrits pour l'objet instagram
// 2. Account-level (User Token) — quels subscribed_fields sont actifs sur CE compte IG
// Retourne : statut OK/KO par field (comments, messages) + données brutes
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, metadata')
    .eq('profile_id', user.id)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) {
    return NextResponse.json({ error: 'Compte Instagram non connecté' }, { status: 404 });
  }

  const token = integ.access_token;
  const igAccountId = (integ.metadata as any)?.ig_account_id;
  if (!igAccountId) return NextResponse.json({ error: 'ig_account_id manquant' }, { status: 404 });

  const appToken = `${APP_ID}|${APP_SECRET}`;

  // Niveau 1 — souscriptions app-level (liste des subscriptions pour l'objet instagram)
  const appRes = await fetch(
    `https://graph.facebook.com/v21.0/${APP_ID}/subscriptions?access_token=${appToken}`
  );
  const appData = await appRes.json();

  // Niveau 2 — souscriptions account-level pour CE compte IG
  const accountRes = await fetch(
    `https://graph.instagram.com/v21.0/${igAccountId}/subscribed_apps?access_token=${token}`
  );
  const accountData = await accountRes.json();

  // Extraire les fields actifs au niveau app (objet instagram uniquement)
  const appIgSubscription = (appData.data ?? []).find(
    (s: any) => s.object === 'instagram'
  );
  const appActiveFields: string[] = appIgSubscription?.fields?.map((f: any) =>
    typeof f === 'string' ? f : f.name
  ) ?? [];

  // Extraire les fields actifs au niveau compte
  const accountActiveFields: string[] = accountData.data?.[0]?.subscribed_fields ?? [];

  // Construire le statut par field
  const REQUIRED_FIELDS = ['comments', 'messages'];
  const fieldStatuses: Record<string, FieldStatus & { ok: boolean }> = {};

  for (const field of REQUIRED_FIELDS) {
    const inApp = appActiveFields.includes(field);
    const inAccount = accountActiveFields.includes(field);
    const source: 'app' | 'account' | 'both' =
      inApp && inAccount ? 'both' : inApp ? 'app' : 'account';
    fieldStatuses[field] = {
      active: inApp && inAccount,
      ok: inApp && inAccount,
      source: inApp || inAccount ? source : 'app',
    };
  }

  const allOk = REQUIRED_FIELDS.every(f => fieldStatuses[f].ok);

  return NextResponse.json({
    ok: allOk,
    igAccountId,
    fields: fieldStatuses,
    raw: {
      app_level: appData,
      account_level: accountData,
    },
  });
}
