/**
 * Traitement des événements webhook Instagram.
 *
 * Extrait de `app/api/webhooks/instagram/route.ts` : Next.js n'autorise que
 * `GET`/`POST`/… comme exports d'un fichier `route.ts` et supprime les autres à
 * la compilation — impossible d'y importer une fonction. Ce module existe donc
 * pour que le worker de file (`app/api/cron/process-webhook-queue`) puisse
 * appeler le même traitement que le webhook.
 *
 * Pourquoi une file : Meta exige une réponse en moins de 30 s et DÉSABONNE
 * l'application si les échecs durent 1 h — les DM1 s'arrêtent alors complètement,
 * réabonnement manuel requis. Le traitement synchrone mesurait 2,15 s de moyenne
 * mais 15,55 s au pic, avec UN SEUL compte actif. À 30 élèves, Meta envoie une
 * requête HTTP par commentaire, en parallèle : un post viral suffisait à franchir
 * les 30 s.
 *
 * La fenêtre de private reply est de 7 JOURS côté Meta : un pic de plusieurs
 * milliers de commentaires peut donc s'étaler sur des heures sans rien perdre.
 */
import { createClient } from '@supabase/supabase-js';
import { CALL_TYPES_VENTE } from '@/lib/callTypes';
import { pushEvent } from '@/app/api/instagram/webhook-stream/route';
import { estSortant, estLeCompte, typePieceJointe, estSuppression } from '@/lib/igConversations';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);


function sanitizeInstagramUsername(raw: string): string {
  return raw.toLowerCase().trim().replace(/^@/, '').replace(/\s+/g, '').replace(/[^a-z0-9._]/g, '');
}

// Debug temporaire — les logs Vercel CLI ne capturent qu'un seul message par
// invocation serverless (rétention courte, indexation lente), insuffisant pour
// tracer un flux multi-étapes. Écrit en base pour un accès SQL immédiat et fiable.
// À supprimer une fois l'investigation terminée (voir TODOS.md).
function debugLog(message: string, data?: any) {
  serviceSupabase.from('webhook_debug_log').insert({ message, data: data ?? null }).then();
}

/**
 * Un refus Meta est-il TRANSITOIRE (rate limit, panne passagère) ?
 *
 * Transitoire → on LÈVE, pour que la file (process-webhook-queue) retente avec
 * son backoff : la fenêtre private reply est de 7 jours, un 429 pendant une
 * rafale se rattrape seul. Définitif (fenêtre refermée, permission, blocage) →
 * on trace et on continue : réessayer ne changerait rien.
 *
 * Avant (audit du 2026-09-02), TOUT refus marquait l'item `done` : un 429
 * pendant un post viral — précisément le moment où les leads affluent —
 * perdait le DM1 pour toujours, alors qu'un retry aurait réussi.
 *
 * Codes Meta : 4 = app rate limit, 17 = user rate limit, 613 = calls limit,
 * 2 = service temporairement indisponible ; `is_transient` quand Meta le dit
 * lui-même. Réf. développeurs Meta « error codes ».
 */
function estErreurMetaTransitoire(err: { code?: number; is_transient?: boolean } | null | undefined): boolean {
  if (!err) return false;
  if (err.is_transient === true) return true;
  return [2, 4, 17, 613].includes(Number(err.code));
}

/**
 * Trace en base un refus de Meta sur un envoi de DM.
 *
 * Le resultat de ces envois ne partait que dans `console.error` et `pushEvent`
 * — un flux en memoire perdu a la fin de la requete. Le 2026-08-28, trois DM1
 * ont ete refuses par Meta sans qu'aucune trace n'en subsiste : la fiche du
 * lead affichait `lead_magnet_sent` a true, le badge s'affichait, et le
 * prospect n'avait rien recu. Il a fallu rejouer l'appel a la main pour
 * decouvrir le motif (`error_subcode 2534014`).
 *
 * C'est le pire mode de defaillance pour cette plateforme : silencieux, et il
 * fait perdre des prospects. `cron_runs` est la table de sante que decrit
 * AGENTS.md (`select * from cron_runs` — vide = aucun incident), donc un echec
 * d'envoi y devient visible sans dependre des logs Vercel.
 *
 * Volontairement non bloquant : tracer un echec ne doit jamais en provoquer un
 * second, ni interrompre le traitement des evenements suivants de la file.
 */
function tracerEchecEnvoi(etape: string, profileId: string | null, erreur: any, contexte: Record<string, unknown> = {}) {
  console.error(`[IG Webhook] ${etape} refuse par Meta :`, JSON.stringify(erreur));
  const sousCode = erreur?.error_subcode ?? null;
  serviceSupabase.from('cron_runs').insert({
    fonction: 'ig_envoi_dm',
    profils_en_erreur: 1,
    erreurs: {
      etape,
      profile_id: profileId,
      // Le sous-code porte le motif reel — 2534014 signale un private reply
      // refuse, notamment sur un commentaire qui en a deja recu un (Meta n'en
      // autorise qu'UN par commentaire, cf. app/api/webhooks/instagram/route.ts).
      code: erreur?.code ?? null,
      error_subcode: sousCode,
      message: erreur?.message ?? null,
      ...contexte,
    },
  }).then(({ error }) => {
    if (error) console.error('[IG Webhook] trace cron_runs impossible:', error.message);
    else alerterExploitant(etape, sousCode, erreur?.message ?? null);
  });
}

/**
 * Sous-codes Meta connus comme benins.
 *
 * 2534014 (« l'utilisateur demande est introuvable ») tombe surtout quand une
 * reponse privee a deja ete envoyee sur ce commentaire : Meta n'en autorise
 * qu'UNE. Le webhook et le cron de rattrapage peuvent traiter le meme
 * commentaire, donc ce refus survient normalement, sans qu'aucun prospect ne
 * soit perdu — le premier envoi, lui, est bien parti.
 *
 * Il ne devient interessant que s'il se REPETE beaucoup : ce serait alors le
 * signe que les deux chemins se marchent systematiquement dessus.
 */
const SOUS_CODES_BENINS = new Set([2534014]);

/**
 * Previent l'exploitant, avec de quoi trancher immediatement entre « incident
 * isole » et « a corriger maintenant ».
 *
 * Une trace que personne ne lit ne vaut guere mieux qu'une panne silencieuse :
 * `cron_runs` n'est consulte que si on pense a le faire. Mais notifier a chaque
 * echec produirait du bruit, et du bruit finit ignore — donc pas de notification
 * sans element de jugement. C'est le COMPTE sur 24 h qui porte l'information :
 * une premiere occurrence n'a pas le meme sens que la trentieme.
 *
 * D'ou deux seuils seulement, pour ne prevenir qu'aux moments ou la reponse
 * change : la premiere fois (« c'est arrive »), et le franchissement du seuil de
 * repetition (« ce n'est plus un hasard »). Entre les deux, on se tait.
 *
 * Sans ALERT_PROFILE_ID la fonction ne fait rien : la trace en base reste, seule
 * la notification est desactivee.
 */
function alerterExploitant(etape: string, sousCode: number | null, message: string | null) {
  const destinataire = process.env.ALERT_PROFILE_ID;
  const base = process.env.NEXT_PUBLIC_PLATFORM_URL;
  if (!destinataire || !base || !process.env.CRON_SECRET) return;

  const benin = sousCode !== null && SOUS_CODES_BENINS.has(sousCode);
  const seuilRepetition = benin ? 20 : 5;

  (async () => {
    const depuis = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let requete = serviceSupabase
      .from('cron_runs')
      .select('*', { count: 'exact', head: true })
      .eq('fonction', 'ig_envoi_dm')
      .gte('ran_at', depuis);
    // Un sous-code absent ne doit pas etre compte avec les autres : on compare
    // alors sur l'etape, faute de mieux.
    requete = sousCode === null
      ? requete.eq('erreurs->>etape', etape)
      : requete.eq('erreurs->>error_subcode', String(sousCode));

    const { count, error } = await requete;
    if (error || count === null) return;

    // On ne parle qu'aux deux moments ou la conclusion change.
    if (count !== 1 && count !== seuilRepetition) return;

    const verdict = count === 1
      ? (benin
          ? 'isolé — probablement un même commentaire traité deux fois, rien à faire'
          : 'première occurrence — à surveiller')
      : (benin
          ? `${count} fois en 24 h — les deux chemins se marchent dessus, à regarder`
          : `${count} fois en 24 h — récurrent, à corriger maintenant`);

    await fetch(`${base}/api/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${process.env.CRON_SECRET}` },
      body: JSON.stringify({
        profileId: destinataire,
        title: 'Momentum — envoi Instagram refusé',
        body: `${etape}${sousCode ? ` · code ${sousCode}` : ''} — ${verdict}${message ? `\n${message}` : ''}`,
        url: '/client/pipeline',
      }),
    });
  })().catch(e => console.error('[IG Webhook] alerte exploitant impossible:', e?.message || e));
}

// Insensible à la casse ET aux accents pour le matching mot-clé lead magnet — "Méta"
// doit matcher le mot-clé "Meta" configuré par le coach (demande explicite Chris,
// 2026-07-30). NFD décompose les caractères accentués en (lettre de base + diacritique
// séparé), le \p{Diacritic} retire ensuite juste le diacritique.
function normalizeForKeywordMatch(raw: string): string {
  return raw.toLowerCase().trim().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

async function fetchAndStoreAvatar(igUserId: string, accessToken: string): Promise<string | null> {
  try {
    const profileRes = await fetch(
      `https://graph.instagram.com/v22.0/${igUserId}?fields=profile_pic&access_token=${accessToken}`
    );
    if (!profileRes.ok) return null;
    const profileData = await profileRes.json();
    const profilePicUrl: string | undefined = profileData?.profile_pic;
    if (!profilePicUrl) return null;

    const imgRes = await fetch(profilePicUrl);
    if (!imgRes.ok) return null;
    const blob = await imgRes.blob();
    const arrayBuffer = await blob.arrayBuffer();

    const { error: uploadError } = await serviceSupabase.storage
      .from('instagram-avatars')
      .upload(`${igUserId}.jpg`, arrayBuffer, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) return null;

    const { data: { publicUrl } } = serviceSupabase.storage
      .from('instagram-avatars')
      .getPublicUrl(`${igUserId}.jpg`);

    return publicUrl;
  } catch {
    return null;
  }
}

/**
 * La même empreinte que celle posée par `enregistrer_message_ig` en base :
 * sha256 tronqué à 16 octets, en hexadécimal. Elle sert de nom de fichier, ce
 * qui évite une colonne de plus — le chemin se déduit du message.
 *
 * ⚠️ Doit rester IDENTIQUE à la formule SQL
 * `substring(digest(mid,'sha256') from 1 for 16)`. Si l'une des deux change,
 * les fichiers deviennent introuvables sans qu'aucune erreur ne le dise.
 */
async function empreinteMid(mid: string): Promise<string> {
  const octets = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(mid));
  return Array.from(new Uint8Array(octets).slice(0, 16))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Le type d'un message vocal, corrigé de ce que Meta en dit.
 *
 * ⚠️ MESURE DU 2026-09-04, sur un vrai vocal reçu : Meta le sert avec
 * `content-type: video/mp4`. Le bucket l'a refusé — `mime type video/mp4 is not
 * supported` — et le vocal a été perdu, puisque Meta ne le ressert jamais.
 *
 * Ce n'est pas vraiment une erreur de leur part : un `.m4a` EST un conteneur
 * MPEG-4, et `audio/mp4` ne se distingue de `video/mp4` que par l'absence de
 * piste vidéo. Mais c'est nous qui savons que la pièce jointe est un vocal —
 * Meta l'a déclaré `type: 'audio'` dans la charge utile. **La déclaration de
 * la pièce jointe fait autorité, pas l'en-tête de transport.**
 *
 * ⚠️ On ne force pas `audio/mp4` aveuglément pour autant : le jour où Meta
 * servira de l'Opus, l'étiqueter en MPEG-4 serait un mensonge à notre tour. On
 * ne corrige donc QUE ce qui n'est pas déjà un type audio.
 */
function typeAudio(entete: string | null): string {
  const brut = (entete || '').split(';')[0].trim().toLowerCase();
  return brut.startsWith('audio/') ? brut : 'audio/mp4';
}

/**
 * Archive un message Instagram pour que le coach puisse le relire et l'annoter.
 *
 * ⚠️ N'ÉCRIT RIEN tant que l'élève n'a pas accordé la lecture à son coach. La
 * garde vit dans la fonction Postgres, pas ici : aucun appelant futur ne peut
 * l'oublier. Sans accord, la RPC ne rend aucune ligne et on s'arrête sans même
 * appeler Meta.
 *
 * ⚠️ UNE requête par message, jamais quatre. L'egress Supabase se paie au NOMBRE
 * de requêtes : à 40 élèves, quatre requêtes par message auraient ajouté
 * 24 000 requêtes/jour sur un budget mesuré à ~66 000 (voir AGENTS.md).
 *
 * ⚠️ Avale ses erreurs, volontairement. Un fil non archivé est un manque à
 * l'écran, rattrapable ; une exception ici ferait échouer l'événement entier et
 * donc le DM1 qui suit — et Meta n'autorise qu'UNE réponse privée par
 * commentaire, donc un DM1 perdu l'est définitivement.
 */
async function enregistrerPourLeCoach(
  messaging: any,
  profileId: string,
  igAccountId: string,
  entryId: string,
  accessToken: string | null,
): Promise<void> {
  try {
    // Un accusé de lecture, une réaction ou un postback n'est pas un message :
    // pas de `mid`, rien à archiver.
    const mid: string | undefined = messaging?.message?.mid;
    if (!mid) return;

    // ── Un message RETIRÉ d'Instagram est retiré d'ici ────────────────────
    // Meta ne publie pas de champ d'abonnement dédié aux suppressions : il les
    // livre dans `messages`, avec `is_deleted: true`. On y est abonné depuis le
    // début, l'événement arrivait déjà.
    //
    // ⚠️ AUCUNE garde d'accord sur ce chemin, contrairement à l'écriture : une
    // suppression doit aboutir même si l'accord a été retiré entre-temps.
    // Refuser de supprimer faute d'accord serait le contraire du but.
    if (estSuppression(messaging)) {
      const { error } = await serviceSupabase.rpc('supprimer_message_ig', {
        p_profile_id: profileId, p_mid: mid,
      });
      if (error) debugLog('suppression IG non appliquée', { erreur: error.message });
      return;
    }

    const formes = { igAccountId, entryId };
    const sortant = estSortant(messaging, formes);

    // L'interlocuteur est à l'autre bout selon le sens. Le garde `estLeCompte`
    // couvre le cas où Meta rend les deux côtés sous une forme du compte
    // (observé quand deux comptes connectés se parlent) : on n'archive pas un
    // fil « avec soi-même ».
    const peerId = String((sortant ? messaging?.recipient?.id : messaging?.sender?.id) || '');
    if (!peerId || estLeCompte(peerId, formes)) return;

    const args = {
      p_profile_id: profileId,
      p_ig_account_id: igAccountId,
      p_peer_id: peerId,
      p_peer_username: null as string | null,
      p_mid: mid,
      p_sortant: sortant,
      p_texte: (messaging.message?.text as string) || null,
      p_type_piece_jointe: typePieceJointe(messaging.message),
      p_envoye_a: new Date(Number(messaging.timestamp) || Date.now()).toISOString(),
    };

    const { data, error } = await serviceSupabase.rpc('enregistrer_message_ig', args);
    if (error) {
      debugLog('enregistrer_message_ig a échoué', { erreur: error.message, peerId });
      return;
    }

    // ── Le vocal se capture MAINTENANT, ou jamais ────────────────────────────
    //
    // ⚠️ Meta ne ressert PAS un message vocal. Vérifié le 2026-09-04 par
    // introspection champ par champ : `attachments`, `shares` et `story`
    // reviennent tous vides, et `is_unsupported` vaut `true`. L'URL n'existe
    // qu'ici, dans la charge utile du webhook, et elle expire.
    //
    // C'est la SEULE exception à la règle « on ne stocke aucun média » : pour
    // tout le reste, on redemande à Meta au moment où quelqu'un regarde. Ici
    // c'est stocker ou perdre.
    //
    // Rétention 30 jours (décision de Chris, 2026-09-04), purgée par
    // `/api/instagram/purger-vocaux`. Dimensionnement : 88 Ko par vocal mesuré
    // sur le bucket `voice-messages` du projet ; le gigaoctet gratuit tient
    // jusqu'à ~9 vocaux par élève et par jour à 40 élèves, et
    // `stockage_fichiers_sante` alerte à 70 %.
    //
    // Volontairement non bloquant : un vocal manquant est un manque à l'écran,
    // une exception ici ferait échouer l'événement et donc le DM1 qui suit.
    if (args.p_type_piece_jointe === 'audio') {
      const urlAudio = messaging.message?.attachments?.[0]?.payload?.url;
      if (urlAudio) {
        try {
          const rep = await fetch(urlAudio);
          if (rep.ok) {
            const octets = await rep.arrayBuffer();
            const { error: envoiErr } = await serviceSupabase.storage
              .from('ig-vocaux')
              .upload(`${profileId}/${await empreinteMid(mid)}.m4a`, octets, {
                contentType: typeAudio(rep.headers.get('content-type')),
                upsert: true,
              });
            if (envoiErr) debugLog('vocal non stocké', { erreur: envoiErr.message });
          }
        } catch (e: any) {
          debugLog('vocal non téléchargé', { erreur: e?.message || String(e) });
        }
      }
    }

    const retour = Array.isArray(data) ? data[0] : data;
    // Aucune ligne = aucun accord. Cas normal et silencieux.
    if (!retour?.conversation_id || !retour.pseudo_a_resoudre || !accessToken) return;

    // Le pseudo n'est PAS dans la charge utile du webhook. On le résout UNE
    // seule fois par fil, puis on rappelle la même fonction : le message est
    // absorbé par le `on conflict`, seule la conversation reçoit le pseudo.
    // Un seul chemin de code, et aucun `update` séparé à maintenir.
    const r = await fetch(
      `https://graph.instagram.com/v22.0/${peerId}?fields=username&access_token=${accessToken}`
    );
    const j = await r.json();
    const username: string | undefined = j?.username;
    if (!username) return;
    await serviceSupabase.rpc('enregistrer_message_ig', { ...args, p_peer_username: username });
  } catch (e: any) {
    debugLog('archivage coach échoué', { erreur: e?.message || String(e) });
  }
}

/**
 * Délai entre le DM2 (lien) et le DM3 (question d'ouverture).
 *
 * Envoyer les deux dans la foulée fait mécanique : la personne vient de cliquer,
 * elle lit le lien, et une question qui tombe dans la même seconde se voit.
 *
 * 2 minutes plutôt que quelques secondes (ManyChat utilise ~3 s entre messages
 * d'un même flux) : ici le DM3 n'est pas la suite du DM2, c'est une relance qui
 * doit ressembler à un vrai message de suivi. Les délais de 4-11 min qu'on
 * trouve ailleurs visent la prospection à froid — hors sujet pour une séquence
 * déclenchée par une action de l'utilisateur, qui a déjà quitté la conversation
 * passé quelques minutes.
 *
 * Non ajustable par contenu (choix de Chris) : une seule valeur, tenue.
 */
const DM3_DELAY_MS = 2 * 60 * 1000;

/**
 * Valeurs par défaut du DM2 (le message qui porte le lien), utilisées quand les
 * champs correspondants de `content_links` sont vides.
 *
 * Ces chaînes sont dupliquées à l'identique dans PageLiens.tsx comme
 * placeholders : un champ laissé vide doit montrer exactement ce qui sera
 * envoyé, sinon le placeholder ment.
 */
const DM2_DEFAULT_MESSAGE = 'Voici ton lien 👇';
const DM2_DEFAULT_BUTTON = '📖 Accéder au lien';
// Repli du DM1, commun aux posts ET aux stories. Le chemin story lisait
// `seq.dm_lm_message || ''` : une accroche absente partait donc VIDE, alors que le
// chemin post retombait sur ce texte. Deux comportements pour la même panne.
const DM1_DEFAULT_MESSAGE = '👋 Clique sur le bouton pour recevoir le lien !';

async function attemptShortioCreate(apiKey: string, payload: object): Promise<Response> {
  const opts: RequestInit = {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  };
  const res = await fetch('https://api.short.io/links', opts);
  if (!res.ok && res.status !== 409) {
    await new Promise(r => setTimeout(r, 500));
    return fetch('https://api.short.io/links', opts);
  }
  return res;
}

/**
 * Crée le lien Short.io personnalisé d'un prospect (lead magnet).
 *
 * Appelée AU MOMENT DU CLIC sur le bouton du DM1, plus à la réception du
 * commentaire. Raison : le lien n'est envoyé qu'en DM2, donc uniquement aux
 * prospects qui ont cliqué — or seuls 30 à 50 % cliquent. Le créer à chaque
 * commentaire gaspillait la moitié à deux tiers du quota Short.io (plafond
 * d'automation : 1 000 liens/an en gratuit, 10 000/an en Pro — un seul post
 * viral consommait l'année entière), et ajoutait un appel réseau au chemin
 * critique du webhook, celui qui est contraint par les 30 s de Meta.
 *
 * Le tracking est inchangé : le lien reste unique par prospect, donc
 * l'attribution par chemin (`short_url like %/path`) fonctionne à l'identique.
 *
 * Retourne `fallbackUrl` si quoi que ce soit échoue — jamais d'exception : un
 * lien générique vaut mieux qu'un DM2 non envoyé.
 */
async function createProspectLmLink(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  profileId: string;
  lmUrl: string;
  lmKeyword: string;
  username: string;
  mediaId: string | null;
  fallbackUrl: string;
  /** 'lm' pour un commentaire, 'lm-story' pour une réponse à story. */
  pathPrefix?: 'lm' | 'lm-story';
  /** utm_medium : 'dm' depuis un commentaire, 'story' depuis une séquence story. */
  utmMedium?: 'dm' | 'story';
  /** Titre du lien dans Short.io — distingue les deux origines à la lecture. */
  titlePrefix?: string;
}): Promise<string> {
  const {
    supabase, profileId, lmUrl, lmKeyword, username, mediaId, fallbackUrl,
    pathPrefix = 'lm', utmMedium = 'dm', titlePrefix = 'LM',
  } = params;

  if (!lmUrl || !username) return fallbackUrl;

  const cleanUsername = sanitizeInstagramUsername(username);
  const cleanKeyword = lmKeyword.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const lmPath = `${pathPrefix}-${cleanKeyword}-${cleanUsername}`;

  try {
    const { data: shortioInteg } = await supabase
      .from('integrations')
      .select('api_key, metadata')
      .eq('profile_id', profileId)
      .eq('provider', 'shortio')
      .single();

    const apiKey = shortioInteg?.api_key;
    const domain = shortioInteg?.metadata?.domain;
    const domainId = shortioInteg?.metadata?.domain_id;
    if (!apiKey || !domain || !domainId) return fallbackUrl;

    // Nomenclature UTM : un rôle par champ, voir docs/utm-nomenclature.md.
    // utm_content porte l'identifiant du CONTENU d'origine, jamais le pseudo :
    // c'est ce que « Performance par contenu » compare à l'id du post pour
    // rattacher le call. Le prospect va dans utm_term, son champ dédié.
    const destUrl = new URL(lmUrl);
    destUrl.searchParams.set('utm_source', 'ig');
    destUrl.searchParams.set('utm_medium', utmMedium);
    destUrl.searchParams.set('utm_campaign', `${pathPrefix}-${cleanKeyword}`);
    if (mediaId) destUrl.searchParams.set('utm_content', mediaId);
    destUrl.searchParams.set('utm_term', cleanUsername);

    const res = await attemptShortioCreate(apiKey, {
      domain,
      originalURL: destUrl.toString(),
      title: `${titlePrefix} — ${username}`,
      path: lmPath,
    });

    if (res.status === 409) {
      // Lien déjà existant pour ce prospect (re-clic, ou lien créé par l'ancien
      // comportement) → récupérer l'URL existante plutôt qu'échouer.
      const existingRes = await fetch(
        `https://api.short.io/api/links?domain_id=${domainId}&limit=150`,
        { headers: { authorization: apiKey, accept: 'application/json' } }
      );
      const existingData = await existingRes.json().catch(() => ({}));
      const existing = (existingData?.links || []).find((l: { path?: string }) => l.path === lmPath);
      if (existing) return existing.secureShortURL || existing.shortURL || fallbackUrl;
      return fallbackUrl;
    }

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return data.secureShortURL || data.shortURL || fallbackUrl;
    }

    console.warn('[IG Webhook] Short.io lien LM échoué, fallback générique, status:', res.status);
    return fallbackUrl;
  } catch (err) {
    console.warn('[IG Webhook] Short.io lien LM exception, fallback générique:', err);
    return fallbackUrl;
  }
}

// Détecte un Cold DM générique (echo sans lien Calendly connu) : premier message
// manuel envoyé par Chris depuis l'app Instagram à quelqu'un qui vient de le suivre.
/**
 * Enregistre une relance quand on envoie un DM à un lead DÉJÀ CLASSÉ.
 *
 * ── POURQUOI SEULEMENT LES LEADS CLASSÉS ──────────────────────────────────────
 *
 * Un lead classé n'est pas en conversation : c'est le sens même du classement.
 * Tout message qu'on lui envoie est donc une reprise de contact. Un lead ACTIF,
 * lui, est déjà en train de discuter — compter chacun de ses messages comme une
 * relance ferait sortir du cycle quelqu'un avec qui on parle tous les jours.
 *
 * ── POURQUOI C'EST NÉCESSAIRE ─────────────────────────────────────────────────
 *
 * Le cycle de relance sort automatiquement un lead en Perdu « sans réponse »
 * après trois relances espacées. Si seul le bouton « Marquer relancés » comptait,
 * un lead relancé par un vrai DM en sortirait quand même — alors qu'on vient de
 * lui écrire. Le bouton reste comme filet : un webhook peut manquer un message.
 *
 * L'écriture passe par la RPC, qui incrémente `cycle` et ignore un second appel
 * dans l'heure — un webhook rejoué ne compte pas deux relances.
 */
async function enregistrerRelanceSiClasse(pid: string, recipientIgUserId: string): Promise<void> {
  const { data: lead } = await serviceSupabase
    .from('instagram_leads')
    .select('id, ig_username')
    .eq('profile_id', pid)
    .eq('ig_user_id', recipientIgUserId)
    .is('archived_at', null)
    .eq('not_a_lead', false)
    .order('detected_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lead?.ig_username) return;
  const prospectKey = lead.ig_username.toLowerCase();

  // Classé à la main ? La colonne `stage` porte l'issue depuis la refonte du
  // 2026-08-27. Seul « à recontacter » est dans un cycle de relance : un lead
  // perdu, pas qualifié ou closé n'en a aucun.
  const { data: override } = await serviceSupabase
    .from('pipeline_overrides')
    .select('stage')
    .eq('profile_id', pid)
    .eq('prospect_key', prospectKey)
    .eq('platform', 'ig')
    .maybeSingle();

  let enRelance = override?.stage === 'to_recontact';

  // Classé par un rapport de vente ? Le résultat vit alors sur le rendez-vous.
  if (!enRelance) {
    const { data: call } = await serviceSupabase
      .from('calls')
      .select('outcome')
      .eq('ig_lead_id', lead.id)
      .not('ignored', 'is', true)
      .in('call_type', CALL_TYPES_VENTE)
      .order('scheduled_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    enRelance = call?.outcome === 'to_recontact';
  }

  if (!enRelance) return;

  const { error } = await serviceSupabase.rpc('insert_prospect_event_relance', {
    p_profile_id:   pid,
    p_prospect_key: prospectKey,
    p_platform:     'ig',
    p_occurred_at:  new Date().toISOString(),
    p_ig_lead_id:   lead.id,
    p_metadata:     { source: 'webhook' },
  });
  if (error) {
    console.error(`[IG Webhook] relance NON écrite — @${prospectKey} — ${error.message}`);
  }
}

// Deux filtres avant de créer une fiche, dans l'ordre (rapide → lent) :
//  1) Table interne : si le destinataire est déjà connu (lead ou prospect_link),
//     ce n'est pas un premier contact mais une RELANCE — on ne crée rien, on ne
//     touche à rien (décision produit Chris : relance != Cold DM, jamais de 2e fiche).
//  2) Fallback API : si inconnu en interne, on vérifie via l'historique réel de la
//     conversation (endpoint conversations Meta) qu'il ne s'agit vraiment que d'un
//     seul message avant de créer la fiche — filtre anti-faux-positif (évite de
//     tracker un message à un ami/autre coach), couvre aussi le cas d'une
//     conversation ancienne antérieure au tracking, invisible en interne.
async function handleColdDmCandidate(params: {
  pid: string;
  recipientId: string;
  resolvedMatch: { access_token: string } | null;
  igAccountId: string;
  canonicalIgAccountId: string | null;
}): Promise<void> {
  const { pid, recipientId, resolvedMatch, igAccountId, canonicalIgAccountId } = params;
  if (!recipientId || !resolvedMatch) return;

  // Filtre 1 — déjà connu du pipeline (lead ou prospect_link) → relance, pas Cold DM.
  // Couvre aussi le cas d'un lead marqué not_a_lead (faux positif confirmé, ex: un
  // pote) : tant que la fiche existe (statut "Ce n'est pas un lead", ligne conservée),
  // aucune nouvelle fiche Cold DM n'est recréée pour ce ig_user_id. Un lead vraiment
  // supprimé (DELETE, ligne effacée) redevient en revanche détectable — comportement
  // attendu, la suppression n'a pas vocation à bloquer durablement contrairement à
  // not_a_lead.
  const [{ data: existingLead }, { data: existingProspect }] = await Promise.all([
    serviceSupabase.from('instagram_leads').select('id').eq('profile_id', pid).eq('ig_user_id', recipientId).maybeSingle(),
    serviceSupabase.from('prospect_links').select('id').eq('profile_id', pid).eq('ig_username', recipientId).maybeSingle(),
  ]);
  if (existingLead || existingProspect) return;

  const { access_token: token } = resolvedMatch;

  // Résout le username du destinataire (l'echo Meta ne le fournit pas directement)
  const profileRes = await fetch(
    `https://graph.instagram.com/v22.0/${recipientId}?fields=id,username&access_token=${token}`
  );
  const profileData = await profileRes.json().catch(() => ({}));
  const recipientUsername: string | null = profileData?.username || null;
  if (!recipientUsername) return;

  // Re-vérifie par username (le filtre 1 était par ig_user_id, un prospect_link créé
  // manuellement dans l'UI est indexé par ig_username — double sécurité anti-doublon)
  const { data: existingProspectByUsername } = await serviceSupabase
    .from('prospect_links')
    .select('id')
    .eq('profile_id', pid)
    .ilike('ig_username', recipientUsername)
    .maybeSingle();
  if (existingProspectByUsername) return;

  // Filtre 2 — fallback API : confirme qu'il s'agit bien du premier (et seul) message
  // de la conversation avant de créer la fiche.
  try {
    const convRes = await fetch(
      `https://graph.instagram.com/v22.0/${canonicalIgAccountId ?? igAccountId}/conversations?user_id=${recipientId}&fields=id,message_count&access_token=${token}`
    );
    const convData = await convRes.json();
    const conv = convData?.data?.[0];
    if (!conv || (conv.message_count ?? 0) > 1) return;
  } catch {
    return;
  }

  const now = new Date().toISOString();
  const { data: newLead } = await serviceSupabase
    .from('instagram_leads')
    .insert({
      profile_id:       pid,
      ig_username:      recipientUsername,
      ig_user_id:       recipientId,
      source:           'cold_dm',
      keyword_matched:  'cold_dm',
      lead_magnet_sent: false,
      hook_replied:     false,
      detected_at:      now,
      ig_account_id:    canonicalIgAccountId ?? igAccountId,
    })
    .select('id')
    .maybeSingle();

  if (newLead?.id) {
    // RPC obligatoire — aucun index ne couvrait (ig_lead_id, event_type) pour
    // 'cold_dm_sent', donc ce .upsert() échouait à chaque appel sans que rien ne
    // le dise : zéro événement cold_dm_sent en base au 2026-08-27. Les index de
    // lm_sent / hook_replied / lm_clicked fonctionnent, eux, parce que leur
    // prédicat porte sur event_type et que Postgres sait alors l'inférer.
    // L'index manquant est créé par la migration 20260827000000.
    const { error: coldErr } = await serviceSupabase.rpc('upsert_prospect_event_by_lead', {
      p_profile_id:   pid,
      p_prospect_key: recipientUsername.toLowerCase(),
      p_platform:     'ig',
      p_event_type:   'cold_dm_sent',
      p_occurred_at:  now,
      p_ig_lead_id:   newLead.id,
    });
    if (coldErr) {
      console.error(`[IG Webhook] cold_dm_sent NON écrit — lead: ${newLead.id} — ${coldErr.message}`);
    }

    console.log(`[IG Webhook] cold_dm créé — @${recipientUsername}, lead: ${newLead.id}`);
    pushEvent({ type: 'cold_dm_created', ig_username: recipientUsername, lead_id: newLead.id });
  }
}


/**
 * Traite UN entry Meta (une ligne de `webhook_queue`).
 *
 * Relance ses erreurs plutôt que de les avaler : le worker doit pouvoir marquer
 * l'événement en échec et le réessayer. Les avaler ferait passer un échec pour un
 * succès, et le commentaire serait perdu définitivement — Meta n'autorise qu'un
 * private reply par commentaire.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function processWebhookEntry(queuedEntry: any): Promise<void> {
    const entries = [queuedEntry];
  try {

  // Charge tous les comptes IG une seule fois pour tous les entries
  const { data: allIg } = await serviceSupabase
    .from('integrations')
    .select('profile_id, access_token, metadata')
    .eq('provider', 'instagram');

  for (const entry of entries) {
    const igAccountId = String(entry.id);
    debugLog('entry.id reçu', { igAccountId, comptesConnus: (allIg || []).map((r: any) => r.metadata?.ig_account_id) });
    // Trouve le profil par ig_account_id d'abord
    let resolvedMatch: any = (allIg || []).find((r: any) =>
      String(r.metadata?.ig_account_id) === igAccountId
    ) || null;

    // Si pas de match direct : Meta envoie systématiquement dans entry.id un ID
    // ALTERNATIF (probablement lié à la Page Facebook connectée), jamais l'ig_account_id
    // stocké (résolu via /me au callback OAuth) — confirmé empiriquement le 2026-07-30,
    // toujours vrai, jamais un cas rare. GET graph.instagram.com/{entry.id}?fields=id
    // renvoie le vrai ig_account_id, MAIS seulement avec un token du MÊME compte —
    // n'importe quel autre token échoue avec "missing permissions" (testé : le token de
    // rdj échoue sur l'entry.id d'un autre compte, exactement comme un token tiers). Pas
    // de raccourci "un seul appel suffit" : il faut tester les tokens jusqu'à trouver
    // celui qui répond avec succès. Pour ne pas rescanner tous les tokens à CHAQUE
    // commentaire (coûteux à 20+ élèves), le mapping entry.id→ig_account_id trouvé une
    // fois est mis en cache (stable, ne change jamais) dans ig_entry_id_mapping.
    // Sentinelle de cache NÉGATIF : « ce scan a déjà échoué récemment ». Sans
    // elle (audit du 2026-09-02), un compte non résolu — ex-élève déconnecté de
    // la plateforme mais toujours abonné au webhook côté Meta — relançait le
    // scan de TOUS les tokens à CHAQUE événement : à 40 élèves, un contenu viral
    // de cet ex-compte = 40 × N appels Graph inutiles, en boucle. Revalidé
    // après 24 h : un compte qui se (re)connecte est retrouvé au plus tard le
    // lendemain, et son premier commentaire chez nous force de toute façon un
    // nouveau scan seulement s'il n'est plus dans la fenêtre négative.
    const CACHE_NEGATIF = 'introuvable';
    let scanBloqueParCacheNegatif = false;
    if (!resolvedMatch) {
      const { data: cached } = await serviceSupabase
        .from('ig_entry_id_mapping')
        .select('ig_account_id, created_at')
        .eq('entry_id', igAccountId)
        .maybeSingle();
      if (cached?.ig_account_id === CACHE_NEGATIF) {
        const age = Date.now() - new Date(cached.created_at).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          scanBloqueParCacheNegatif = true;
          debugLog('entry.id en cache négatif — scan sauté', { igAccountId, age_h: Math.round(age / 3600_000) });
        }
      } else if (cached?.ig_account_id) {
        resolvedMatch = (allIg || []).find((r: any) =>
          String(r.metadata?.ig_account_id) === cached.ig_account_id
        ) || null;
        debugLog('résolution entry.id via cache', { igAccountId, ig_account_id: cached.ig_account_id, matched: !!resolvedMatch });
      }
    }
    if (!resolvedMatch && !scanBloqueParCacheNegatif) {
      const results = await Promise.allSettled((allIg || []).map(async (r: any) => {
        const resolveRes = await fetch(
          `https://graph.instagram.com/v21.0/${igAccountId}?fields=id&access_token=${r.access_token}`
        );
        const resolveData = await resolveRes.json();
        if (resolveData?.id && !resolveData.error) return r;
        throw new Error('no match');
      }));
      const found = results.find((res): res is PromiseFulfilledResult<any> => res.status === 'fulfilled');
      if (found) {
        resolvedMatch = found.value;
        debugLog('résolution entry.id via scan parallèle', { igAccountId, profile_id: resolvedMatch.profile_id });
        serviceSupabase.from('ig_entry_id_mapping')
          .upsert({ entry_id: igAccountId, ig_account_id: resolvedMatch.metadata?.ig_account_id }, { onConflict: 'entry_id' })
          .then();
      } else {
        // Échec mémorisé — created_at rafraîchi pour dater la fenêtre de 24 h.
        // L'erreur de CET upsert est lue : un cache négatif qui ne s'écrit pas en
        // silence referait le scan à chaque événement, exactement le défaut fermé.
        const { error: negErr } = await serviceSupabase.from('ig_entry_id_mapping')
          .upsert({ entry_id: igAccountId, ig_account_id: CACHE_NEGATIF, created_at: new Date().toISOString() }, { onConflict: 'entry_id' });
        if (negErr) debugLog('cache négatif NON écrit', { igAccountId, erreur: negErr.message });
      }
    }
    debugLog('resolvedMatch après résolution', {
      profile_id: resolvedMatch?.profile_id ?? null,
      changesLength: (entry.changes || []).length,
      messagingLength: (entry.messaging || []).length,
    });

    // Valeur canonique du compte propriétaire — TOUJOURS celle stockée dans
    // integrations.metadata (résolue une fois via /me au callback OAuth), jamais la
    // valeur brute igAccountId (=entry.id) envoyée par Meta dans ce webhook : dès que
    // le match direct échouait (entry.id ≠ valeur stockée, cas non rare vu le fallback
    // ci-dessus), toutes les écritures posaient le mauvais ig_account_id — cassant
    // l'isolation par compte pour n'importe quel lead créé via ce chemin.
    const canonicalIgAccountId: string | null = resolvedMatch?.metadata?.ig_account_id
      ? String(resolvedMatch.metadata.ig_account_id)
      : igAccountId;

    // ── Events messaging (DMs entrants) — détection réponse au message d'accroche ──
    for (const messaging of entry.messaging || []) {
      const senderId = String(messaging.sender?.id || '');
      const recipientId = String(messaging.recipient?.id || '');
      const msgText: string = messaging.message?.text || '';
      const isEcho = !!messaging.message?.is_echo; // true = DM envoyé par nous, false = DM reçu

      if (!resolvedMatch) continue;
      const { profile_id: pid } = resolvedMatch;

      // ── Archivage du fil pour le coach ────────────────────────────────────
      // Une seule requête, avant tout le reste, et sans jamais bloquer la
      // séquence de DM qui suit : `enregistrerPourLeCoach` avale ses erreurs.
      // Un fil non archivé est un manque à l'écran ; un DM1 non envoyé est un
      // lead perdu que Meta n'autorise pas à rattraper.
      await enregistrerPourLeCoach(messaging, pid, canonicalIgAccountId ?? igAccountId,
                                   igAccountId, resolvedMatch.access_token);

      // Un DM sortant vers un lead DÉJÀ CLASSÉ est une relance. Écrit avant tout
      // le reste, parce que c'est vrai que le message contienne un lien Calendly
      // ou non : un lead classé n'est pas en conversation, donc tout message
      // qu'on lui envoie est une reprise de contact.
      //
      // Sans ça, seul le bouton « Marquer relancés » alimentait le compteur, et
      // un lead relancé par un vrai DM sortait quand même du cycle en Perdu
      // « sans réponse » — alors qu'on venait de lui écrire.
      if (isEcho && recipientId) {
        await enregistrerRelanceSiClasse(pid, recipientId);
      }

      // Message envoyé par nous (echo) — détecter si on a envoyé un lien Calendly prospect
      if (isEcho && msgText) {
        // recipientId = ig_user_id du destinataire (fourni par Meta dans l'echo)
        // On trouve le prospect_link par URL, puis on vérifie que le destinataire correspond.
        // Si c'est un cold DM (ig_lead_id null) → on crée la fiche lead à ce moment-là.

        const { data: allLinks } = await serviceSupabase
          .from('prospect_links')
          .select('id, short_url, ig_username, ig_lead_id, calendly_link_sent, calendly_link_sent_at, first_click_at')
          .eq('profile_id', pid);

        const matchedLink = (allLinks || []).find(pl => pl.short_url && msgText.includes(pl.short_url));
        if (!matchedLink) {
          // Pas de lien Calendly dans l'echo → candidat Cold DM générique : premier
          // message manuel envoyé par Chris depuis l'app Instagram à quelqu'un qui
          // vient de le suivre, sans commentaire ni lead magnet.
          await handleColdDmCandidate({ pid, recipientId, resolvedMatch, igAccountId, canonicalIgAccountId });
          continue;
        }

        const now = new Date().toISOString();
        let igLeadId: string | null = matchedLink.ig_lead_id ?? null;

        // Sécurité anti-mauvais-destinataire : si le lien est lié à un lead avec un ig_user_id
        // différent du recipientId réel → le coach a envoyé le lien de A à B → on ignore
        if (recipientId && igLeadId) {
          const { data: linkedLead } = await serviceSupabase
            .from('instagram_leads')
            .select('ig_user_id')
            .eq('id', igLeadId)
            .maybeSingle();
          if (linkedLead?.ig_user_id && linkedLead.ig_user_id !== recipientId) {
            console.warn(`[IG Webhook] echo ignoré — lien de ${matchedLink.ig_username} envoyé au mauvais destinataire (${recipientId})`);
            continue;
          }
        }

        // Cold DM : pas de lead existant → on crée la fiche maintenant
        // L'ig_username vient du prospect_link créé manuellement dans l'UI
        if (!igLeadId && matchedLink.ig_username) {
          const { data: newLead } = await serviceSupabase
            .from('instagram_leads')
            .insert({
              profile_id:       pid,
              ig_username:      matchedLink.ig_username,
              ig_user_id:       recipientId || null,
              source:           'cold_dm',
              keyword_matched:  'cold_dm',
              lead_magnet_sent: false,
              hook_replied:     false,
              ig_account_id:    canonicalIgAccountId ?? igAccountId,
            })
            .select('id')
            .single();
          if (newLead) {
            igLeadId = newLead.id;
            await serviceSupabase.from('prospect_links').update({ ig_lead_id: igLeadId }).eq('id', matchedLink.id);
          }
        }

        // Marque le lien comme envoyé.
        // Ne pas écraser calendly_link_sent_at si first_click_at est déjà renseigné :
        // calendly_link_sent_at = timestamp du PREMIER envoi (figé, sert de guard pour linkClickedValid)
        // last_calendly_link_sent_at = timestamp du DERNIER envoi (mis à jour à chaque renvoi,
        //   sert de naturalSignalAt pour calendly_sent dans resolveStage)
        const linkUpdateData: Record<string, any> = {
          calendly_link_sent: true,
          last_calendly_link_sent_at: now,
        };
        if (!matchedLink.calendly_link_sent_at) {
          linkUpdateData.calendly_link_sent_at = now;
        }
        await serviceSupabase
          .from('prospect_links')
          .update(linkUpdateData)
          .eq('id', matchedLink.id);

        // Pas d'override pipeline_overrides — calendly_sent est un signal auto
        // calculé depuis prospect_links.calendly_link_sent dans le pipeline.
        // Un override manuel bloquerait les signaux suivants (ex: link_clicked).

        // Événement prospect_events — RPC obligatoire, jamais .upsert().
        // L'index visé (prospect_events_link_event_type_uidx) est PARTIEL, et le
        // client Supabase JS ne sait cibler un ON CONFLICT que sur un index total.
        // Le .upsert() qui était ici échouait à chaque appel depuis toujours, sans
        // que rien ne le signale : Supabase JS ne lève pas, il retourne { error },
        // et le résultat n'était pas lu. D'où l'absence totale d'événements
        // calendly_link_sent en base. Voir migration 20260827000000.
        const { error: calSentErr } = await serviceSupabase.rpc('upsert_prospect_event_by_link', {
          p_profile_id:       pid,
          p_prospect_key:     matchedLink.ig_username,
          p_platform:         'ig',
          p_event_type:       'calendly_link_sent',
          p_occurred_at:      now,
          p_prospect_link_id: matchedLink.id,
          p_ig_lead_id:       igLeadId,
        });
        if (calSentErr) {
          console.error(`[IG Webhook] calendly_link_sent NON écrit — prospect_link: ${matchedLink.id} — ${calSentErr.message}`);
        } else {
          console.log(`[IG Webhook] calendly_link_sent — prospect_link: ${matchedLink.id}, url: ${matchedLink.short_url}`);
        }
        pushEvent({ type: 'calendly_link_sent', prospect_link_id: matchedLink.id, short_url: matchedLink.short_url });
        continue;
      }

      // Clic sur le bouton LM_LINK_CLICKED → envoyer DM2 (lien) puis DM3 (ouverture)
      // Test generic template (postback) vs quick_reply — Meta peut renvoyer l'un ou l'autre selon le format envoyé
      const quickReplyPayload = messaging.message?.quick_reply?.payload || messaging.postback?.payload;
      if (quickReplyPayload === 'LM_LINK_CLICKED' && senderId) {
        const { data: leadForDm2 } = await serviceSupabase
          .from('instagram_leads')
          .select('id, ig_username, pending_dm2, pending_dm3, keyword_matched, pending_lm_content_id, pending_lm_media_id, story_sequence_id')
          .eq('profile_id', pid)
          .eq('ig_user_id', senderId)
          .eq('lead_magnet_sent', true)
          .order('detected_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (leadForDm2 && resolvedMatch) {
          // ── Verrou anti-double-DM2 (audit du 2026-09-02) ──────────────────────
          // La file n'a pas de clé d'idempotence à l'enqueue : une redelivery Meta
          // du postback = deux lignes, traitées par deux workers PARALLÈLES (les
          // réveils rendent ce cas courant). `pending_dm2` n'est consommé qu'en
          // fin de bloc, et le chemin content_links fabrique un lien même sans
          // lui : rien n'empêchait le prospect de recevoir DEUX FOIS le message
          // au lien. Même mécanisme atomique que le verrou commentaires — même
          // table, même contrainte UNIQUE, media_id sentinelle.
          {
            const lockCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
            await serviceSupabase
              .from('ig_comment_processing_lock')
              .delete()
              .eq('profile_id', pid)
              .eq('ig_user_id', senderId)
              .eq('media_id', 'postback:LM_LINK_CLICKED')
              .lt('locked_at', lockCutoff);
            const { error: lockError } = await serviceSupabase
              .from('ig_comment_processing_lock')
              .insert({ profile_id: pid, ig_user_id: senderId, media_id: 'postback:LM_LINK_CLICKED' });
            if (lockError) {
              pushEvent({ type: 'concurrent_postback_skip', senderId });
              continue;
            }
          }
          // Le lead a RÉCLAMÉ son lead magnet. C'est ici, et pas à l'envoi du DM1,
          // que le contenu part réellement : `lead_magnet_sent` est posé dès le
          // DM1 alors que seuls 30 à 50 % cliquent ce bouton (voir plus bas).
          // Sans cet événement, « lead magnet reçu » et « lead magnet réclamé »
          // sont indiscernables, et l'écart entre les deux — la vraie mesure de
          // la qualité du DM1 — n'existe nulle part.
          //
          // RPC obligatoire : tous les index uniques de prospect_events sont
          // partiels, un .upsert() échouerait en silence. Voir migration
          // 20260827000000.
          //
          // L'historique passé reste inconnu : on n'invente pas rétroactivement
          // qui a cliqué. L'étape « Lead magnet reçu » démarre donc à 0.
          const { error: lmReqErr } = await serviceSupabase.rpc('upsert_prospect_event_by_lead', {
            p_profile_id:   pid,
            p_prospect_key: leadForDm2.ig_username,
            p_platform:     'ig',
            p_event_type:   'lm_link_requested',
            p_occurred_at:  new Date().toISOString(),
            p_ig_lead_id:   leadForDm2.id,
            p_metadata:     {
              keyword:    leadForDm2.keyword_matched ?? null,
              content_id: leadForDm2.pending_lm_content_id ?? null,
              media_id:   leadForDm2.pending_lm_media_id ?? null,
            },
          });
          if (lmReqErr) {
            console.error(`[IG Webhook] lm_link_requested NON écrit — lead: ${leadForDm2.id} — ${lmReqErr.message}`);
          }

          const { access_token: at } = resolvedMatch;
          const sendDm = (text: string) => fetch(
            `https://graph.instagram.com/v21.0/${canonicalIgAccountId ?? igAccountId}/messages`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recipient: { id: senderId },
                messaging_type: 'RESPONSE',
                message: { text },
                access_token: at,
              }),
            }
          ).then(r => r.json());

          // DM2 sous forme de TEMPLATE avec bouton web_url : le prospect voit un
          // libellé (« 📖 Accéder au guide »), jamais l'URL. Possible ici et pas en
          // DM1 parce que le clic sur le postback du DM1 a déjà ouvert la fenêtre
          // de 24 h — Meta documente que les clics hors plateforme (web_url) ne
          // l'ouvrent PAS, d'où le postback obligatoire en DM1.
          const sendDmWithButton = (url: string, text: string, label: string) => fetch(
            `https://graph.instagram.com/v21.0/${canonicalIgAccountId ?? igAccountId}/messages`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recipient: { id: senderId },
                messaging_type: 'RESPONSE',
                message: {
                  attachment: {
                    type: 'template',
                    payload: {
                      template_type: 'generic',
                      elements: [{
                        title: text.slice(0, 80),
                        buttons: [{ type: 'web_url', url, title: label.slice(0, 20) }],
                      }],
                    },
                  },
                },
                access_token: at,
              }),
            }
          ).then(r => r.json());

          // Création du lien Short.io personnalisé — MAINTENANT, pas au commentaire.
          // Seuls les prospects qui cliquent en consomment un (voir
          // createProspectLmLink pour le détail du quota).
          let lmLink: string | null = leadForDm2.pending_dm2 || null;
          // Textes du DM2 — configurables par contenu (PageLiens). Ces valeurs par
          // défaut sont les mêmes que les placeholders affichés dans l'interface,
          // pour qu'un champ laissé vide envoie exactement ce qui y est montré.
          let lmButtonLabel = DM2_DEFAULT_BUTTON;
          let lmMessageText = DM2_DEFAULT_MESSAGE;
          // Prospect venu d'une story : sa configuration vit sur
          // `story_sequences`, pas sur `content_links`. `story_sequence_id`, posé
          // à la réponse à la story, est ce qui permet de le reconnaître ici.
          if (leadForDm2.story_sequence_id && leadForDm2.ig_username) {
            const { data: seqForLink } = await serviceSupabase
              .from('story_sequences')
              .select('id, lm_url, lm_keyword, dm1_message, dm_link_button_text')
              .eq('id', leadForDm2.story_sequence_id)
              .maybeSingle();

            if (seqForLink?.dm_link_button_text) lmButtonLabel = seqForLink.dm_link_button_text.slice(0, 20);
            if (seqForLink?.dm1_message) {
              // {{lien_lm}} est retiré du texte : dans le gabarit à bouton, c'est
              // le bouton qui porte l'URL. La laisser en clair afficherait le lien
              // deux fois, et le message perdrait ce qui le rend propre.
              lmMessageText = seqForLink.dm1_message
                .replace(/\{\{lien_lm\}\}/gi, '')
                .replace(/{{username}}/gi, `@${leadForDm2.ig_username}`)
                .replace(/\s{2,}/g, ' ')
                .replace(/[:\-–—]\s*$/, '')
                .trim() || DM2_DEFAULT_MESSAGE;
            }
            if (seqForLink?.lm_url) {
              lmLink = await createProspectLmLink({
                supabase: serviceSupabase,
                profileId: pid,
                lmUrl: seqForLink.lm_url,
                lmKeyword: seqForLink.lm_keyword,
                username: leadForDm2.ig_username,
                // utm_content = la séquence, jamais un post : c'est ce que
                // Performance par contenu attend pour rattacher le call.
                mediaId: seqForLink.id ? String(seqForLink.id) : null,
                fallbackUrl: seqForLink.lm_url,
                pathPrefix: 'lm-story',
                utmMedium: 'story',
                titlePrefix: 'LM Story',
              });
            }
          } else if (leadForDm2.pending_lm_content_id && leadForDm2.keyword_matched && leadForDm2.ig_username) {
            const { data: clForLink } = await serviceSupabase
              .from('content_links')
              .select('lm_url, lm_short_url, lm_keyword, dm_link_message, dm_link_button_text')
              .eq('profile_id', pid)
              .eq('content_id', leadForDm2.pending_lm_content_id)
              .eq('lm_keyword', leadForDm2.keyword_matched)
              .maybeSingle();

            // Champs propres au DM2 — plus dm_button_text, qui est celui du DM1 :
            // les deux boutons n'ont pas le même rôle (demander le lien / l'ouvrir).
            if (clForLink?.dm_link_button_text) lmButtonLabel = clForLink.dm_link_button_text;
            if (clForLink?.dm_link_message) lmMessageText = clForLink.dm_link_message;

            if (clForLink?.lm_url) {
              lmLink = await createProspectLmLink({
                supabase: serviceSupabase,
                profileId: pid,
                lmUrl: clForLink.lm_url,
                lmKeyword: clForLink.lm_keyword,
                username: leadForDm2.ig_username,
                mediaId: leadForDm2.pending_lm_media_id ?? null,
                // Repli : le lien générique du contenu, puis ce qui avait été stocké.
                fallbackUrl: clForLink.lm_short_url || leadForDm2.pending_dm2 || '',
              });
              // Le lien effectivement envoyé devient la valeur de référence du lead.
              if (lmLink) {
                await serviceSupabase.from('instagram_leads')
                  .update({ tracking_link: lmLink })
                  .eq('id', leadForDm2.id);
              }
            }
          }

          if (lmLink) {
            const dm2Data = await sendDmWithButton(
              lmLink,
              lmMessageText.replace(/{{username}}/gi, `@${leadForDm2.ig_username || 'toi'}`),
              lmButtonLabel
            );
            if (dm2Data.error) {
              pushEvent({ type: 'dm2_error', error: dm2Data.error });
              // Le plus couteux des trois : la personne vient de cliquer, elle
              // attend son lien. Un echec ici est invisible cote coach.
              tracerEchecEnvoi('dm2_lien', pid, dm2Data.error, {
                ig_username: leadForDm2.ig_username,
                ig_lead_id: leadForDm2.id,
              });
              // Transitoire → on lève AVANT la consommation de pending_dm2 en fin
              // de bloc : la file retente avec backoff, le verrou postback (2 min)
              // absorbe le retry trop rapproché, et le prospect finit par recevoir
              // son lien au lieu d'attendre devant un DM qui ne viendra jamais.
              if (estErreurMetaTransitoire(dm2Data.error)) {
                throw new Error(`meta_transitoire dm2 (${dm2Data.error.code}): ${dm2Data.error.message || ''}`);
              }
            } else {
              console.log(`[IG Webhook] DM2 (lien) envoyé après clic QR — message_id: ${dm2Data.message_id}`);
              pushEvent({ type: 'dm2_sent', message_id: dm2Data.message_id });
            }
          }

          // DM3 (question d'ouverture) : PLANIFIÉ à +2 min, pas envoyé ici.
          //
          // Envoyer les deux messages dans la foulée fait mécanique — la personne
          // vient de cliquer, elle lit le lien, et une question qui tombe dans la
          // même seconde se voit. 2 minutes la font arriver comme un vrai message
          // de suivi.
          //
          // Le délai NE PEUT PAS être une attente dans ce handler : Meta exige une
          // réponse en moins de 30 s, et désabonne le webhook après 1 h d'échecs.
          // D'où l'horodatage + le cron send-pending-dm3 qui dépile.
          const dm3At = leadForDm2.pending_dm3
            ? new Date(Date.now() + DM3_DELAY_MS).toISOString()
            : null;
          if (dm3At) {
            pushEvent({ type: 'dm3_scheduled', at: dm3At });
          }

          // pending_dm2 consommé ; pending_dm3 conservé jusqu'à son envoi par le cron.
          await serviceSupabase.from('instagram_leads')
            .update({ pending_dm2: null, dm3_scheduled_at: dm3At })
            .eq('id', leadForDm2.id);
        }
        continue;
      }

      // ── Reply à une story (séquences stories — feature ig_stories/story_sequences) ──
      // Contrairement au flux commentaire de posts (où NOUS envoyons le DM1 en premier via
      // private reply), c'est ICI le prospect qui écrit en premier en répondant à la story
      // CTA — la fenêtre 24h Meta est donc déjà ouverte nativement, pas besoin de Quick
      // Reply pour la forcer. On envoie DM1 (lien LM perso) puis DM2 (libre) enchaînés sans
      // attendre de clic. Point critique : ce premier message ne doit PAS marquer
      // hook_replied=true (sinon la card bascule prématurément en "En conversation" dans le
      // pipeline) — awaiting_story_followup=true bloque ça, et seul le message SUIVANT du
      // prospect (capté par le bloc générique hook_replied plus bas) fera basculer la card.
      const storyReplyId: string | undefined = messaging.message?.reply_to?.story?.id;
      if (storyReplyId && senderId && msgText && !isEcho) {
        const { data: story } = await serviceSupabase
          .from('ig_stories')
          .select('id, sequence_id')
          .eq('ig_story_id', storyReplyId)
          .eq('profile_id', pid)
          .maybeSingle();

        if (story?.sequence_id) {
          const { data: seq } = await serviceSupabase
            .from('story_sequences')
            .select('*')
            .eq('id', story.sequence_id)
            .maybeSingle();

          if (seq?.lm_keyword && normalizeForKeywordMatch(msgText).includes(normalizeForKeywordMatch(seq.lm_keyword))) {
            // Cooldown 1 min — même garde anti-doublon que le flux commentaires
            const cooldownCutoff = new Date(Date.now() - 60 * 1000).toISOString();
            const { data: recentDm } = await serviceSupabase
              .from('instagram_lead_lm_history')
              .select('id')
              .eq('ig_user_id', senderId)
              .eq('keyword_matched', seq.lm_keyword)
              .eq('profile_id', pid)
              .gte('detected_at', cooldownCutoff)
              .limit(1)
              .maybeSingle();

            if (recentDm) {
              pushEvent({ type: 'cooldown_skip', ig_user_id: senderId, keyword: seq.lm_keyword });
              continue;
            }

            // Récupère le username du prospect (pas fourni dans le payload messaging)
            let senderUsername = '';
            if (resolvedMatch?.access_token) {
              try {
                const profRes = await fetch(`https://graph.instagram.com/v22.0/${senderId}?fields=username&access_token=${resolvedMatch.access_token}`);
                const profData = await profRes.json();
                senderUsername = profData?.username || '';
              } catch { /* non bloquant — username restera vide si l'appel échoue */ }
            }

            // Lien Short.io perso (lead × séquence × keyword) — via la fonction
            // partagée avec le flux commentaires.
            //
            // Contrairement aux commentaires, la création n'est PAS reportée ici :
            // le prospect a déjà écrit (c'est lui qui répond à la story), donc il
            // est engagé et le lien part immédiatement dans le DM1. Il n'y a pas
            // d'étape de clic intermédiaire où la différer.
            // ── Parcours unifie (2026-08-27) ────────────────────────────
            //
            // On n'envoie plus le lien d'emblee. Le prospect recoit l'accroche
            // et son bouton ; le lien part au clic, dans le bloc
            // LM_LINK_CLICKED, exactement comme pour un commentaire de post.
            //
            // Le lien Short.io personnalise n'est donc plus cree ici : seuls
            // ceux qui cliquent en consomment un (voir createProspectLmLink
            // pour le detail du quota).
            const shortLink: string | null = null;

            const accrocheText = (seq.dm_lm_message || DM1_DEFAULT_MESSAGE)
              .replace(/{{username}}/gi, `@${senderUsername || 'toi'}`)
              .replace(/\s{2,}/g, ' ')
              .trim();
            const accrocheBtn = (seq.dm_button_text || DM2_DEFAULT_BUTTON).slice(0, 20);

            // Gabarit generique a bouton postback, comme le DM1 des posts : c'est
            // le clic sur un postback qui ouvre la fenetre de 24 h cote Meta. Un
            // bouton web_url ne l'ouvrirait pas, et le message du lien ne pourrait
            // plus partir.
            const sendAccroche = (text: string, btn: string) => fetch(
              `https://graph.instagram.com/v21.0/${canonicalIgAccountId ?? igAccountId}/messages`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  recipient: { id: senderId },
                  messaging_type: 'RESPONSE',
                  message: {
                    attachment: {
                      type: 'template',
                      payload: {
                        template_type: 'generic',
                        elements: [{
                          title: text.slice(0, 80),
                          buttons: [{ type: 'postback', title: btn, payload: 'LM_LINK_CLICKED' }],
                        }],
                      },
                    },
                  },
                  access_token: resolvedMatch?.access_token,
                }),
              }
            ).then(r => r.json());

            let leadMagnetSent = false;
            if (accrocheText) {
              const dm1Data = await sendAccroche(accrocheText, accrocheBtn);
              if (dm1Data.error) {
                pushEvent({ type: 'dm1_error', error: dm1Data.error, ig_user_id: senderId });
                tracerEchecEnvoi('dm1_accroche_story', pid, dm1Data.error, { ig_user_id: senderId });
              } else {
                leadMagnetSent = true;
                pushEvent({ type: 'dm1_sent', message_id: dm1Data.message_id, ig_user_id: senderId });
              }
            }

            const nowIso = new Date().toISOString();
            // `source` et `hook_replied` sont relus pour la MEME raison que
            // `detected_at` : cet upsert reecrit la ligne entiere, donc tout champ
            // qu'on ne reporte pas explicitement est ecrase sur un lead qui existe
            // deja.
            const { data: existingLead } = await serviceSupabase
              .from('instagram_leads')
              .select('id, detected_at, source, hook_replied')
              .eq('profile_id', pid)
              .eq('ig_user_id', senderId)
              .maybeSingle();

            const { data: upsertedLead } = await serviceSupabase
              .from('instagram_leads')
              .upsert({
                profile_id: pid,
                // ── L'ORIGINE D'UNE PERSONNE NE CHANGE PAS ──────────────────
                // Repondre a une story n'est pas une nouvelle provenance, c'est
                // un evenement de plus dans un parcours. Ecraser `source`
                // effacait d'ou la personne venait vraiment — un lead Cold DM
                // devenait « story_reply ».
                //
                // Ce champ ne sert a RIEN dans ce webhook (verifie : il n'y est
                // jamais lu), mais six ecrans le lisent, dont toute
                // l'attribution des paiements : « cash par origine », la chaine
                // d'attribution d'une vente, le sous-titre d'une personne dans
                // Paiements. Le pipeline s'en sert aussi pour ranger une carte
                // en « Cold DM ».
                source: existingLead?.source ?? 'story_reply',
                ig_username: senderUsername || null,
                ig_user_id: senderId,
                message: msgText.slice(0, 500),
                media_id: storyReplyId,
                keyword_matched: seq.lm_keyword,
                detected_at: existingLead?.detected_at ?? nowIso,
                lead_magnet_sent: leadMagnetSent,
                tracking_link: shortLink || null,
                // La relance est mise de côté ici et programmée au clic, comme
                // pour un post : la planifier dès maintenant l'enverrait à
                // quelqu'un qui n'a jamais demandé le lien.
                pending_dm3: seq.dm2_story_message || null,
                story_sequence_id: story.sequence_id,
                story_id: story.id,
                awaiting_story_followup: true,
                // ── NE PAS POSER `true` N'EST PAS EFFACER UN `true` ──────────
                // L'intention, expliquee plus haut : ce premier message ne doit
                // PAS marquer `hook_replied`, sinon la carte bascule
                // prematurement en « En conversation ». C'est juste pour un lead
                // NEUF.
                //
                // Sur un lead qui existe deja et avait REELLEMENT converse, le
                // remettre a `false` faisait reculer sa carte — une conversation
                // deja eue disparaissait parce qu'il avait repondu a une story.
                hook_replied: existingLead?.hook_replied ?? false,
                ig_account_id: canonicalIgAccountId,
              }, { onConflict: 'profile_id,ig_user_id', ignoreDuplicates: false })
              .select('id')
              .maybeSingle();

            if (upsertedLead?.id && senderUsername) {
              serviceSupabase.from('prospect_events').insert({
                profile_id: pid,
                prospect_key: senderUsername.toLowerCase(),
                platform: 'ig',
                event_type: 'lm_sent',
                occurred_at: nowIso,
                ig_lead_id: upsertedLead.id,
              }).then(({ error: evtErr }) => {
                if (evtErr && !evtErr.message.includes('duplicate')) {
                  console.error('[IG Webhook] prospect_events lm_sent (story):', evtErr.message);
                }
              });
            }

            if (senderId) {
              await serviceSupabase
                .from('instagram_lead_lm_history')
                .upsert({
                  profile_id: pid,
                  ig_username: senderUsername || '',
                  ig_user_id: senderId,
                  keyword_matched: seq.lm_keyword,
                  media_id: storyReplyId,
                  lm_url: shortLink || null,
                  lead_magnet_sent: leadMagnetSent,
                  detected_at: nowIso,
                  ig_account_id: canonicalIgAccountId,
                }, { onConflict: 'profile_id,ig_user_id,media_id,detected_at', ignoreDuplicates: true });
            }

            console.log(`[IG Webhook] Lead story stocké — @${senderUsername}, mot-clé: ${seq.lm_keyword}, séquence: ${story.sequence_id}`);
            pushEvent({ type: 'story_lead_stored', ig_username: senderUsername, keyword: seq.lm_keyword, sequence_id: story.sequence_id });
            continue;
          }
        }
      }

      // On ne traite que les messages REÇUS (pas nos propres envois)
      if (!senderId || !msgText) continue;

      // Le sender est le prospect — cherche un lead avec cet ig_user_id qui a soit
      // reçu le LM (lead_magnet_sent = true), soit est un Cold DM (source = 'cold_dm',
      // toujours lead_magnet_sent = false puisqu'il n'y a jamais eu de commentaire/LM),
      // soit un lead story en attente de suivi (awaiting_story_followup = true)
      // — sans ce 2e/3e cas, une réponse à un Cold DM ou à une séquence story ne fait
      // jamais basculer la carte vers "En conversation".
      // On cherche SANS filtrer sur hook_replied pour toujours mettre à jour hook_replied_at
      // (même si déjà true) → permet de détecter un nouveau message après un recul manuel.
      // Note : un lead story avec awaiting_story_followup=true n'atteint CE bloc que sur
      // son message SUIVANT — le tout premier reply (mot-clé matché) est intercepté plus
      // haut et fait `continue` avant d'arriver ici, donc pas de double traitement possible.

      const { data: leadToUpdate } = await serviceSupabase
        .from('instagram_leads')
        // `media_id` : le contenu dont l'accroche vient d'etre envoyee. Il est connu
        // ICI, au moment de la reponse — et il etait jete. Voir l'insertion plus bas.
        .select('id, hook_replied, ig_username, awaiting_story_followup, media_id')
        .eq('profile_id', pid)
        .eq('ig_user_id', senderId)
        .or('lead_magnet_sent.eq.true,source.eq.cold_dm,awaiting_story_followup.eq.true')
        .order('detected_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (leadToUpdate) {
        const hookRepliedAt = new Date().toISOString();
        const wasAlreadyReplied = leadToUpdate.hook_replied;
        await serviceSupabase
          .from('instagram_leads')
          .update({
            hook_replied: true,
            hook_reply_text: msgText.slice(0, 500),
            hook_replied_at: hookRepliedAt,
            awaiting_story_followup: false,
          })
          .eq('id', leadToUpdate.id);

        if (leadToUpdate.ig_username) {
          serviceSupabase.from('prospect_events').insert({
            profile_id:  pid,
            prospect_key: leadToUpdate.ig_username.toLowerCase(),
            platform:    'ig',
            event_type:  'hook_replied',
            occurred_at: hookRepliedAt,
            ig_lead_id:  leadToUpdate.id,
            // LE CONTENU, fige au moment de la reponse.
            //
            // Sans lui, l'ecran doit RECONSTRUIRE l'attribution en cherchant le dernier
            // lead magnet pris avant cette date : une deduction solide, mais une
            // deduction. Or le fait est connu ici — la fiche porte encore le media_id de
            // l'accroche a laquelle cette personne repond.
            //
            // On ne peut pas le relire plus tard depuis la fiche : `media_id` y est
            // ecrase des que la personne commente un autre post. C'est exactement ce qui
            // faisait afficher au post GUIDE un call et 500 EUR pour zero commentaire.
            // Fige ici, il ne bouge plus.
            //
            // « Conversations declenchees » passe donc d'une ESTIMATION a une MESURE pour tout ce
            // qui arrive a partir de maintenant. L'historique anterieur reste reconstruit,
            // et l'ecran prefere la valeur figee des qu'elle existe.
            metadata:    { media_id: leadToUpdate.media_id ?? null },
          }).then(({ error: evtErr }) => {
            if (evtErr) console.error('[IG Webhook] prospect_events hook_replied:', evtErr.message);
          });
        }

        console.log(`[IG Webhook] hook_replied${wasAlreadyReplied ? ' (repeat)' : ''} — ig_user_id: ${senderId}, lead: ${leadToUpdate.id}, reply: "${msgText.slice(0, 50)}"`);
        pushEvent({ type: 'hook_replied', ig_user_id: senderId, lead_id: leadToUpdate.id, reply_text: msgText.slice(0, 100) });
      }
    }

    // Events sur les changements (commentaires)
    for (const change of entry.changes || []) {
      if (change.field !== 'comments') continue;

      const value = change.value;
      const commentId = value?.id;
      const commentText = value?.text || '';
      const mediaId = value?.media?.id || null;
      const mediaPermalink = value?.media?.permalink || null;
      const commenterId = value?.from?.id ? String(value.from.id) : null;
      const commenterUsername = value?.from?.username || null;
      const timestamp = value?.timestamp
        ? new Date(value.timestamp * 1000).toISOString()
        : new Date().toISOString();

      debugLog('change comments', { commentId, mediaId, commenterUsername, text: commentText });

      if (!commentId || !commentText) continue;
      if (!commenterUsername) {
        console.warn('[IG Webhook] Commentaire sans username (compte supprimé/privé), ignoré:', commentId);
        continue;
      }

      pushEvent({ type: 'comment_received', commentId, commentText, commenterUsername, mediaId, timestamp });

      const integ = resolvedMatch || null;

      if (!integ) {
        pushEvent({ type: 'error', reason: 'profil_non_trouve', igAccountId });
        continue;
      }

      const { profile_id, access_token } = integ;
      pushEvent({ type: 'debug_profile_found', profile_id });

      // Filtre strict : cherche un content_link sur CE post précis avec un keyword qui matche
      // On ne fallback JAMAIS sur un autre post — chaque post a son propre LM
      if (!mediaId) {
        pushEvent({ type: 'error', reason: 'media_id_manquant', commentId });
        continue;
      }

      const { data: contentLinks } = await serviceSupabase
        .from('content_links')
        .select('lm_keyword, lm_short_url, lm_url, dm_opener_message, dm_lm_message, dm_button_text')
        .eq('profile_id', profile_id)
        .eq('content_id', mediaId)
        .not('lm_keyword', 'is', null)
        .not('lm_short_url', 'is', null);

      const cls = contentLinks || [];
      pushEvent({ type: 'debug_content_links', mediaId, count: cls.length, keywords: cls.map((c: any) => c.lm_keyword) });

      if (cls.length === 0) {
        pushEvent({ type: 'no_lm_on_this_post', mediaId });
        continue;
      }

      // Cherche le content_link dont le keyword matche le commentaire — insensible à la
      // casse ET aux accents ("Méta" doit matcher le mot-clé "Meta" configuré par le
      // coach, demande explicite de Chris le 2026-07-30).
      const text = normalizeForKeywordMatch(commentText);
      const cl = cls.find((c: any) => text.includes(normalizeForKeywordMatch(c.lm_keyword)));

      if (!cl) {
        pushEvent({ type: 'keyword_no_match', text, available: cls.map((c: any) => c.lm_keyword) });
        continue;
      }

      const matchedKeyword = cl.lm_keyword;
      console.log(`[IG Webhook] Mot-clé "${matchedKeyword}" matché sur post ${mediaId} — @${commenterUsername}`);
      pushEvent({ type: 'keyword_matched', keyword: matchedKeyword, commenterUsername, mediaId });

      // Cooldown 1 min : si on a déjà envoyé ce LM à cet utilisateur dans la dernière minute, skip
      if (commenterId) {
        const cooldownCutoff = new Date(Date.now() - 60 * 1000).toISOString();
        const { data: recentDm } = await serviceSupabase
          .from('instagram_lead_lm_history')
          .select('id')
          .eq('ig_user_id', commenterId)
          .eq('keyword_matched', matchedKeyword)
          .eq('profile_id', profile_id)
          .gte('detected_at', cooldownCutoff)
          .limit(1)
          .maybeSingle();
        if (recentDm) {
          pushEvent({ type: 'cooldown_skip', commenterUsername, keyword: matchedKeyword });
          continue;
        }
      }

      // Verrou anti-course : Meta envoie parfois 2 notifications webhook quasi simultanées
      // pour le même commentaire (double delivery), avec un detected_at parfois légèrement
      // différent — le cooldown ci-dessus ne suffit pas seul car il lit avant que l'écriture
      // finale (instagram_lead_lm_history, en fin de traitement) n'ait eu lieu. Cet INSERT est
      // atomique : si une requête concurrente a déjà posé le verrou dans les 2 dernières
      // minutes, celle-ci échoue sur la contrainte UNIQUE et on skip tout le traitement (Short.io,
      // envoi DM1, etc).
      if (commenterId) {
        const lockCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        await serviceSupabase
          .from('ig_comment_processing_lock')
          .delete()
          .eq('profile_id', profile_id)
          .eq('ig_user_id', commenterId)
          .eq('media_id', mediaId)
          .lt('locked_at', lockCutoff);

        const { error: lockError } = await serviceSupabase
          .from('ig_comment_processing_lock')
          .insert({ profile_id, ig_user_id: commenterId, media_id: mediaId });

        if (lockError) {
          pushEvent({ type: 'concurrent_processing_skip', commenterUsername, keyword: matchedKeyword });
          continue;
        }
      }

      let leadMagnetSent = false;

      // Le lien Short.io personnalisé n'est PLUS créé ici.
      //
      // Il n'est envoyé qu'en DM2, c'est-à-dire uniquement aux prospects qui ont
      // cliqué sur le bouton du DM1 — or seuls 30 à 50 % cliquent. Le créer dès le
      // commentaire gaspillait la moitié à deux tiers du quota Short.io (plafond
      // d'automation : 1 000 liens/an en gratuit, 10 000/an en Pro — un seul post
      // viral consommait l'année entière) et ajoutait un appel réseau au chemin
      // critique du webhook, celui qui doit répondre à Meta en moins de 30 s sous
      // peine de désabonnement.
      //
      // La création est reportée au clic (bloc LM_LINK_CLICKED, voir
      // createProspectLmLink). `shortLink` reste le lien générique : il sert de
      // repli si la création échoue, et de valeur affichée en attendant le clic.
      const shortLink = cl.lm_short_url;

      // DM1 : accroche SANS le lien — on retire {{lien_lm}} et on nettoie les espaces doubles
      const rawDm1 = cl.dm_lm_message || DM1_DEFAULT_MESSAGE;
      const dm1Text = rawDm1
        .replace(/\{\{lien_lm\}\}/gi, '')
        .replace(/{{username}}/gi, `@${commenterUsername || 'toi'}`)
        .replace(/\s{2,}/g, ' ')
        .trim();

      // DM2 : le lien seul — stocké en DB, envoyé après clic Quick Reply
      const dm2Text = shortLink;

      // DM3 : message d'ouverture de discussion — stocké en DB, envoyé juste après DM2
      const dm3Text = (cl.dm_opener_message || '').replace(/{{username}}/gi, `@${commenterUsername || 'toi'}`).trim();

      // Texte du bouton Quick Reply — configurable par contenu
      const buttonText = (cl.dm_button_text || '🚀 Je veux le lien !').slice(0, 20);

      pushEvent({ type: 'lm_found', lmShortUrl: shortLink, dm1Text, dm2Text, dm3Text, mediaId });

      // Envoie DM 1 via private reply sur le commentaire
      // Test : generic template (attachment) au lieu de quick_replies — quick_replies ne
      // s'affichait jamais côté client sur un envoi via recipient.comment_id (private reply).
      // Le bouton postback force l'utilisateur à cliquer pour ouvrir la fenêtre 24h Meta.
      // Sans ce clic, le message reste en "Demandes" sans notification push
      const dm1Res = await fetch(
        `https://graph.instagram.com/v21.0/${canonicalIgAccountId ?? igAccountId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { comment_id: commentId },
            messaging_type: 'RESPONSE',
            message: {
              attachment: {
                type: 'template',
                payload: {
                  template_type: 'generic',
                  elements: [
                    {
                      title: dm1Text.slice(0, 80),
                      buttons: [
                        {
                          type: 'postback',
                          title: buttonText,
                          payload: 'LM_LINK_CLICKED',
                        },
                      ],
                    },
                  ],
                },
              },
            },
            access_token,
          }),
        }
      );
      const dm1Data = await dm1Res.json();

      if (dm1Data.error) {
        pushEvent({ type: 'dm1_error', error: dm1Data.error, commenterUsername });
        tracerEchecEnvoi('dm1_commentaire', profile_id, dm1Data.error, {
          ig_username: commenterUsername,
          comment_id: commentId,
          media_id: mediaId,
          keyword: matchedKeyword,
        });
        // Transitoire → on lève : la file retente avec backoff. Les retraitements
        // sont sûrs — le verrou expire à 2 min, et le cooldown lit
        // instagram_lead_lm_history, écrite seulement en fin de traitement réussi.
        if (estErreurMetaTransitoire(dm1Data.error)) {
          throw new Error(`meta_transitoire dm1 (${dm1Data.error.code}): ${dm1Data.error.message || ''}`);
        }
      } else {
        leadMagnetSent = true;
        console.log(`[IG Webhook] DM1 envoyé (avec QR button) — message_id: ${dm1Data.message_id}`);
        pushEvent({ type: 'dm1_sent', message_id: dm1Data.message_id, commenterUsername });
        // DM2 sera envoyé quand l'utilisateur clique le bouton Quick Reply (LM_LINK_CLICKED)
      }

      // Upsert lead — 1 seule row par prospect (profile_id, ig_user_id)
      // On met à jour le keyword/media/lm si le prospect revient pour un autre LM, mais
      // detected_at ne doit JAMAIS être réécrit sur un lead existant : c'est la date de
      // première détection utilisée pour dériver l'étape du pipeline (natural) et pour
      // classer le lead au bon jour dans les stats — un commentaire répété (même mot-clé,
      // autre post) ne doit ni faire reculer le pipeline ni reclasser le lead à aujourd'hui.
      // Les commentaires répétés restent tracés via instagram_lead_lm_history plus bas.
      const { data: existingLead } = await serviceSupabase
        .from('instagram_leads')
        .select('id, detected_at, source')
        .eq('profile_id', profile_id)
        .eq('ig_user_id', commenterId)
        .maybeSingle();

      const { data: upsertedLead } = await serviceSupabase
        .from('instagram_leads')
        .upsert({
          profile_id,
          // Meme regle que le chemin story : l'origine d'une personne ne change
          // pas. Un lead venu d'un Cold DM qui commente ensuite un post reste un
          // lead Cold DM — c'est le premier contact qui compte, et c'est ce que
          // l'attribution des paiements suppose (`links.ts` ne retient
          // `cold_dm` que faute de premier contact plus ancien).
          source: existingLead?.source ?? 'comment',
          ig_username: commenterUsername,
          ig_user_id: commenterId,
          message: commentText.slice(0, 500),
          media_id: mediaId || commentId,
          media_permalink: mediaPermalink,
          keyword_matched: matchedKeyword,
          detected_at: existingLead?.detected_at ?? timestamp,
          lead_magnet_sent: leadMagnetSent,
          tracking_link: shortLink || null,
          pending_dm2: dm2Text || null,
          pending_dm3: dm3Text || null,
          // Conservés pour créer le lien Short.io personnalisé AU CLIC du DM1
          // (voir createProspectLmLink). content_id retrouve la bonne ligne
          // content_links ; media_id alimente utm_content et doit être figé
          // maintenant — au moment du clic, on ne saurait plus d'où vient le lead.
          pending_lm_content_id: mediaId,
          pending_lm_media_id: mediaId,
          ig_account_id: canonicalIgAccountId,
        }, { onConflict: 'profile_id,ig_user_id', ignoreDuplicates: false })
        .select('id')
        .maybeSingle();

      // Fetch et stocke l'avatar de façon permanente (fire-and-forget)
      if (upsertedLead?.id && commenterId) {
        const igInteg = await serviceSupabase
          .from('integrations')
          .select('access_token')
          .eq('profile_id', profile_id)
          .eq('provider', 'instagram')
          .maybeSingle();
        if (igInteg.data?.access_token) {
          fetchAndStoreAvatar(commenterId, igInteg.data.access_token).then(avatarUrl => {
            if (avatarUrl) {
              serviceSupabase.from('instagram_leads')
                .update({ avatar_url: avatarUrl })
                .eq('id', upsertedLead.id)
                .then();
            }
          });
        }
      }

      // Enregistre l'événement lm_sent dans prospect_events (index partiel = idempotent)
      if (upsertedLead?.id && commenterUsername) {
        serviceSupabase.from('prospect_events').insert({
          profile_id,
          prospect_key:  commenterUsername.toLowerCase(),
          platform:      'ig',
          event_type:    'lm_sent',
          occurred_at:   timestamp,
          ig_lead_id:    upsertedLead.id,
        }).then(({ error: evtErr }) => {
          if (evtErr && !evtErr.message.includes('duplicate')) {
            console.error('[IG Webhook] prospect_events lm_sent:', evtErr.message);
          }
        });
      }

      // Historique LM : stocke chaque interaction — idempotent via UNIQUE constraint sur
      // comment_id (identifiant Meta stable), pas detected_at (peut différer légèrement
      // entre ce webhook et le cron pollIgComments fallback qui traite parfois le même
      // commentaire — voir commentaire détaillé dans supabase/functions/poll-leads/index.ts).
      // ignoreDuplicates SEULEMENT si ce webhook a échoué à envoyer (leadMagnetSent=false)
      // — un true ne doit jamais écraser un false du cron déjà en base par erreur, mais
      // dans le cas rare où le cron aurait écrit sa ligne AVANT ce webhook, un true réel
      // doit pouvoir mettre à jour cette ligne existante (sinon le badge "réclamé" reste
      // bloqué à false malgré un DM1 réellement envoyé).
      if (commenterId) {
        const { error: lmHistoryError } = await serviceSupabase
          .from('instagram_lead_lm_history')
          .upsert({
            profile_id,
            ig_username: commenterUsername || '',
            ig_user_id: commenterId,
            keyword_matched: matchedKeyword,
            media_id: mediaId || commentId,
            lm_url: shortLink || null,
            lead_magnet_sent: leadMagnetSent,
            detected_at: timestamp,
            comment_id: commentId || null,
            ig_account_id: canonicalIgAccountId,
          }, { onConflict: 'profile_id,ig_user_id,media_id,comment_id', ignoreDuplicates: !leadMagnetSent });
        // Ne jamais laisser cette erreur silencieuse — un upsert cassé ici (ex: contrainte
        // DB incompatible avec onConflict) n'empêche pas le DM1 de partir ni "Lead stocké"
        // de s'afficher plus bas, donc invisible sans ce log explicite (bug vécu 2026-08-13,
        // voir migration 20260813000000_add_lm_history_comment_id.sql).
        if (lmHistoryError) console.error('[IG Webhook] instagram_lead_lm_history upsert:', lmHistoryError.message);
      }

      console.log(`[IG Webhook] Lead stocké — @${commenterUsername}, mot-clé: ${matchedKeyword}`);
      pushEvent({ type: 'lead_stored', commenterUsername, keyword: matchedKeyword, leadMagnetSent });
    }
  }
  } catch (err: any) {
    console.error('[IG Webhook] Erreur de traitement:', err);
    debugLog('Erreur non gérée', { message: err?.message, stack: err?.stack });
    // RELANCÉE, contrairement au comportement d'origine qui l'avalait pour
    // renvoyer 200 à Meta. Meta n'attend plus cette réponse (le 200 part dès la
    // mise en file), donc l'erreur doit remonter au worker pour qu'il marque
    // l'événement en échec et le réessaie. L'avaler ferait passer un échec pour
    // un succès, et le commentaire serait perdu définitivement — Meta n'autorise
    // qu'un private reply par commentaire.
    throw err;
  }
}
