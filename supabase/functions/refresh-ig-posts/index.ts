// Edge Function Supabase — refresh-ig-posts
// Appelée par le bouton "Actualiser Posts" du frontend (Gérer mes liens), ciblée sur
// UN SEUL profil — contrairement à poll-leads (cron régulier, guard 1x/jour, tous les
// profils), celle-ci force toujours le refetch de la liste de posts (skipGuard=true)
// pour refléter immédiatement un post publié/supprimé sans attendre le lendemain.
// Auth : JWT utilisateur Supabase (bouton frontend) OU CRON_SECRET (appel serveur-à-
// serveur depuis le callback OAuth, juste après une connexion — sinon "Gérer mes liens"
// reste vide tant que l'utilisateur ne clique pas lui-même sur Actualiser).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getIgCreds, snapshotIgPosts } from '../_shared/ig-posts.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const PLATFORM_URL = Deno.env.get('NEXT_PUBLIC_PLATFORM_URL') || 'https://momentum-plateforme.vercel.app';

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Offset Paris (+1h hiver / +2h été) — règle UE : dernier dimanche de mars 1h UTC
// (passage à +2h) → dernier dimanche d'octobre 1h UTC (retour à +1h). Dupliqué dans
// chaque Edge Function Deno (pas d'import cross-fichier possible) — voir la même
// logique dans supabase/functions/poll-leads/index.ts et poll-stories/index.ts.
function lastSundayOfMonth(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lastDate = new Date(Date.UTC(year, month, lastDay));
  return lastDay - lastDate.getUTCDay();
}

function parisOffsetHours(utcDate: Date): number {
  const year = utcDate.getUTCFullYear();
  const dstStart = Date.UTC(year, 2, lastSundayOfMonth(year, 2), 1, 0, 0);
  const dstEnd = Date.UTC(year, 9, lastSundayOfMonth(year, 9), 1, 0, 0);
  const t = utcDate.getTime();
  return t >= dstStart && t < dstEnd ? 2 : 1;
}

// Date calendrier Paris (pas UTC) — "aujourd'hui moins daysAgo jours", en heure de Paris.
function isoDate(daysAgo: number): string {
  const now = new Date();
  const parisNow = new Date(now.getTime() + parisOffsetHours(now) * 3600_000);
  parisNow.setUTCDate(parisNow.getUTCDate() - daysAgo);
  return parisNow.toISOString().split('T')[0];
}

// Le navigateur envoie une requête préflight OPTIONS (sans Authorization) avant le
// vrai POST — sans ces headers CORS, le preflight recevait un 401 et le navigateur
// bloquait le POST réel avant même qu'il ne parte.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return new Response(JSON.stringify({ error: 'Non authentifié' }), { status: 401, headers: jsonHeaders });

  const body = await req.json().catch(() => ({}));
  const isServerCall = token === CRON_SECRET;
  let profileId: string;

  if (isServerCall) {
    if (!body.profile_id) return new Response(JSON.stringify({ error: 'profile_id requis' }), { status: 400, headers: jsonHeaders });
    profileId = body.profile_id;
  } else {
    const authedSupa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await authedSupa.auth.getUser(token);
    if (authError || !user) return new Response(JSON.stringify({ error: 'Non authentifié' }), { status: 401, headers: jsonHeaders });
    profileId = body.profile_id || user.id;

    if (profileId !== user.id) {
      const { data: clientRow } = await supa.from('clients').select('id').eq('profile_id', profileId).eq('coach_id', user.id).single();
      if (!clientRow) return new Response(JSON.stringify({ error: 'Accès refusé' }), { status: 403, headers: jsonHeaders });
    }
  }

  console.log(`[refresh-ig-posts] profileId=${profileId} isServerCall=${isServerCall}`);

  const creds = await getIgCreds(supa, profileId);
  if (!creds) {
    console.log(`[refresh-ig-posts] no_token pour profileId=${profileId}`);
    return new Response(JSON.stringify({ error: 'no_token' }), { status: 404, headers: jsonHeaders });
  }

  const errors = await snapshotIgPosts(supa, profileId, creds.token, creds.igAccountId, isoDate(1), true, { platformUrl: PLATFORM_URL, cronSecret: CRON_SECRET });
  console.log(`[refresh-ig-posts] profileId=${profileId} igAccountId=${creds.igAccountId} errors=${JSON.stringify(errors)}`);

  return new Response(JSON.stringify({ ok: errors.length === 0, errors }), { headers: jsonHeaders });
});
