// Module partagé — snapshot des posts Instagram individuels (analytics_ig_posts_history)
// Importé par poll-leads/index.ts (cron régulier, guard 1x/jour) ET refresh-ig-posts/index.ts
// (bouton "Actualiser" du frontend, ciblé sur un seul profil, skipGuard=true).
// Une seule source de vérité — ne pas dupliquer ce code dans une autre Edge Function.
//
// ═══════════════════════════════════════════════════════════════════════════════
// PASSAGE À L'ÉCHELLE — refonte du 2026-08-30, objectif 30-40 élèves sans entretien
// ═══════════════════════════════════════════════════════════════════════════════
//
// Ce que faisait la version précédente, et pourquoi ça ne tenait pas :
//
//   • `limit=15` sur /media  → 85 % des posts d'un élève actif n'étaient jamais
//     rafraîchis. Cette borne n'était pas une limite de Meta (l'edge en rend
//     jusqu'à 10 000 avec pagination), c'était un garde-fou de coût.
//   • UN appel HTTP PAR MÉTRIQUE ET PAR POST → 8 appels par post. À la cible
//     (40 élèves × 100 posts), 32 000 appels dans une fonction qui dispose de 150 s.
//   • un `storage.list()` par post et par passage pour savoir si la vignette
//     existait déjà → 20 000 requêtes de stockage par nuit à la cible.
//   • un `select` sur ig_post_durees par post → idem.
//   • un `upsert` par post → 32 000 allers-retours vers la base.
//
// ── Le découpage par métrique était une parade. Elle ne protégeait plus rien ──
//
// Le commentaire qu'elle portait affirmait : « un seul appel groupé perd TOUTES les
// métriques du groupe si Meta en refuse ne serait-ce qu'une seule ». Testé contre
// l'API réelle le 2026-08-30, sur les 14 posts d'un compte couvrant 2023 → 2026 :
// l'appel groupé rend EXACTEMENT les mêmes métriques que les appels unitaires, dans
// les 14 cas. Le refus de Meta porte sur l'OBJET (sous-code 2108006, « publié avant
// la conversion en compte pro »), pas sur la métrique : quand il tombe, il fait
// tomber les 8 métriques, groupées ou non. La parade coûtait 8× et ne rattrapait
// rien.
//
// Elle garde un sens dans un seul cas, réel lui aussi : demander une métrique que
// le type de média ne supporte pas (`follows` sur un Reel) fait échouer tout le
// groupe. C'est ce que gère la dégradation 'reduit' ci-dessous — et c'est aussi ce
// qui absorbera sans intervention la prochaine dépréciation de métrique par Meta.
//
// ── Ce qui remplace tout ça ──────────────────────────────────────────────────
//
// Lecture MULTI-OBJETS : `GET /?ids=post1,post2,…&fields=insights.metric(a,b,c)`.
// 25 posts × 8 métriques en UN appel HTTP. Vérifié contre l'API le 2026-08-30 :
// 12 posts couverts en 2 appels au lieu de 96.
//
// ⚠️ Les « requêtes groupées » de Meta (`?batch=[…]`, 50 sous-requêtes) — la piste
// que proposait le handoff — NE SONT PAS DISPONIBLES ici : testées, le point
// d'entrée refuse un jeton Instagram Login (« Cannot call API for app … on behalf
// of user 0 ») et graph.facebook.com refuse le jeton tout court. Ne pas y revenir.
//
// ── Le coût par nuit, désormais ──────────────────────────────────────────────
//
//   pages /media (100 posts/page) + ceil(posts/25) par jeu de métriques
//   ≈ 6 appels pour 100 posts, ≈ 25 appels pour 500 posts.
//
// Les travaux « une fois par post » (vignette, durée) sont bornés par passage et se
// rattrapent tout seuls aux passages suivants : le temps d'exécution ne dépend donc
// PAS de la taille du catalogue, même au tout premier passage sur un compte de
// 500 posts. Même motif que la fenêtre d'auto-réparation Short.io.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GRAPH = 'https://graph.instagram.com/v22.0';

// ── Réglages de coût ─────────────────────────────────────────────────────────
//
// IDS_PAR_APPEL : Meta ne documente pas de plafond dur pour `ids=` (50 est la
// valeur citée pour les requêtes groupées, qui sont un autre mécanisme). 25 est
// délibérément prudent : c'est aussi la taille du sinistre en cas de dichotomie
// (voir lireLot), donc il n'y a aucun intérêt à le pousser.
const IDS_PAR_APPEL = 25;
const MEDIA_PAR_PAGE = 100;
// 12 pages = 1200 posts. Au-delà, on ne conclut rien (voir `complet` plus bas) :
// la détection de suppression se borne d'elle-même au post le plus ancien reçu.
const PAGES_MEDIA_MAX = 12;
const LOTS_EN_PARALLELE = 4;
// Plafond d'appels consommés par la dichotomie, par profil et par passage. Une
// dépréciation de métrique côté Meta la déclencherait sur tout le catalogue d'un
// coup ; ce plafond garantit que ça coûte au pire une nuit, jamais un dépassement
// du budget de 150 s. Ce qui n'a pas pu être isolé est retenté au passage suivant.
const APPELS_DICHOTOMIE_MAX = 120;

// Travaux « une seule fois par post », bornés par passage — ils se rattrapent seuls.
const VIGNETTES_PAR_PASSAGE = 100;
const VIGNETTES_EN_PARALLELE = 8;
const DUREES_PAR_PASSAGE = 30;
const DUREES_EN_PARALLELE = 5;

// Écriture en base par paquets plutôt qu'un aller-retour par post.
const LIGNES_PAR_UPSERT = 200;

// Notification « nouveau post » : bornée aux posts récents. Sans cette borne, le
// premier passage après le retrait de `limit=15` enverrait une notification pour
// CHAQUE post de l'historique — 500 notifications d'un coup sur le téléphone de
// l'élève. Un post publié il y a un an n'est pas « nouveau », même si la base le
// découvre aujourd'hui.
const NOUVEAU_POST_FENETRE_JOURS = 7;

const METRIQUES_COMMUNES = ['reach', 'saved', 'shares', 'total_interactions', 'views'];
const METRIQUES_REELS = [...METRIQUES_COMMUNES, 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate'];
const METRIQUES_FEED = [...METRIQUES_COMMUNES, 'follows', 'profile_visits'];

const BUCKET_VIGNETTES = 'instagram-post-thumbnails';

export async function safeJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

// PostgREST plafonne une reponse a 1000 lignes sans le dire. Le meme piege a deja
// tronque en silence la lecture de analytics_yt_videos_history cote frontend, corrige
// la par une fonction SQL. Ici les tables sont en « une ligne par post » : 1000 posts
// est atteignable sur un compte ancien. On pagine explicitement.
const PAGE_POSTGREST = 1000;
async function lireTout<T = any>(construire: () => any): Promise<T[]> {
  const tout: T[] = [];
  for (let debut = 0; ; debut += PAGE_POSTGREST) {
    const { data, error } = await construire().range(debut, debut + PAGE_POSTGREST - 1);
    if (error || !data) break;
    tout.push(...(data as T[]));
    if (data.length < PAGE_POSTGREST) break;
  }
  return tout;
}

// `in.(…)` part dans l'URL : au-dela de quelques centaines d'identifiants, la requete
// est rejetee pour longueur. On decoupe.
const IDS_PAR_REQUETE_SQL = 200;
function parPaquets<T>(items: T[], taille: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += taille) out.push(items.slice(i, i + taille));
  return out;
}

export async function getIgCreds(supa: SupabaseClient, profileId: string): Promise<{ token: string; igAccountId: string } | null> {
  const { data: integ } = await supa
    .from('integrations')
    .select('access_token, expires_at, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) return null;

  const needsRefresh = integ.expires_at &&
    new Date(integ.expires_at).getTime() < Date.now() + 5 * 24 * 60 * 60 * 1000;

  let token = integ.access_token;
  if (needsRefresh) {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`);
    const d = await safeJson(r);
    if (d.access_token) {
      token = d.access_token;
      const expiresAt = d.expires_in ? new Date(Date.now() + d.expires_in * 1000).toISOString() : null;
      await supa.from('integrations').update({ access_token: token, expires_at: expiresAt })
        .eq('profile_id', profileId).eq('provider', 'instagram');
    }
  }

  const igAccountId: string | null = (integ.metadata as any)?.ig_account_id || null;
  if (!igAccountId) return null;
  return { token, igAccountId };
}

// ── Duree d'un post video, lue dans l'en-tete du fichier ────────────────────
//
// Meta ne sert AUCUN champ de duree sur l'objet media Instagram : `video_data`,
// `duration`, `video_duration` et `length` repondent tous « Tried accessing
// nonexisting field » sur graph.instagram.com (teste contre l'API reelle le
// 2026-08-29). `video_data` existe sur l'objet VIDEO de la Facebook Graph API,
// pas ici — c'est la confusion qui fait croire que la duree est inaccessible.
//
// Elle l'est par le fichier. `media_url` pointe le MP4 sur le CDN, et les fichiers
// Instagram sont en faststart : la boite `moov` (donc `mvhd`, qui porte l'echelle
// de temps et la duree) est au DEBUT. Une requete `Range` sur les premiers 400 Ko
// suffit — mesure : 390 Ko et ~1,1 s par post, duree exacte a la milliseconde.
//
// RIEN N'EST STOCKE. Les octets transitent en memoire, on lit un nombre, le reste
// est jete. Aucun fichier ne touche la base ni le stockage.
//
// Mesuree UNE SEULE FOIS par post (table ig_post_durees) : une duree ne change
// jamais. C'est le profil « donnee immuable » de docs/checklist-scalabilite.md.
const OCTETS_ENTETE_MP4 = 400_000;

export function dureeDepuisEnteteMp4(octets: Uint8Array): number | null {
  // Recherche de la signature `mvhd`. Elle est suivie d'un octet de version : 0 =
  // champs 32 bits, 1 = champs 64 bits. L'echelle de temps et la duree ne sont pas
  // au meme decalage dans les deux cas.
  for (let i = 0; i + 36 < octets.length; i++) {
    if (octets[i] !== 0x6d || octets[i + 1] !== 0x76 || octets[i + 2] !== 0x68 || octets[i + 3] !== 0x64) continue;
    const vue = new DataView(octets.buffer, octets.byteOffset + i, Math.min(48, octets.length - i));
    const version = vue.getUint8(4);
    let echelle: number, duree: number;
    if (version === 0) {
      echelle = vue.getUint32(16);
      duree = vue.getUint32(20);
    } else {
      echelle = vue.getUint32(24);
      // Les durees Instagram tiennent tres largement dans 53 bits : Number suffit.
      duree = Number(vue.getBigUint64(28));
    }
    if (!echelle || !duree) return null;
    const secondes = duree / echelle;
    // Garde-fou : une valeur absurde signifie qu'on est tombe sur une suite d'octets
    // qui ressemblait a `mvhd` sans en etre un. Mieux vaut ne rien ecrire.
    if (!Number.isFinite(secondes) || secondes <= 0 || secondes > 24 * 3600) return null;
    return Math.round(secondes * 100) / 100;
  }
  return null;
}

/** Mesure et enregistre la duree d'un post, si elle n'est pas deja connue.
 *  Rend `true` si un appel reseau a ete emis (pour que l'appelant compte son budget).
 *
 *  ⚠️ Cette fonction lit ig_post_durees pour savoir si la mesure existe deja : un
 *  aller-retour vers la base PAR POST. `snapshotIgPosts` ne l'appelle donc plus dans
 *  une boucle — il lit la table UNE fois par profil et n'appelle ceci que sur les
 *  posts reellement inconnus. Elle reste exportee et autonome pour les appels
 *  ponctuels (route de backfill, verification manuelle). */
export async function mesurerDureePost(
  supa: SupabaseClient,
  profileId: string,
  postId: string,
  mediaUrl: string | null,
  dejaConnu = false,
): Promise<boolean> {
  if (!dejaConnu) {
    const { data: deja } = await supa
      .from('ig_post_durees')
      .select('post_id')
      .eq('post_id', postId)
      .maybeSingle();
    if (deja) return false;
  }

  // Pas d'URL : Meta ne sert pas le fichier (observe sur les posts a musique
  // protegee — un sur douze). On le marque pour ne pas reessayer indefiniment.
  if (!mediaUrl) {
    await supa.from('ig_post_durees').upsert(
      { post_id: postId, profile_id: profileId, duree_sec: null, indisponible: true },
      { onConflict: 'post_id' },
    );
    return false;
  }

  try {
    const res = await fetch(mediaUrl, { headers: { Range: `bytes=0-${OCTETS_ENTETE_MP4 - 1}` } });
    // Pas de `if (res.ok)` muet : un echec doit rester distinguable d'une absence.
    // On ne marque PAS `indisponible` ici — l'URL du CDN expire, un 403 peut n'etre
    // que cela, et le post sera reessaye au prochain passage.
    if (!res.ok) return true;
    const octets = new Uint8Array(await res.arrayBuffer());
    const duree = dureeDepuisEnteteMp4(octets);
    await supa.from('ig_post_durees').upsert(
      duree != null
        ? { post_id: postId, profile_id: profileId, duree_sec: duree, indisponible: false }
        : { post_id: postId, profile_id: profileId, duree_sec: null, indisponible: true },
      { onConflict: 'post_id' },
    );
    return true;
  } catch {
    // Reseau : on ne conclut rien, on reessaiera.
    return true;
  }
}

/** Copie la vignette Meta dans le bucket permanent et retient l'URL dans
 *  `ig_post_vignettes` — une ligne par post, écrite une seule fois.
 *
 *  Avant le 2026-08-30, l'existence de la copie se vérifiait par un `storage.list()`
 *  PAR POST ET PAR PASSAGE (le cache mémoire ne vivait que le temps d'une
 *  invocation). C'est la table qui répond désormais, en une lecture par profil.
 *  `snapshotIgPosts` ne passe donc ici que pour les posts réellement inconnus. */
export async function getPermanentThumbnail(supa: SupabaseClient, postId: string, metaUrl: string | null, profileId?: string): Promise<string | null> {
  if (!metaUrl) return null;

  const chemin = `${postId}.jpg`;
  try {
    const imgRes = await fetch(metaUrl);
    if (!imgRes.ok) {
      console.log(`[getPermanentThumbnail] ${postId} fetch metaUrl HTTP ${imgRes.status}`);
      return null;
    }
    const buf = await imgRes.arrayBuffer();
    const { error } = await supa.storage.from(BUCKET_VIGNETTES)
      .upload(chemin, buf, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.log(`[getPermanentThumbnail] ${postId} upload storage erreur: ${error.message}`);
      return null;
    }
    const { data: { publicUrl } } = supa.storage.from(BUCKET_VIGNETTES).getPublicUrl(chemin);
    if (profileId) {
      await supa.from('ig_post_vignettes').upsert(
        { post_id: postId, profile_id: profileId, url: publicUrl, indisponible: false },
        { onConflict: 'post_id' },
      );
    }
    return publicUrl;
  } catch (e: any) {
    console.log(`[getPermanentThumbnail] ${postId} exception: ${e?.message || 'unknown'}`);
    return null;
  }
}

// ── Lecture de la liste des médias, paginée ──────────────────────────────────
//
// `limit=15` a disparu. Il n'était justifié nulle part (introduit le 2026-07-29
// dans un commit portant sur un autre sujet) et il laissait 85 % du catalogue d'un
// élève actif sans mise à jour. La pagination par curseur est celle de Meta.
//
// `complet` dit si on a atteint la fin du catalogue. Il n'est PAS utilisé pour
// élargir la détection de suppression — celle-ci reste bornée au post le plus
// ancien réellement reçu, règle qui vaut quelle que soit la profondeur atteinte.
async function listerMedias(igAccountId: string, token: string): Promise<{ posts: any[]; complet: boolean; erreur: string | null }> {
  const champs = 'id,caption,media_type,media_product_type,thumbnail_url,media_url,timestamp,like_count,comments_count,permalink';
  let url = `${GRAPH}/${igAccountId}/media?fields=${champs}&limit=${MEDIA_PAR_PAGE}&access_token=${token}`;
  const posts: any[] = [];
  const vus = new Set<string>();

  for (let page = 0; page < PAGES_MEDIA_MAX; page++) {
    let res: Response;
    try { res = await fetch(url); } catch (e: any) { return { posts, complet: false, erreur: `ig_posts_media reseau: ${e?.message || 'unknown'}` }; }
    const d = await safeJson(res);
    if (!res.ok || d?.error) {
      return { posts, complet: false, erreur: `ig_posts_media: HTTP ${res.status}${d?.error?.message ? ` — ${d.error.message}` : ''}` };
    }
    for (const p of (d.data || [])) {
      // Meta peut resservir un media a cheval sur deux pages quand une publication
      // intervient pendant la pagination. Sans cette dedup, le meme post partirait
      // deux fois dans le meme upsert groupe et Postgres refuserait le paquet
      // entier (« ON CONFLICT DO UPDATE ne peut pas affecter deux fois la meme
      // ligne ») — un post republie ferait donc perdre TOUT le profil.
      if (vus.has(p.id)) continue;
      vus.add(p.id);
      posts.push(p);
    }
    const suivant = d.paging?.next;
    if (!suivant) return { posts, complet: true, erreur: null };
    url = suivant;
  }
  return { posts, complet: false, erreur: null };
}

// ── Classification des erreurs Meta ──────────────────────────────────────────
//
// Chaque verdict décide d'une action IRRÉVERSIBLE (marquer un post muet pour
// toujours) ou d'un abandon. Le défaut est donc « transitoire » : devant une erreur
// inconnue, on ne conclut RIEN et on retentera. Même règle que la détection de
// suppression — ne jamais conclure au-delà de ce que la réponse démontre.
type Verdict = 'transitoire' | 'objet_definitif' | 'objet_temporaire' | 'metrique';

function classerErreur(status: number, err: any): Verdict {
  const code = Number(err?.code);
  const sousCode = Number(err?.error_subcode);
  const msg = String(err?.message || '');

  // Quotas, coupures, jeton : rien à conclure sur le post lui-même.
  if (status === 429 || status >= 500) return 'transitoire';
  if ([1, 2, 4, 17, 32, 190, 613].includes(code)) return 'transitoire';

  // « Publié avant la conversion du compte en compte professionnel. » Cette
  // condition ne se lève jamais : le post restera muet pour toujours.
  if (sousCode === 2108006) return 'objet_definitif';

  // La métrique demandée n'existe pas pour ce type de média, ou plus du tout.
  // C'est ce cas — et lui seul — que le découpage par métrique protégeait.
  if (/does not support the .* metric/i.test(msg)) return 'metrique';
  if (/must be one of the following values/i.test(msg)) return 'metrique';

  // Objet inaccessible (supprimé, passé en privé). Réessayable : le post
  // disparaîtra de /media de lui-même s'il a vraiment été supprimé.
  if (code === 100) return 'objet_temporaire';

  return 'transitoire';
}

type EtatPost = { jeu: 'complet' | 'reduit' | 'aucun'; reessayerApres: string | null };
type ErreurMeta = { code: number | null; sousCode: number | null; message: string };
type Muet = ErreurMeta & { definitif: boolean };

type Recolte = {
  valeurs: Map<string, Record<string, number>>;
  muets: Map<string, Muet>;
  degrades: Map<string, ErreurMeta>;
  incident: string | null;
  appelsDichotomie: number;
};

/** Lit les insights d'un lot de posts en UN appel, et n'isole par dichotomie que
 *  si Meta refuse — un post fautif coûte alors log2(25) ≈ 5 appels UNE fois, puis
 *  plus jamais : son refus est retenu dans ig_post_insights_etat. */
async function lireLot(token: string, ids: string[], metriques: string[], r: Recolte): Promise<void> {
  if (r.incident) return;

  const url = `${GRAPH}/?ids=${ids.join(',')}&fields=insights.metric(${metriques.join(',')})&access_token=${token}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e: any) {
    r.incident = `insights reseau: ${e?.message || 'unknown'}`;
    return;
  }
  const d = await safeJson(res);

  if (res.ok && !d?.error) {
    for (const [postId, objet] of Object.entries<any>(d)) {
      const valeurs: Record<string, number> = {};
      for (const item of (objet?.insights?.data ?? [])) {
        // `?? ` et non `||` : une métrique légitimement à 0 doit rester 0.
        const v = item?.values?.[0]?.value ?? item?.total_value?.value ?? null;
        if (v !== null && v !== undefined && typeof v === 'number') valeurs[item.name] = v;
      }
      r.valeurs.set(postId, valeurs);
    }
    return;
  }

  const verdict = classerErreur(res.status, d?.error);
  const err = { code: Number(d?.error?.code) || null, sousCode: Number(d?.error?.error_subcode) || null, message: String(d?.error?.message || `HTTP ${res.status}`) };

  // Rien à conclure : on abandonne la lecture des insights pour ce profil et on
  // retentera au passage suivant. Écrire un zéro ici serait indiscernable d'une
  // vraie absence de vues.
  if (verdict === 'transitoire') {
    r.incident = `insights: ${err.message}`;
    return;
  }

  if (ids.length > 1) {
    if (r.appelsDichotomie >= APPELS_DICHOTOMIE_MAX) {
      r.incident = `insights: plafond de dichotomie atteint (${APPELS_DICHOTOMIE_MAX} appels) — reprise au prochain passage`;
      return;
    }
    const moitie = Math.ceil(ids.length / 2);
    r.appelsDichotomie += 2;
    await lireLot(token, ids.slice(0, moitie), metriques, r);
    await lireLot(token, ids.slice(moitie), metriques, r);
    return;
  }

  const postId = ids[0];

  // Un seul post, et c'est la métrique qui est refusée : on retombe sur le jeu
  // commun plutôt que de perdre les 5 métriques qui auraient répondu. C'est ce
  // qui rend une dépréciation Meta indolore — la plateforme perd la métrique
  // concernée, pas la ligne entière, et sans intervention.
  if (verdict === 'metrique' && metriques.length > METRIQUES_COMMUNES.length) {
    r.degrades.set(postId, err);
    r.appelsDichotomie += 1;
    await lireLot(token, [postId], METRIQUES_COMMUNES, r);
    return;
  }

  r.muets.set(postId, { definitif: verdict === 'objet_definitif', ...err });
}

async function lireInsights(
  token: string,
  aLire: { id: string; metriques: string[] }[],
): Promise<Recolte> {
  const r: Recolte = { valeurs: new Map(), muets: new Map(), degrades: new Map(), incident: null, appelsDichotomie: 0 };

  // Regroupement par jeu de métriques identique : Meta n'accepte qu'un seul
  // `fields=` par appel, un Reel et un post FEED ne peuvent donc pas voyager
  // ensemble.
  const parJeu = new Map<string, string[]>();
  for (const p of aLire) {
    const cle = p.metriques.join(',');
    if (!parJeu.has(cle)) parJeu.set(cle, []);
    parJeu.get(cle)!.push(p.id);
  }

  const lots: { ids: string[]; metriques: string[] }[] = [];
  for (const [cle, ids] of parJeu) {
    const metriques = cle.split(',');
    for (let i = 0; i < ids.length; i += IDS_PAR_APPEL) {
      lots.push({ ids: ids.slice(i, i + IDS_PAR_APPEL), metriques });
    }
  }

  // Concurrence bornée : accélérer n'économise aucun appel (le quota Meta compte
  // les appels, pas leur vitesse), mais tenir dans les 150 s en dépend.
  let curseur = 0;
  const ouvrier = async () => {
    for (;;) {
      const i = curseur++;
      if (i >= lots.length || r.incident) return;
      await lireLot(token, lots[i].ids, lots[i].metriques, r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOTS_EN_PARALLELE, lots.length) }, ouvrier));

  return r;
}

// Guard : si des snapshots existent déjà pour `yesterday`, on ne refetch pas — le cron
// régulier n'a besoin de figer les métriques qu'1x/jour. skipGuard=true (bouton
// "Actualiser" côté frontend) force le refetch pour rafraîchir la LISTE de posts
// (nouveaux publiés/supprimés) sans attendre le lendemain — l'upsert reste idempotent
// pour les métriques d'un post déjà snapshotté (Meta ne les change pas rétroactivement).
export async function snapshotIgPosts(
  supa: SupabaseClient,
  profileId: string,
  token: string,
  igAccountId: string,
  yesterday: string,
  skipGuard = false,
  notifyConfig?: { platformUrl: string; cronSecret: string },
  echeanceMs?: number,
): Promise<string[]> {
  const errors: string[] = [];
  // Les travaux facultatifs (vignettes, durées) s'arrêtent à l'échéance et
  // reprennent au passage suivant. Les insights, eux, ne sont pas facultatifs :
  // ils sont la raison d'être du snapshot, et ils coûtent désormais assez peu pour
  // ne jamais être la cause d'un dépassement.
  const budgetEpuise = () => echeanceMs != null && Date.now() >= echeanceMs;

  try {
    if (!skipGuard) {
      // ig_account_id + archived_at : cette garde empêche de reprendre deux fois le
      // snapshot du même jour. Sans les filtres de compte, les lignes archivées d'un
      // compte précédent portant la même snapshot_date la font croire déjà prise —
      // et le snapshot du NOUVEAU compte n'est jamais enregistré ce jour-là, laissant
      // un trou d'un jour dans son historique. Les deux requêtes suivantes de ce
      // fichier filtrent déjà ainsi ; seule celle-ci avait été oubliée.
      const { count } = await supa.from('analytics_ig_posts_history')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', profileId)
        .eq('ig_account_id', igAccountId)
        .is('archived_at', null)
        .eq('snapshot_date', yesterday);
      if (count && count > 0) return [];
    }

    const { posts, erreur: erreurMedia } = await listerMedias(igAccountId, token);
    if (erreurMedia && posts.length === 0) return [erreurMedia];
    if (erreurMedia) errors.push(erreurMedia);

    // Un post absent de la réponse Meta actuelle mais présent en base (parmi les 90
    // derniers jours, fenêtre couverte par /media limit=15+90j ailleurs dans ce fichier)
    // a été supprimé côté Instagram — on le marque deleted_at plutôt que de l'effacer :
    // l'historique de stats (analytics, rapports passés) doit rester intact, seul
    // "Gérer mes liens" doit filtrer ces posts (deleted_at is null).
    // Filtre ig_account_id + archived_at IS NULL obligatoire : sinon un post d'un AUTRE
    // compte (archivé après une bascule, donc invisible mais toujours en base) se
    // retrouve marqué "supprimé" à tort dès que ce compte n'est plus le compte actif —
    // bug trouvé le 2026-07-29 en testant le cycle A→B→A (le post de A disparaissait
    // définitivement de "Gérer mes liens" après un passage par B, alors qu'il n'avait
    // jamais été supprimé sur Instagram).
    const currentPostIds = new Set(posts.map((p: any) => p.id));

    // ⚠️ NE JAMAIS conclure au-dela de ce que le fetch a REELLEMENT couvert.
    //
    // Deux gardes, toutes deux absentes jusqu'au 2026-08-30.
    //
    // 1. `posts` vide — un hoquet de Meta, une reponse tronquee — faisait marquer
    //    SUPPRIMES d'un coup tous les posts des 90 derniers jours. Aucun ne l'aurait
    //    ete, et la marque ne se leve pas toute seule.
    //
    // 2. `/media` etait appele avec `limit=15`, mais la fenetre de jugement etait de
    //    90 JOURS. Un eleve postant deux fois par semaine (26 posts en 90 jours) en
    //    aurait vu onze marques supprimes alors qu'ils existent.
    //
    // La borne est donc le post le PLUS ANCIEN reellement renvoye. Au-dela, le fetch
    // n'a rien vu : on ne sait pas, donc on ne conclut pas. La pagination complete
    // rend desormais cette borne tres large, mais la regle ne change pas — elle
    // protege aussi le cas d'une pagination interrompue en cours de route.
    if (posts.length === 0) return errors;

    const plusAncienRecuMs = posts.reduce((min: number | null, p: any) => {
      const t = Date.parse(p.timestamp);
      if (!Number.isFinite(t)) return min;
      return min === null || t < min ? t : min;
    }, null as number | null);
    const since90dMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const since90d = new Date(
      plusAncienRecuMs !== null ? Math.max(plusAncienRecuMs, since90dMs) : since90dMs,
    ).toISOString();
    const existingRows = await lireTout(() => supa.from('analytics_ig_posts_history')
      .select('post_id')
      .eq('profile_id', profileId)
      .eq('ig_account_id', igAccountId)
      .is('deleted_at', null)
      .is('archived_at', null)
      .gte('published_at', since90d));
    const missingPostIds = [...new Set(existingRows.map((r: any) => r.post_id))]
      .filter((id: string) => !currentPostIds.has(id));
    for (const paquet of parPaquets(missingPostIds, IDS_PAR_REQUETE_SQL)) {
      await supa.from('analytics_ig_posts_history')
        .update({ deleted_at: new Date().toISOString() })
        .eq('profile_id', profileId)
        // Mêmes filtres que le SELECT ci-dessus : sans eux, l'UPDATE annulait la
        // protection que ce SELECT venait d'appliquer. Un post_id présent dans deux
        // comptes (republication, ou cycle A→B→A) voyait les lignes des DEUX comptes
        // marquées supprimées, y compris celles explicitement écartées juste avant.
        .eq('ig_account_id', igAccountId)
        .is('archived_at', null)
        .in('post_id', paquet);
    }

    // Détection de nouveaux posts, bornée aux publications récentes — voir
    // NOUVEAU_POST_FENETRE_JOURS. Un post_id absent de TOUTE ligne antérieure est
    // nouveau pour la base ; encore faut-il qu'il soit nouveau pour l'élève.
    const fenetreNouveauMs = Date.now() - NOUVEAU_POST_FENETRE_JOURS * 24 * 60 * 60 * 1000;
    const candidatsNouveaux = posts
      .filter((p: any) => Date.parse(p.timestamp) >= fenetreNouveauMs)
      .map((p: any) => p.id);
    let newPostIds: string[] = [];
    if (candidatsNouveaux.length > 0) {
      const everSeenIds = new Set<string>();
      for (const paquet of parPaquets(candidatsNouveaux, IDS_PAR_REQUETE_SQL)) {
        const vus = await lireTout(() => supa.from('analytics_ig_posts_history')
          .select('post_id')
          .eq('profile_id', profileId)
          .eq('ig_account_id', igAccountId)
          .in('post_id', paquet));
        for (const r of vus) everSeenIds.add((r as any).post_id);
      }
      newPostIds = candidatsNouveaux.filter((id) => !everSeenIds.has(id));
    }

    const snapshotAt = new Date().toISOString();

    // ── Trois lectures par profil, au lieu de trois par POST ──────────────────
    const [vignettesRows, dureesRows, etatsRows] = await Promise.all([
      lireTout(() => supa.from('ig_post_vignettes').select('post_id, url, indisponible').eq('profile_id', profileId)),
      lireTout(() => supa.from('ig_post_durees').select('post_id').eq('profile_id', profileId)),
      lireTout(() => supa.from('ig_post_insights_etat').select('post_id, jeu_metriques, reessayer_apres').eq('profile_id', profileId)),
    ]);
    const vignetteConnue = new Map<string, string | null>();
    for (const v of vignettesRows) vignetteConnue.set((v as any).post_id, (v as any).url ?? null);
    const dureeConnue = new Set(dureesRows.map((d: any) => d.post_id));
    const etatParPost = new Map<string, EtatPost>();
    for (const e of etatsRows as any[]) {
      etatParPost.set(e.post_id, { jeu: e.jeu_metriques, reessayerApres: e.reessayer_apres });
    }

    // ── Quels posts interroger, et avec quel jeu de métriques ─────────────────
    const maintenant = Date.now();
    const aLire: { id: string; metriques: string[] }[] = [];
    for (const post of posts) {
      const isReel = post.media_product_type === 'REELS' || post.media_type === 'VIDEO';
      const etat = etatParPost.get(post.id);
      if (etat) {
        const expire = etat.reessayerApres ? Date.parse(etat.reessayerApres) <= maintenant : false;
        // 'aucun' + reessayer_apres null = définitif : ce post ne rendra jamais rien,
        // l'inclure ferait échouer tout son lot. C'est cette exclusion qui rend le
        // groupage possible, pas seulement économique.
        if (etat.jeu === 'aucun' && !expire) continue;
        if (etat.jeu === 'reduit' && !expire) { aLire.push({ id: post.id, metriques: METRIQUES_COMMUNES }); continue; }
      }
      aLire.push({ id: post.id, metriques: isReel ? METRIQUES_REELS : METRIQUES_FEED });
    }

    const recolte = await lireInsights(token, aLire);
    if (recolte.incident) errors.push(recolte.incident);

    // ── Vignettes : uniquement les posts sans copie connue, borné par passage ──
    const vignettesATraiter = posts
      .filter((p: any) => !vignetteConnue.has(p.id) && (p.thumbnail_url || p.media_url))
      .slice(0, VIGNETTES_PAR_PASSAGE);
    if (vignettesATraiter.length && !budgetEpuise()) {
      let curseur = 0;
      const ouvrier = async () => {
        for (;;) {
          const i = curseur++;
          if (i >= vignettesATraiter.length || budgetEpuise()) return;
          const p = vignettesATraiter[i];
          const url = await getPermanentThumbnail(supa, p.id, p.thumbnail_url || p.media_url || null, profileId);
          if (url) {
            vignetteConnue.set(p.id, url);
          } else {
            // Échec : on retient « essayé, Meta n'a pas servi l'image » pour ne pas
            // reprendre 500 téléchargements chaque nuit. La ligne du snapshot gardera
            // l'URL Meta du jour, qui reste affichable tant qu'elle n'a pas expiré.
            await supa.from('ig_post_vignettes').upsert(
              { post_id: p.id, profile_id: profileId, url: null, indisponible: true },
              { onConflict: 'post_id' },
            );
            vignetteConnue.set(p.id, null);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(VIGNETTES_EN_PARALLELE, vignettesATraiter.length) }, ouvrier));
    }

    // ── Durées : uniquement les Reels sans mesure, borné par passage ───────────
    const dureesATraiter = posts
      .filter((p: any) => (p.media_product_type === 'REELS' || p.media_type === 'VIDEO') && !dureeConnue.has(p.id))
      .slice(0, DUREES_PAR_PASSAGE);
    if (dureesATraiter.length && !budgetEpuise()) {
      let curseur = 0;
      const ouvrier = async () => {
        for (;;) {
          const i = curseur++;
          if (i >= dureesATraiter.length || budgetEpuise()) return;
          const p = dureesATraiter[i];
          try {
            // dejaConnu=true : la table a déjà été lue en une fois plus haut, inutile
            // de la réinterroger post par post.
            await mesurerDureePost(supa, profileId, p.id, p.media_url || null, true);
          } catch (e: any) {
            console.log(`[snapshotIgPosts] ${p.id} duree ignoree: ${e?.message || 'unknown'}`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(DUREES_EN_PARALLELE, dureesATraiter.length) }, ouvrier));
    }

    // ── Écriture : un upsert par paquet de 200, pas un par post ────────────────
    const lignes: Record<string, any>[] = [];
    for (const post of posts) {
      const isReel = post.media_product_type === 'REELS' || post.media_type === 'VIDEO';
      const m = recolte.valeurs.get(post.id) ?? {};
      const metaThumbnailUrl = post.thumbnail_url || post.media_url || null;
      const vignette = vignetteConnue.get(post.id) ?? null;

      // ⚠️ Un post dont les insights n'ont PAS été lus ce passage (incident réseau,
      // plafond de dichotomie) ne doit pas écrire des null par-dessus des chiffres
      // connus : la ligne du jour n'existe pas encore, mais celle de la veille, si.
      // Écrire null ici ferait disparaître le post des écrans. On saute la ligne —
      // un trou dit « on ne sait pas », un zéro affirme quelque chose.
      const insightsLus = recolte.valeurs.has(post.id) || recolte.muets.has(post.id) || etatParPost.get(post.id)?.jeu === 'aucun';
      if (!insightsLus) continue;

      const row: Record<string, any> = {
        profile_id: profileId,
        post_id: post.id,
        post_type: post.media_product_type || post.media_type || 'IMAGE',
        caption: (post.caption || '').slice(0, 500),
        permalink: post.permalink || null,
        thumbnail: vignette || metaThumbnailUrl,
        published_at: post.timestamp ? new Date(post.timestamp).toISOString() : null,
        reach: m['reach'] ?? null,
        views: m['views'] ?? null,
        likes: post.like_count ?? null,
        comments: post.comments_count ?? null,
        saves: m['saved'] ?? null,
        shares: m['shares'] ?? null,
        follows: m['follows'] ?? null,
        profile_visits: m['profile_visits'] ?? null,
        total_interactions: m['total_interactions'] ?? null,
        snapshot_date: yesterday,
        snapshot_at: snapshotAt,
        // Dé-marque explicitement si ce post avait été précédemment marqué supprimé
        // (republié, ou faux positif d'une exécution antérieure) — un post présent
        // dans la réponse Meta actuelle n'est par définition pas supprimé.
        deleted_at: null,
        ig_account_id: igAccountId,
      };
      if (isReel) {
        row.avg_watch_time_ms = m['ig_reels_avg_watch_time'] ?? null;
        row.total_watch_time_ms = m['ig_reels_video_view_total_time'] ?? null;
        row.skip_rate = m['reels_skip_rate'] ?? null;
      }
      lignes.push(row);
    }

    for (let i = 0; i < lignes.length; i += LIGNES_PAR_UPSERT) {
      const paquet = lignes.slice(i, i + LIGNES_PAR_UPSERT);
      const { error } = await supa.from('analytics_ig_posts_history')
        .upsert(paquet, { onConflict: 'profile_id,post_id,snapshot_date', ignoreDuplicates: false });
      if (error) {
        errors.push(`ig_post_upsert_paquet_${i}: ${error.message}`);
        console.log(`[snapshotIgPosts] upsert paquet ${i} ÉCHEC (${paquet.length} lignes): ${JSON.stringify(error)}`);
      }
    }

    // ── Mémoire des refus : ce qui rend le groupage tenable dans la durée ──────
    const etatsAEcrire: Record<string, any>[] = [];
    for (const [postId, err] of recolte.muets) {
      etatsAEcrire.push({
        post_id: postId, profile_id: profileId, ig_account_id: igAccountId,
        jeu_metriques: 'aucun',
        code: err.code, sous_code: err.sousCode, message: err.message.slice(0, 500),
        constate_le: snapshotAt,
        // Définitif = plus jamais demandé. Sinon, on redonne sa chance dans 7 jours :
        // une panne passagère ne doit pas condamner un post à vie.
        reessayer_apres: err.definitif ? null : new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      });
    }
    for (const [postId, err] of recolte.degrades) {
      // Le jeu réduit est réévalué tous les 30 jours : si Meta rétablit la métrique,
      // la plateforme la récupère sans que personne n'ait à y penser.
      etatsAEcrire.push({
        post_id: postId, profile_id: profileId, ig_account_id: igAccountId,
        jeu_metriques: 'reduit',
        code: err.code, sous_code: err.sousCode, message: err.message.slice(0, 500),
        constate_le: snapshotAt,
        reessayer_apres: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      });
    }
    // Un post qui répond de nouveau normalement efface son état : sans ça, un post
    // rétabli resterait marqué muet pour toujours.
    const retablis = [...recolte.valeurs.keys()].filter((id) => {
      const e = etatParPost.get(id);
      return e && e.jeu !== 'complet' && !recolte.degrades.has(id) && !recolte.muets.has(id);
    });
    if (retablis.length) {
      // Seulement ceux lus avec le jeu COMPLET — un post lu en 'reduit' répond bien,
      // mais ça ne prouve pas que ses métriques étendues sont revenues.
      const lusEnComplet = retablis.filter((id) => {
        const p = posts.find((x: any) => x.id === id);
        if (!p) return false;
        const isReel = p.media_product_type === 'REELS' || p.media_type === 'VIDEO';
        const attendu = isReel ? METRIQUES_REELS : METRIQUES_FEED;
        const lu = recolte.valeurs.get(id) ?? {};
        return attendu.every((metrique) => metrique in lu);
      });
      for (const paquet of parPaquets(lusEnComplet, IDS_PAR_REQUETE_SQL)) {
        await supa.from('ig_post_insights_etat').delete().eq('profile_id', profileId).in('post_id', paquet);
      }
    }
    for (let i = 0; i < etatsAEcrire.length; i += LIGNES_PAR_UPSERT) {
      const { error } = await supa.from('ig_post_insights_etat')
        .upsert(etatsAEcrire.slice(i, i + LIGNES_PAR_UPSERT), { onConflict: 'post_id' });
      if (error) errors.push(`ig_post_insights_etat: ${error.message}`);
    }

    // Notif "nouveau post détecté" — générique, pas de lien lead magnet automatique
    // (ça reste un geste manuel de l'élève via "Gérer mes liens"). Pas de flag
    // supplémentaire nécessaire : dès que l'upsert ci-dessus crée la ligne du jour pour
    // ce post_id, il n'apparaîtra plus jamais dans newPostIds au run suivant.
    if (newPostIds.length > 0 && notifyConfig) {
      await Promise.allSettled(newPostIds.map(async (postId) => {
        try {
          const res = await fetch(`${notifyConfig.platformUrl}/api/push/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${notifyConfig.cronSecret}` },
            body: JSON.stringify({
              profileId,
              title: 'Nouveau post détecté',
              body: 'Un nouveau post Instagram a été repéré sur ton compte.',
              url: '/client/liens',
            }),
          });
          if (!res.ok) errors.push(`new_post_push_${postId}: HTTP ${res.status}`);
        } catch (e: any) {
          errors.push(`new_post_push_${postId}: ${e?.message || 'unknown'}`);
        }
      }));
    }
  } catch (e: any) { errors.push(`ig_posts_snapshot: ${e?.message || 'unknown'}`); }
  return errors;
}
