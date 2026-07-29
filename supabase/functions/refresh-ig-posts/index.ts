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

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().split('T')[0];
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

  const errors = await snapshotIgPosts(supa, profileId, creds.token, creds.igAccountId, isoDate(1), true);
  console.log(`[refresh-ig-posts] profileId=${profileId} igAccountId=${creds.igAccountId} errors=${JSON.stringify(errors)}`);

  return new Response(JSON.stringify({ ok: errors.length === 0, errors }), { headers: jsonHeaders });
});
