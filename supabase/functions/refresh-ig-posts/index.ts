// Edge Function Supabase — refresh-ig-posts
// Appelée par le bouton "Actualiser Posts" du frontend (Gérer mes liens), ciblée sur
// UN SEUL profil — contrairement à poll-leads (cron régulier, guard 1x/jour, tous les
// profils), celle-ci force toujours le refetch de la liste de posts (skipGuard=true)
// pour refléter immédiatement un post publié/supprimé sans attendre le lendemain.
// Auth : JWT utilisateur Supabase (pas CRON_SECRET) — vérifie que l'appelant a bien
// accès à profile_id (lui-même ou un coach sur son élève).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getIgCreds, snapshotIgPosts } from '../_shared/ig-posts.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return new Response(JSON.stringify({ error: 'Non authentifié' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const authedSupa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await authedSupa.auth.getUser(jwt);
  if (authError || !user) return new Response(JSON.stringify({ error: 'Non authentifié' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const body = await req.json().catch(() => ({}));
  const profileId: string = body.profile_id || user.id;

  if (profileId !== user.id) {
    const { data: clientRow } = await supa.from('clients').select('id').eq('profile_id', profileId).eq('coach_id', user.id).single();
    if (!clientRow) return new Response(JSON.stringify({ error: 'Accès refusé' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const creds = await getIgCreds(supa, profileId);
  if (!creds) return new Response(JSON.stringify({ error: 'no_token' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const errors = await snapshotIgPosts(supa, profileId, creds.token, creds.igAccountId, isoDate(1), true);

  return new Response(JSON.stringify({ ok: errors.length === 0, errors }), { headers: { 'Content-Type': 'application/json' } });
});
