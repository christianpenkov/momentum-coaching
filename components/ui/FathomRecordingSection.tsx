'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';

interface Props {
  shareUrl: string | null;
  summary: string | null;
  actionItems: unknown;
  // Transcript déjà en mémoire. Laisser à null et fournir `callId` pour un
  // chargement à la demande (voir hasTranscript ci-dessous).
  transcript: string | null;
  // Email de l'utilisateur qui consulte — sert à marquer "(Vous)" dans le
  // transcript sur les lignes dont matched_calendar_invitee_email correspond.
  currentUserEmail?: string | null;
  // Chargement à la demande : le transcript n'est plus embarqué dans le
  // `calls.select('*')` du contexte coach (~40 Ko par call, sur chaque page).
  // `hasTranscript` dit s'il en existe un — sans transporter son contenu — pour
  // décider d'afficher le bouton ; `callId` sert à aller le chercher au clic.
  callId?: string | null;
  hasTranscript?: boolean;
  /**
   * Lit l'enregistrement dans la page via le MP4 servi par l'API Fathom, plutôt
   * que par l'iframe du lecteur — sur mobile ET sur desktop.
   *
   * Volontairement en OPT-IN : mise en service limitée à la modale Infos des
   * pages Calls. Sans ce drapeau, le comportement reste celui d'avant (iframe
   * sur desktop, lien sur mobile).
   */
  inlineVideo?: boolean;
}

function parseActionItems(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(item => (typeof item === 'string' ? item : (item as any)?.description || (item as any)?.text || JSON.stringify(item)));
  }
  return [];
}

interface TranscriptLine {
  speakerName: string;
  speakerEmail: string | null;
  text: string;
  timestamp: string;
}

// fathom_transcript est stocké en base via JSON.stringify(transcript) — un tableau
// { speaker: { display_name, matched_calendar_invitee_email }, text, timestamp }[]
// (format confirmé par appel réel à l'API Fathom). Si le JSON.parse échoue ou ne
// matche pas ce shape, on retombe sur le texte brut plutôt que de planter.
function parseTranscript(raw: string): TranscriptLine[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length || !parsed[0]?.speaker) return null;
    return parsed.map((line: any) => ({
      speakerName: line.speaker?.display_name || 'Inconnu',
      speakerEmail: line.speaker?.matched_calendar_invitee_email || null,
      text: line.text || '',
      timestamp: line.timestamp || '',
    }));
  } catch {
    return null;
  }
}

// Couleurs stables par intervenant (assignées dans l'ordre d'apparition), pour
// distinguer visuellement qui parle sans dépendre d'une correspondance email fragile.
const SPEAKER_COLORS = ['var(--accent-brand)', 'var(--green)', '#8b5cf6', '#f59e0b'];

function toEmbedUrl(shareUrl: string): string {
  return shareUrl.replace('/share/', '/embed/');
}

// L'iframe Fathom embarquée (fathom.video/embed/{id}) déclenche un bug WebKit
// reproductible sur iOS — crash/reload systématique de toute la page au 1er
// chargement après cold start du navigateur. Confirmé isolé au player Fathom
// lui-même (pas notre modal/CSS/Service Worker) via tests contrôlés : une
// iframe légère (example.com) et YouTube dans le même contexte ne crashent
// jamais ; aucune combinaison de paramètres d'URL Fathom (autoplay, preload,
// share vs embed) n'évite le crash sans casser l'affichage. Le bug n'a jamais
// été reproduit sur desktop — par précaution on route tout mobile (Android
// inclus, jamais testé, pas seulement iOS où le bug est confirmé) vers le
// lien Fathom (shareUrl) ouvert dans le navigateur système plutôt que de
// charger l'iframe ; sur desktop elle s'affiche directement dans la page.
function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod|Android/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export default function FathomRecordingSection({ shareUrl, summary, actionItems, transcript, currentUserEmail, callId, hasTranscript, inlineVideo }: Props) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [onMobile] = useState(isMobile);

  // On demande à Fathom un MP4 et on le joue dans une balise <video> native, au
  // lieu de charger son lecteur en iframe.
  //
  // Sur mobile c'est ce qui règle le crash WebKit (le lecteur n'est jamais
  // chargé). Sur desktop l'iframe fonctionnait, mais le lecteur natif donne la
  // même vidéo sans dépendre d'un tiers dans la page.
  //
  // Mesuré sur deux captations réelles : 10 s à la première demande, 0,4 s
  // ensuite (Fathom garde le fichier ~24 h), ~3,9 Mo par minute en 720p, lecture
  // en flux dès le début.
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  // Lien Fathom de l'enregistrement effectivement servi. Quand coach et élève ont
  // tous les deux enregistré le call, chacun reçoit le sien : « Voir sur Fathom »
  // l'emmène alors sur SA page, où il peut fouiller le transcript et interroger
  // l'IA sur son propre compte. Null tant qu'on ne sait pas : on garde celui du
  // call, qui reste valable pour tout le monde.
  const [shareUrlPropre, setShareUrlPropre] = useState<string | null>(null);
  // La première image est-elle décodée et prête à l'écran ?
  //
  // Le lecteur met encore 2 à 3 s après l'arrivée de l'URL : il doit ouvrir une
  // connexion vers le stockage, lire les métadonnées, se placer sur l'image du
  // fragment `#t=0.1`, puis la décoder. Sans ce drapeau, l'utilisateur voit le
  // squelette laisser place à un rectangle NOIR pendant ce temps-là, et l'image
  // n'apparaître qu'après — ce qui se lit comme un deuxième chargement.
  //
  // On garde donc le squelette PAR-DESSUS le lecteur jusqu'à cette image. Le
  // lecteur et son image apparaissent alors ensemble, sans étape noire.
  const [imagePrete, setImagePrete] = useState(false);
  const tenteLectureIntegree = !!inlineVideo && !!callId && !!shareUrl;

  // Filet de sécurité : si l'image n'arrive jamais (codec exotique, réseau qui
  // s'écroule, événement avalé), on découvre le lecteur au bout de 4 s. Mieux
  // vaut un rectangle noir avec des commandes utilisables qu'un squelette
  // éternel sur une vidéo qui, elle, est peut-être parfaitement lisible.
  useEffect(() => {
    if (!videoUrl) return;
    setImagePrete(false);
    const t = setTimeout(() => setImagePrete(true), 4000);
    return () => clearTimeout(t);
  }, [videoUrl]);

  useEffect(() => {
    if (!tenteLectureIntegree) return;
    let vivant = true;
    setVideoState('loading');

    (async () => {
      // La génération est asynchrone : Fathom répond `processing` puis il faut
      // redemander. Borné à ~45 s — au-delà on laisse le lien Fathom prendre le
      // relais plutôt que de faire attendre indéfiniment.
      for (let essai = 0; essai < 15 && vivant; essai++) {
        try {
          const res = await fetch(`/api/calls/${callId}/fathom-download`, { method: 'POST' });
          if (!res.ok) { if (vivant) setVideoState('failed'); return; }
          const data = await res.json();

          if (data.status === 'completed' && data.url) {
            if (vivant) {
              setVideoUrl(data.url);
              if (data.shareUrl) setShareUrlPropre(data.shareUrl);
              setVideoState('ready');
            }
            return;
          }
          if (data.status === 'failed' || data.status === 'expired') {
            if (vivant) setVideoState('failed');
            return;
          }
        } catch {
          if (vivant) setVideoState('failed');
          return;
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      if (vivant) setVideoState('failed');
    })();

    return () => { vivant = false; };
  }, [tenteLectureIntegree, callId]);
  // Transcript récupéré à la demande. `transcript` (prop) reste prioritaire pour
  // les appelants qui l'ont déjà en mémoire — aucun changement de comportement
  // pour eux.
  const [fetchedTranscript, setFetchedTranscript] = useState<string | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState(false);

  const items = parseActionItems(actionItems);
  const effectiveTranscript = transcript ?? fetchedTranscript;
  // Un transcript existe soit parce qu'on l'a déjà, soit parce que l'appelant
  // signale sa présence sans en transporter le contenu.
  const transcriptAvailable = !!transcript || !!hasTranscript;
  const transcriptLines = effectiveTranscript ? parseTranscript(effectiveTranscript) : null;
  const speakerColor = new Map<string, string>();
  function colorFor(name: string) {
    if (!speakerColor.has(name)) speakerColor.set(name, SPEAKER_COLORS[speakerColor.size % SPEAKER_COLORS.length]);
    return speakerColor.get(name)!;
  }

  async function toggleTranscript() {
    if (showTranscript) { setShowTranscript(false); return; }
    setShowTranscript(true);
    // Déjà chargé (ou fourni par l'appelant) : rien à faire.
    if (effectiveTranscript || !callId) return;
    setLoadingTranscript(true);
    setTranscriptError(false);
    try {
      const res = await fetch(`/api/calls/${callId}/transcript`);
      if (!res.ok) throw new Error('fetch_failed');
      const data = await res.json();
      setFetchedTranscript(data.transcript ?? null);
    } catch {
      setTranscriptError(true);
    } finally {
      setLoadingTranscript(false);
    }
  }

  if (!shareUrl && !summary && !items.length && !transcriptAvailable) return null;

  // Quel lecteur est affiché — calculé une fois, pour que le lien « Voir sur
  // Fathom » plus bas sache s'il ferait doublon.
  const brancheLecteur =
    videoState === 'ready' && videoUrl ? 'video'
      : tenteLectureIntegree && videoState !== 'failed' ? 'squelette'
        : onMobile ? 'lien'
          : 'iframe';

  return (
    <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
      {shareUrl && (
        <div style={{ marginBottom: 16 }}>
          {videoState === 'ready' && videoUrl ? (
            // Le squelette est POSÉ SUR le lecteur, pas mis à sa place : le
            // lecteur doit charger et décoder pendant qu'il est encore couvert.
            // Le masquer avec `visibility` ou `display` risquerait au contraire
            // de faire dépriorriser son chargement par le navigateur.
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9' }}>
              <video
                // `#t=0.1` — fragment de média : « commence à 0,1 s ». C'est ce qui
                // fait apparaître une image d'aperçu avant le premier appui.
                //
                // POURQUOI : `preload="metadata"` ne charge que la durée et les
                // dimensions. Les navigateurs de bureau peignent quand même la
                // première image ; iOS non, et laisse un rectangle noir. Le
                // fragment force le navigateur à se placer sur cette image-là,
                // donc à la décoder et à l'afficher.
                //
                // Le coût est d'une requête de plage (le serveur de Fathom les
                // accepte, HTTP 206), pas du fichier entier — `preload="auto"`
                // aurait aussi marché mais en téléchargeant ~3,9 Mo par minute de
                // call sur le forfait mobile de l'élève.
                //
                // Le fragment se place APRÈS les paramètres de l'URL signée sans
                // la casser : un `#…` n'est jamais envoyé au serveur. Ne pas le
                // transformer en paramètre de requête, ça invaliderait la signature.
                //
                // Fathom ne fournit aucune miniature (vérifié sur /meetings et sur
                // /recordings/{id}/download) : sans ce fragment il n'y a pas
                // d'aperçu du tout.
                src={`${videoUrl}#t=0.1`}
                controls
                playsInline
                preload="metadata"
                // `loadeddata` = l'image de la position courante est décodée, donc
                // exactement celle du fragment. `seeked` sert de doublure au cas où
                // l'ordre des deux varie selon le navigateur : le premier arrivé
                // découvre le lecteur, le second ne fait rien.
                onLoadedData={() => setImagePrete(true)}
                onSeeked={() => setImagePrete(true)}
                // En cas d'échec on découvre aussi : la balise affichera son propre
                // état, ce que le squelette masquerait indéfiniment.
                onError={() => setImagePrete(true)}
                style={{ width: '100%', height: '100%', borderRadius: 10, background: '#000', display: 'block' }}
              />
              {!imagePrete && (
                <div style={{ position: 'absolute', inset: 0 }}>
                  <Skeleton width="100%" height="100%" radius={10} />
                </div>
              )}
            </div>
          ) : tenteLectureIntegree && videoState !== 'failed' ? (
            // Squelette aux dimensions du lecteur, jamais le bouton « Voir
            // l'enregistrement » : pendant la génération il n'ouvrirait pas ce
            // qu'on est en train de préparer, et il disparaîtrait sous le doigt
            // dès la vidéo prête. La forme annonce ce qui arrive, à la place
            // exacte où ça arrivera.
            <Skeleton width="100%" height="auto" radius={10} style={{ aspectRatio: '16 / 9' }} />
          ) : onMobile ? (
            // Repli mobile : le lecteur Fathom en iframe fait planter WebKit
            // (voir plus haut), donc un lien vers le navigateur système.
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary-brand"
              style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <Icon name="video" size={15} /> Voir l'enregistrement
            </a>
          ) : (
            // Repli desktop : l'iframe Fathom, qui n'y a jamais posé problème.
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', background: 'var(--surface-2)' }}>
              <iframe
                src={toEmbedUrl(shareUrl)}
                title="Enregistrement de l'appel"
                allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            </div>
          )}

          {/* Accès à la page Fathom de l'appel — résumé, transcription, recherche.
              Sa page à lui quand il a enregistré (cf. shareUrlPropre), sinon celle
              du call.

              Le lien de partage est PUBLIC — vérifié : aucune connexion demandée,
              lecteur et transcription visibles depuis un navigateur anonyme. C'est
              ce qui permet au participant qui n'avait pas le bot d'y accéder, et
              ce qui rend le lien transmissible tel quel. Cela dépend d'un réglage
              Fathom côté compte enregistreur (« Anyone with the link can view ») :
              la consigne est affichée dans les Réglages, cf. FathomSetupHint.tsx.

              Masqué dans deux cas : pendant le squelette, où il sauterait sous le
              doigt à l'arrivée de la vidéo ; et sur le repli mobile, dont le bouton
              ouvre déjà exactement cette page. */}
          {(brancheLecteur === 'video' || brancheLecteur === 'iframe') && (
            <a
              href={shareUrlPropre || shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10,
                padding: '6px 12px',
                border: '1px solid var(--border)', borderRadius: 7,
                fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', textDecoration: 'none',
              }}
            >
              <Icon name="external" size={13} /> Voir sur Fathom
            </a>
          )}
        </div>
      )}

      {summary && (
        <div style={{ marginBottom: items.length ? 14 : 0 }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Résumé Fathom</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{summary}</div>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Points d'action</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.7 }}>
            {items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}

      {transcriptAvailable && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: 13, fontWeight: 600, padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={toggleTranscript}
            disabled={loadingTranscript}
          >
            <Icon name={showTranscript ? 'chevron-up' : 'chevron-down'} size={14} />
            {showTranscript ? 'Masquer la transcription' : 'Voir la transcription complète'}
          </button>
          {showTranscript && (
            <div style={{ marginTop: 10, maxHeight: 320, overflowY: 'auto', padding: 14, background: 'var(--surface-2)', borderRadius: 8 }}>
              {loadingTranscript ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>
                  Chargement de la transcription…
                </div>
              ) : transcriptError ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>
                  Impossible de charger la transcription.{' '}
                  <button
                    type="button"
                    onClick={() => { setFetchedTranscript(null); setShowTranscript(false); toggleTranscript(); }}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-brand)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Réessayer
                  </button>
                </div>
              ) : !effectiveTranscript ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>
                  Transcription indisponible.
                </div>
              ) : transcriptLines ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {transcriptLines.map((line, i) => {
                    const isYou = !!currentUserEmail && !!line.speakerEmail && line.speakerEmail.toLowerCase() === currentUserEmail.toLowerCase();
                    return (
                      <div key={i}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: colorFor(line.speakerName) }}>
                            {line.speakerName}{isYou && ' (Vous)'}
                          </span>
                          {line.timestamp && <span style={{ fontSize: 10, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{line.timestamp}</span>}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{line.text}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{effectiveTranscript}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
