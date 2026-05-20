import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

  if (!integ?.access_token) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const token = integ.access_token;
  const igId = (integ.metadata as any)?.ig_account_id;
  if (!igId) return NextResponse.json({ error: 'no_ig_account_id' }, { status: 404 });

  const safe = async (url: string) => {
    try {
      const res = await fetch(url);
      return await res.json();
    } catch (e) {
      return { _error: String(e) };
    }
  };

  const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  const since90 = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);

  // ── 1. Profil — tous les champs v22.0 ───────────────────────────────────
  const account = await safe(
    `https://graph.instagram.com/v22.0/${igId}?fields=id,username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website,account_type&access_token=${token}`
  );

  // ── 2. Insights compte — métriques day 30j (toutes les métriques connues) ─
  const insights_day_30 = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=reach,views,profile_views,accounts_engaged,total_interactions,follows_and_unfollows,profile_links_taps,website_clicks,follower_count&period=day&since=${since}&until=${until}&access_token=${token}`
  );

  // ── 2b. Views breakdown follower_type (viralité organique) ──────────────
  const views_follower_breakdown = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=views&period=day&since=${since}&until=${until}&breakdown=follow_type&access_token=${token}`
  );

  // ── 3. Insights compte — métriques day 90j ──────────────────────────────
  const insights_day_90 = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=reach,accounts_engaged,total_interactions,follows_and_unfollows,profile_links_taps,website_clicks&period=day&since=${since90}&until=${until}&access_token=${token}`
  );

  // ── 4. Insights compte — period=week ────────────────────────────────────
  const insights_week = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=reach,accounts_engaged,total_interactions&period=week&access_token=${token}`
  );

  // ── 5. Insights compte — period=month ───────────────────────────────────
  const insights_month = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=reach,accounts_engaged,total_interactions&period=month&access_token=${token}`
  );

  // ── 6. Reach breakdown par type de contenu (POST / REEL / STORY) ────────
  const reach_breakdown = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=reach&period=day&since=${since}&until=${until}&breakdown=media_product_type&access_token=${token}`
  );

  // ── 7. Interactions breakdown par type de contenu ───────────────────────
  const interactions_breakdown = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=total_interactions&period=day&since=${since}&until=${until}&breakdown=media_product_type&access_token=${token}`
  );

  // ── 8. Impressions (period=day, séparée car souvent en erreur) ───────────
  const impressions_day = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=impressions&period=day&since=${since}&until=${until}&access_token=${token}`
  );

  // ── 9. Démographie abonnés ───────────────────────────────────────────────
  const demographics_age_gender = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=follower_demographics&period=lifetime&breakdown=age,gender&access_token=${token}`
  );
  const demographics_country = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=follower_demographics&period=lifetime&breakdown=country&access_token=${token}`
  );
  const demographics_city = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=follower_demographics&period=lifetime&breakdown=city&access_token=${token}`
  );

  // ── 10. Abonnés en ligne par heure (remplace follower_active_times) ────────
  const online_followers = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=online_followers&period=day&since=${since}&until=${until}&access_token=${token}`
  );

  // ── 11. Médias — tous les champs disponibles ─────────────────────────────
  const media_list = await safe(
    `https://graph.instagram.com/v22.0/${igId}/media?fields=id,caption,media_type,thumbnail_url,media_url,timestamp,like_count,comments_count,permalink,is_shared_to_feed,media_product_type,video_duration&limit=10&access_token=${token}`
  );

  const mediaData = media_list as any;
  const firstPost = mediaData?.data?.find((m: any) => m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM');
  const firstReel = mediaData?.data?.find((m: any) => m.media_type === 'VIDEO' || m.media_type === 'REEL');

  // ── 12. Insights post IMAGE/CAROUSEL — métriques de base + nouvelles ─────
  const media_insights_post_base = firstPost ? await safe(
    `https://graph.instagram.com/v22.0/${firstPost.id}/insights?metric=likes,comments,reach,saved,shares,views,total_interactions,follows,profile_visits&access_token=${token}`
  ) : { _note: 'no image/carousel post found' };

  // ── 13. Reposts post (nouveau déc. 2025) ─────────────────────────────────
  const media_insights_post_reposts = firstPost ? await safe(
    `https://graph.instagram.com/v22.0/${firstPost.id}/insights?metric=reposts&access_token=${token}`
  ) : { _note: 'no image/carousel post found' };

  // ── 14. Insights reel — métriques de base (follows/profile_visits = IMAGE only) ───
  const media_insights_reel_base = firstReel ? await safe(
    `https://graph.instagram.com/v22.0/${firstReel.id}/insights?metric=likes,comments,reach,saved,shares,views,total_interactions&access_token=${token}`
  ) : { _note: 'no reel found' };

  // ── 15. Insights reel — métriques spécifiques reel ───────────────────────
  const media_insights_reel_specific = firstReel ? await safe(
    `https://graph.instagram.com/v22.0/${firstReel.id}/insights?metric=ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate,clips_replays_count,ig_reels_aggregated_all_plays_count&access_token=${token}`
  ) : { _note: 'no reel found' };

  // ── 16. Reposts reel (nouveau déc. 2025) ─────────────────────────────────
  const media_insights_reel_reposts = firstReel ? await safe(
    `https://graph.instagram.com/v22.0/${firstReel.id}/insights?metric=reposts&access_token=${token}`
  ) : { _note: 'no reel found' };

  // ── 17. Crossposted views reel (nouveau déc. 2025) ───────────────────────
  const media_insights_reel_crosspost = firstReel ? await safe(
    `https://graph.instagram.com/v22.0/${firstReel.id}/insights?metric=crossposted_views,facebook_views&access_token=${token}`
  ) : { _note: 'no reel found' };

  // ── 18. video_completion_rate — test explicite (attendu: erreur) ──────────
  const media_insights_reel_completion = firstReel ? await safe(
    `https://graph.instagram.com/v22.0/${firstReel.id}/insights?metric=video_completion_rate&access_token=${token}`
  ) : { _note: 'no reel found' };

  // ── 19. Stories actives ──────────────────────────────────────────────────
  const stories = await safe(
    `https://graph.instagram.com/v22.0/${igId}/stories?fields=id,media_type,timestamp,like_count,replies&access_token=${token}`
  );

  const firstStory = (stories as any)?.data?.[0];

  // ── 20. Insights story ───────────────────────────────────────────────────
  const story_insights = firstStory ? await safe(
    `https://graph.instagram.com/v22.0/${firstStory.id}/insights?metric=exits,impressions,reach,replies,taps_forward,taps_back,follows&access_token=${token}`
  ) : { _note: 'no active story' };

  // ── 21. DM conversations ─────────────────────────────────────────────────
  const conversations = await safe(
    `https://graph.instagram.com/v22.0/${igId}/conversations?fields=id,updated_time,participants,message_count,unread_count&platform=instagram&limit=5&access_token=${token}`
  );

  const firstThread = (conversations as any)?.data?.[0];
  const messages_in_thread = firstThread ? await safe(
    `https://graph.instagram.com/v22.0/${firstThread.id}/messages?fields=id,message,from,to,created_time&limit=5&access_token=${token}`
  ) : { _note: 'no thread found' };

  // ── 22. Tags (posts où le compte est tagué) ──────────────────────────────
  const tagged_media = await safe(
    `https://graph.instagram.com/v22.0/${igId}/tags?fields=id,media_type,timestamp,like_count,comments_count,permalink&limit=5&access_token=${token}`
  );

  // ── 23. Mentions ─────────────────────────────────────────────────────────
  const mentions = await safe(
    `https://graph.instagram.com/v22.0/${igId}?fields=mentioned_media.fields(id,media_type,timestamp,caption)&access_token=${token}`
  );

  // ── 24. Hashtags récemment recherchés ────────────────────────────────────
  const hashtags_followed = await safe(
    `https://graph.instagram.com/v22.0/${igId}/recently_searched_hashtags?access_token=${token}`
  );

  return NextResponse.json({
    _test_route: 'SUPPRIMER AVANT LIVRAISON',
    _api_version: 'v22.0',
    _timestamp: new Date().toISOString(),
    _ig_account_id: igId,
    _first_post_id: firstPost?.id || null,
    _first_reel_id: firstReel?.id || null,

    // Compte
    account,

    // Insights compte
    insights_day_30,
    views_follower_breakdown,
    insights_day_90,
    insights_week,
    insights_month,
    reach_breakdown,
    interactions_breakdown,
    impressions_day,

    // Démographie
    demographics_age_gender,
    demographics_country,
    demographics_city,
    online_followers,

    // Médias
    media_list,

    // Insights post
    media_insights_post_base,
    media_insights_post_reposts,

    // Insights reel
    media_insights_reel_base,
    media_insights_reel_specific,
    media_insights_reel_reposts,
    media_insights_reel_crosspost,
    media_insights_reel_completion,

    // Stories
    stories,
    story_insights,

    // DMs
    conversations,
    messages_in_thread,

    // Autres
    tagged_media,
    mentions,
    hashtags_followed,
  });
}
