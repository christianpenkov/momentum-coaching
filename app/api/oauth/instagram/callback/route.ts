import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { lireTout } from '@/lib/supabase/lireTout';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error || !code || !state) {
    return NextResponse.redirect(`${origin}/client/settings?error=instagram_denied`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const dest = profile?.role === 'coach' ? '/settings' : '/client/settings';

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Sortie d'echec commune a toutes les etapes de la connexion.
  //
  // Avant, un echec d'echange de jeton ou de /me ne faisait rien : le code continuait,
  // ecrivait la ligne integrations avec un jeton inerte et redirigeait vers
  // `?connected=instagram`. L'utilisateur voyait « connecte », et la panne ne
  // reapparaissait que plus tard, deformee, dans le bandeau de synchronisation des
  // stats — a un endroit ou plus rien ne pointait vers sa cause. Constate le 2026-08-27
  // avec un compte dont Meta refusait tous les appels (« Unsupported request - method
  // type: get ») alors que les 4 permissions etaient bien accordees.
  //
  // La trace part dans cron_runs : c'est la table de sante que decrit AGENTS.md
  // (`select * from cron_runs` — vide = aucun incident), donc un echec de connexion y
  // devient visible sans avoir a fouiller les logs Vercel, qui ne gardent qu'une heure.
  async function echec(code: string, detail: unknown) {
    console.error(`[IG callback] ${code}:`, JSON.stringify(detail));
    // La trace ne doit jamais empecher la redirection : si l'insert echoue, on
    // renvoie quand meme l'utilisateur vers ses reglages avec le bon message.
    try {
      await serviceSupabase.from('cron_runs').insert({
        fonction: 'oauth_instagram_callback',
        profils_en_erreur: 1,
        erreurs: { profile_id: user!.id, code, detail },
      });
    } catch (e) {
      console.error('[IG callback] trace cron_runs impossible:', e);
    }
    return NextResponse.redirect(`${origin}${dest}?error=${code}`);
  }

  const expectedState = Buffer.from(user.id).toString('base64');
  if (state !== expectedState) {
    return NextResponse.redirect(`${origin}${dest}?error=instagram_state`);
  }

  // Échange le code contre un token court (Instagram)
  const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_CLIENT_ID!,
      client_secret: process.env.INSTAGRAM_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/oauth/instagram/callback`,
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  console.log('[IG callback] short token:', JSON.stringify({ user_id: tokenData.user_id, has_token: !!tokenData.access_token, permissions: tokenData.permissions }));
  if (!tokenData.access_token) {
    return echec('instagram_token', tokenData?.error ?? null);
  }

  // Échange contre un token long-terme (60 jours)
  const longTokenRes = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_CLIENT_SECRET}&access_token=${tokenData.access_token}`
  );
  const longTokenData = await longTokenRes.json();
  console.log('[IG callback] long token:', JSON.stringify({ has_token: !!longTokenData.access_token, expires_in: longTokenData.expires_in, error: longTokenData.error }));

  // ⚠️ Un echec ici n'est PAS rattrapable en gardant le jeton court : il vaut 1 heure.
  // L'ancien code basculait dessus en silence, avec expires_at a NULL — l'integration
  // s'ecrivait « connectee » et mourait dans l'heure sans que rien ne le dise.
  if (!longTokenData.access_token || !longTokenData.expires_in) {
    // Une IGApiException code 100 ici n'est pas un incident passager : c'est deja le
    // refus d'acces au compte, celui que /me renverrait juste apres. Lui laisser le
    // message « reessayez dans quelques minutes » fait tourner l'utilisateur en rond —
    // constate le 2026-08-27, deux reconnexions de suite, meme erreur a la seconde pres.
    const err = longTokenData?.error;
    if (err?.code === 100) return echec('instagram_jeton_inerte', err);
    return echec('instagram_echange_jeton', err ?? longTokenData);
  }
  const accessToken: string = longTokenData.access_token;
  const expiresAt = new Date(Date.now() + longTokenData.expires_in * 1000).toISOString();

  // Récupère l'ID réel + username via /me (ig_account_id)
  //
  // ⚠️ C'est AUSSI la validation du jeton, et elle doit rester avant toute ecriture :
  // l'archivage plus bas est destructif pour un eleve qui a deja des donnees (il passe
  // toutes ses lignes en archived_at). Le declencher sur une connexion qui n'aboutira
  // pas ferait disparaitre ses stats pour rien.
  const meRes = await fetch(
    `https://graph.instagram.com/v22.0/me?fields=id,username,account_type&access_token=${accessToken}`
  );
  const meData = await meRes.json();
  console.log('[IG callback] /me response:', JSON.stringify(meData));

  // Meta emet un jeton et annonce les permissions accordees meme quand l'app n'a en
  // realite aucun acces au compte : tous les appels renvoient alors « Unsupported
  // request - method type: get », y compris /me. Le message ne decrit pas sa cause —
  // les deux vraies causes sont un compte sans role dans une app encore en mode
  // Developpement, et une permission restee en acces standard au lieu d'avance.
  if (!meData?.id) {
    return echec('instagram_jeton_inerte', meData?.error ?? meData);
  }
  // L'API Instagram exige un compte professionnel (Business ou Createur). Un compte
  // personnel passe l'ecran d'autorisation mais ne peut rien lire ensuite.
  if (meData.account_type === 'PERSONAL') {
    return echec('instagram_compte_personnel', { account_type: meData.account_type, username: meData.username ?? null });
  }

  // Desormais toujours defini : /me a repondu, donc l'ID vient de l'API et non plus
  // d'un repli sur tokenData.user_id qui masquait l'echec.
  const igAccountId = String(meData.id);
  const accountLabel = meData.username ? `@${meData.username}` : null;

  // Isolation par compte IG connecté (bascule + archivage) — si ce profil bascule vers
  // un compte Instagram DIFFÉRENT de celui précédemment connecté, on archive toutes les
  // données actives (jamais de DELETE) puis on désarchive celles qui appartenaient déjà
  // au nouveau compte (reconnexion d'un compte déjà vu avant). Voir
  // ~/.claude/plans/ok-nous-ici-on-proud-rocket.md pour le contexte complet.
  const { data: existingInteg } = await serviceSupabase
    .from('integrations')
    .select('metadata, first_connected_at')
    .eq('profile_id', user.id)
    .eq('provider', 'instagram')
    .maybeSingle();
  const previousAccountId = (existingInteg?.metadata as any)?.ig_account_id ?? null;

  if (igAccountId) {
    const now = new Date().toISOString();
    // ⚠️ Cette liste existe en DEUX exemplaires : ici et dans
    // app/api/oauth/instagram/disconnect/route.ts (IG_TABLES). Toute table ajoutee
    // a l'une doit l'etre a l'autre, sinon l'archivage devient partiel.
    // Non factorisee volontairement : ces deux routes sont dans le parcours de la
    // review Meta en cours, on n'y touche pas plus que necessaire.
    const igTables = [
      'analytics_ig_posts_history', 'analytics_ig_stories_history', 'ig_stories',
      'instagram_leads', 'instagram_lead_lm_history', 'content_links',
      'ig_post_meta', 'analytics_daily_snapshots',
      'analytics_ig_periodes',
    ];
    try {
      // Étape 1 : archiver tout ce qui est actif pour ce profil et n'appartient PAS au
      // compte qu'on connecte maintenant. Se déclenche à CHAQUE connexion (pas
      // seulement si previousAccountId diffère) — previousAccountId peut être null même
      // quand une vraie bascule a eu lieu, si la déconnexion précédente a supprimé la
      // ligne integrations (voir /api/oauth/instagram/disconnect) : il ne faut jamais
      // dépendre de la mémoire de l'ancien compte pour savoir s'il faut archiver.
      const archiveResults = await Promise.all(igTables.map(async t => {
        const base = serviceSupabase.from(t).update({ archived_at: now }, { count: 'exact' })
          .eq('profile_id', user.id).is('archived_at', null);

        // ⚠️ `analytics_daily_snapshots` est la SEULE table de cette liste qui ne
        // soit pas propre à Instagram : une même ligne y porte les colonnes `ig_*`,
        // `yt_*` ET `shortio_*` d'une journée. L'archiver entière pour un motif
        // Instagram emporte donc les métriques YouTube et Short.io du même jour.
        //
        // Or aucun chemin d'écriture ne renseignait `ig_account_id` sur cette table :
        // toutes ses lignes récentes valent NULL. Avec le prédicat commun
        // (`is.null OR neq`), une simple RECONNEXION DU MÊME COMPTE archivait donc
        // 100 % de l'historique quotidien — et l'étape 2 ne le restaurait pas,
        // puisqu'elle cherche `= igAccountId`. Mesuré le 2026-09-02 : 185 lignes,
        // dont 120 portant des données YouTube et 46 des données Short.io.
        //
        // Ici, NULL veut dire « cette ligne ne revendique aucun compte Instagram »,
        // jamais « elle appartient à un autre ». Seules les lignes rattachées
        // explicitement à un AUTRE compte sont archivées — `neq` exclut les NULL par
        // construction en SQL, ce qui est exactement le comportement voulu.
        const { error, count } = t === 'analytics_daily_snapshots'
          ? await base.neq('ig_account_id', igAccountId)
          : await base.or(`ig_account_id.is.null,ig_account_id.neq.${igAccountId}`);
        return { t, count, error: error?.message };
      }));
      // Étape 2 : désarchiver les lignes qui appartenaient déjà à CE compte (reconnexion
      // d'un compte déjà vu avant, y compris après une déconnexion qui a effacé
      // previousAccountId) — leurs données réapparaissent.
      const unarchiveResults = await Promise.all(igTables.map(async t => {
        const { error, count } = await serviceSupabase.from(t).update({ archived_at: null }, { count: 'exact' })
          .eq('profile_id', user.id).eq('ig_account_id', igAccountId);
        return { t, count, error: error?.message };
      }));
      // Étape 3 : prospect_links suit l'état de SON lead, faute de porter un
      // ig_account_id comme les 8 tables ci-dessus. Sans cette étape, un prospect
      // dont le lead vient d'être archivé revenait dans les compteurs et dans le
      // pipeline par cette table — à une étape erronée de surcroît, le lead qui
      // portait hook_replied ayant été filtré. Fait après les étapes 1 et 2 pour
      // lire l'état final des leads, jamais un état intermédiaire.
      // `lireTout` : au-delà de 1 000 leads, PostgREST tronquait sans erreur et des
      // prospects de l'ANCIEN compte réapparaissaient dans le pipeline — le bug
      // exact que cette étape existe pour empêcher (balayage du 2026-09-05).
      const { data: leadStates } = await lireTout(() => serviceSupabase
        .from('instagram_leads')
        .select('id, archived_at')
        .eq('profile_id', user.id)
        .order('id', { ascending: true }));

      const toArchive = (leadStates ?? []).filter(l => l.archived_at).map(l => l.id);
      const toUnarchive = (leadStates ?? []).filter(l => !l.archived_at).map(l => l.id);

      const linkResults = await Promise.all([
        toArchive.length
          ? serviceSupabase.from('prospect_links').update({ archived_at: now }, { count: 'exact' })
              .eq('profile_id', user.id).is('archived_at', null).in('ig_lead_id', toArchive)
          : Promise.resolve({ count: 0, error: null }),
        toUnarchive.length
          ? serviceSupabase.from('prospect_links').update({ archived_at: null }, { count: 'exact' })
              .eq('profile_id', user.id).not('archived_at', 'is', null).in('ig_lead_id', toUnarchive)
          : Promise.resolve({ count: 0, error: null }),
      ]);

      console.log(`[IG callback] archive/désarchive pour profile_id=${user.id} previousAccountId=${previousAccountId} igAccountId=${igAccountId}:`,
        JSON.stringify({
          archived: archiveResults,
          unarchived: unarchiveResults,
          prospectLinks: { archived: linkResults[0].count, unarchived: linkResults[1].count },
        }));
    } catch (e) {
      console.error('[IG callback] Erreur archivage bascule de compte:', e);
    }
  }

  const igConnectedNow = new Date().toISOString();
  await serviceSupabase.from('integrations').upsert({
    profile_id: user.id,
    provider: 'instagram',
    access_token: accessToken,
    refresh_token: null,
    account_label: accountLabel,
    expires_at: expiresAt,
    connected_at: igConnectedNow,
    first_connected_at: existingInteg?.first_connected_at || igConnectedNow,
    metadata: igAccountId ? { ig_account_id: igAccountId } : null,
    // ⚠️ Remettre le statut a zero fait partie de la connexion.
    //
    // Sans ces trois champs, une reconnexion reussie laissait status='failed' et
    // l'ancien last_snapshot_error en place : le bandeau « Impossible de synchroniser
    // les donnees » restait affiche sur les stats apres une connexion qui avait
    // pourtant abouti, jusqu'au prochain passage du cron. Le jeton qu'on vient
    // d'ecrire est valide — on l'a prouve par /me juste au-dessus.
    status: 'ok',
    last_snapshot_status: null,
    last_snapshot_error: null,
  }, { onConflict: 'profile_id,provider' });

  // Réabonner aux deux niveaux webhook après chaque connexion
  if (igAccountId) {
    const appToken = `${process.env.INSTAGRAM_CLIENT_ID}|${process.env.INSTAGRAM_CLIENT_SECRET}`;
    try {
      // Niveau 1 — app-level (fields comments+messages au niveau Meta app)
      await fetch(`https://graph.facebook.com/v21.0/${process.env.INSTAGRAM_CLIENT_ID}/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          object: 'instagram',
          callback_url: `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/webhooks/instagram`,
          fields: 'comments,messages',
          verify_token: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN!,
          access_token: appToken,
        }),
      });
      // Niveau 2 — account-level (autorise l'app sur ce compte IG)
      await fetch(`https://graph.instagram.com/v21.0/${igAccountId}/subscribed_apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscribed_fields: 'comments,messages', access_token: accessToken }),
      });
    } catch (e) {
      console.error('[IG callback] webhook registration failed:', e);
    }
  }

  // Fire-and-forget backfill 30j (non-bloquant — ne retarde pas le redirect)
  const backfillUrl = `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/instagram/backfill`;
  fetch(backfillUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({ profile_id: user.id }),
  }).catch(e => console.error('[IG callback] backfill trigger failed:', e));

  // Fire-and-forget refresh des posts — sans ça "Gérer mes liens" reste vide juste
  // après une connexion tant que l'utilisateur ne clique pas lui-même sur Actualiser
  // (le cron poll-leads ne tourne qu'1x/jour). Même Edge Function que le bouton
  // Actualiser, appelée ici en mode serveur-à-serveur via CRON_SECRET.
  if (igAccountId) {
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/refresh-ig-posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({ profile_id: user.id }),
    }).catch(e => console.error('[IG callback] refresh-ig-posts trigger failed:', e));
  }

  return NextResponse.redirect(`${origin}${dest}?connected=instagram`);
}
