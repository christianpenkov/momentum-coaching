'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import InlineLoader from '@/components/ui/InlineLoader';

interface Props {
  shareUrl: string | null;
  summary: string | null;
  actionItems: unknown;
  transcript: string | null;
  // Email de l'utilisateur qui consulte — sert à marquer "(Vous)" dans le
  // transcript sur les lignes dont matched_calendar_invitee_email correspond.
  currentUserEmail?: string | null;
}

// Fenêtre de grâce pour détecter un refus d'embed — filet de sécurité résiduel,
// gardé au cas où Fathom changerait sa politique CSP un jour. En pratique
// fathom.video/share/{id} refuse l'embed cross-origin (X-Frame-Options: SAMEORIGIN,
// confirmé par test réel) mais fathom.video/embed/{id} — même identifiant, endpoint
// dédié à l'embed — l'autorise explicitement (aucun X-Frame-Options/frame-ancestors,
// confirmé par test réel). On dérive donc toujours l'URL d'embed depuis share_url.
const IFRAME_LOAD_TIMEOUT_MS = 15000;

// Délai de sécurité après le vrai démarrage du document (performance.timeOrigin,
// pas le montage du composant) avant d'autoriser le chargement de l'iframe Fathom
// — laisse à iOS le temps de finir de réallouer la mémoire à la PWA après une
// reprise à froid. Isolé par test réel : une iframe cross-origin légère
// (example.com) chargée dans le même modal/CSS/cycle de vie au 1er clic après
// cold start NE crash PAS, alors que Fathom crash systématiquement dans les
// mêmes conditions — élimine l'hypothèse modal/CSS/cycle de vie, confirme que la
// charge spécifique du player Fathom (JS, polices, décodage vidéo) est la cause.
const POST_LOAD_SAFETY_MS = 4000;

// autoplay=0/preload=none : tentative pour réduire la charge du player au tout
// premier chargement après reprise d'app (piste crash Jetsam iOS) — Fathom accepte
// ces paramètres sans erreur (200 OK confirmé), mais aucune garantie qu'ils soient
// réellement honorés côté player (non documenté publiquement par Fathom).
function toEmbedUrl(shareUrl: string): string {
  return `${shareUrl.replace('/share/', '/embed/')}?autoplay=0&preload=none`;
}

// Log de debug mobile — écrit dans webhook_debug_log via une route API (pas de
// console accessible sur mobile). Fire-and-forget, ne doit jamais bloquer l'UI.
// keepalive:true — sans ça, un fetch en vol au moment où le processus est tué/
// suspendu (crash Jetsam, navigation) est lui-même annulé avant d'atteindre le
// serveur : on perdait potentiellement le dernier log juste avant un crash, le
// signal le plus utile pour comprendre ce qui se passe à ce moment précis.
function logClient(message: string, data: Record<string, unknown> = {}) {
  try {
    fetch('/api/client-log', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `[FathomRecordingSection] ${message}`,
        data: { ...data, ua: typeof navigator !== 'undefined' ? navigator.userAgent : null, ts: Date.now() },
      }),
    }).catch(() => {});
  } catch {}
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

// Confirmé par les logs (avec keepalive:true sur les requêtes de debug, donc
// fiable) : le crash (Jetsam iOS, "A problem occurred with this webpage so it
// was reloaded") survient au niveau OS pendant le chargement de l'iframe cross-
// origin, en cold start après reprise d'app — pageLoadedAt change entre le
// mount qui crash et le suivant, preuve qu'iOS détruit et recrée tout le
// document. Aucun hook JS ne peut s'exécuter quand ça arrive (aucun pagehide/
// unload/error loggé malgré keepalive), donc pas de fix côté code possible —
// seulement un contournement : ne plus charger l'iframe automatiquement au
// montage, l'utilisateur doit cliquer explicitement pour la charger (comme le
// 2e essai qui marchait toujours, sans jamais avoir besoin de fermer/rouvrir).

export default function FathomRecordingSection({ shareUrl, summary, actionItems, transcript, currentUserEmail }: Props) {
  const [embedRequested, setEmbedRequested] = useState(false);
  const [embedFailed, setEmbedFailed] = useState(false);
  const [embedLoaded, setEmbedLoaded] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  // La vraie Fullscreen API est bloquée/limitée sur iOS pour une vidéo à l'intérieur
  // d'un iframe cross-origin (limitation documentée de la plateforme, pas un bug
  // corrigeable côté code) — bouton plein écran maison à la place : agrandit le
  // conteneur de la vidéo en overlay CSS plein écran, pas une vraie sortie
  // fullscreen système, mais donne l'espace visuel attendu.
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  // Incrémenté pour forcer un remount propre de l'iframe (voir onControllerChange
  // ci-dessous) — un nouveau key force React à détruire/recréer le nœud DOM plutôt
  // que de réutiliser une iframe dont la requête réseau a été interrompue.
  const [iframeKey, setIframeKey] = useState(0);
  // iOS bloque screen.orientation.lock() en PWA (aucune vraie rotation d'écran
  // possible en JS, limitation plateforme confirmée) — en plein écran mobile
  // portrait, on simule le paysage en tournant le cadre vidéo lui-même via CSS
  // plutôt que de laisser une vidéo 16:9 minuscule au milieu d'un écran portrait.
  const [isPortrait, setIsPortrait] = useState(false);
  // true tant qu'on attend la fin de POST_LOAD_SAFETY_MS après un clic trop
  // précoce sur "Voir l'enregistrement" — affiche "Un instant…" au lieu de
  // charger l'iframe immédiatement.
  const [waitingForSafety, setWaitingForSafety] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedAtRef = useRef<number>(0);
  const embedLoadedRef = useRef(false);
  const embedRequestedRef = useRef(false);

  useEffect(() => {
    function updateOrientation() {
      setIsPortrait(window.innerHeight > window.innerWidth);
    }
    updateOrientation();
    window.addEventListener('resize', updateOrientation);
    return () => window.removeEventListener('resize', updateOrientation);
  }, []);

  // Instrumentation temporaire — bug mobile "toute la page flashe/recharge" au
  // chargement de la vidéo, cause encore inconnue (pas résolu par délai de montage
  // ni par click-to-load). Ces logs doivent capter : le cycle de vie réel du
  // composant (mount/unmount = la page a-t-elle vraiment rechargé ?), la mémoire
  // dispo si exposée par le navigateur, et tout signal de visibilité/pagehide qui
  // trahirait un rechargement OS plutôt qu'un bug purement visuel.
  useEffect(() => {
    mountedAtRef.current = Date.now();
    const mem = (performance as any).memory;
    const conn = (navigator as any).connection;
    logClient('mount', {
      shareUrl,
      // Marqueur de build fixe (incrémenté manuellement à chaque déploiement de ce
      // fichier) — pour vérifier si le 1er et le 2e essai tournent sur le même code
      // déployé, ou si un cache navigateur/CDN sert une version JS différente
      // (antérieure) au moment du crash.
      buildMarker: 'fathom-debug-v2',
      pageLoadedAt: typeof performance !== 'undefined' ? new Date(performance.timeOrigin).toISOString() : null,
      standalone: typeof window !== 'undefined' ? (window.navigator as any).standalone : null,
      displayModeStandalone: typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(display-mode: standalone)').matches : null,
      memory: mem ? { usedJSHeapSize: mem.usedJSHeapSize, jsHeapSizeLimit: mem.jsHeapSizeLimit } : null,
      onLine: navigator.onLine,
      connection: conn ? { effectiveType: conn.effectiveType, rtt: conn.rtt, downlink: conn.downlink } : null,
    });

    // Piste réseau : mesure le temps réel d'une requête cross-origin vers fathom.video
    // (indépendante de l'iframe elle-même) — si iOS met du temps à "réveiller" la
    // connexion réseau au tout premier chargement après reprise d'app, ce fetch devrait
    // le révéler avec un timing anormalement long comparé aux ouvertures suivantes.
    if (shareUrl) {
      const netStart = Date.now();
      fetch('https://fathom.video/favicon.ico', { mode: 'no-cors', cache: 'no-store' })
        .then(() => logClient('network_probe_ok', { durationMs: Date.now() - netStart }))
        .catch(err => logClient('network_probe_error', { durationMs: Date.now() - netStart, error: String(err) }));
    }

    function onVisibilityChange() {
      logClient('visibilitychange', { state: document.visibilityState, msSinceMount: Date.now() - mountedAtRef.current });
    }
    function onPageHide(e: PageTransitionEvent) {
      logClient('pagehide', { persisted: e.persisted, msSinceMount: Date.now() - mountedAtRef.current });
    }
    function onPageShow(e: PageTransitionEvent) {
      logClient('pageshow', { persisted: e.persisted, msSinceMount: Date.now() - mountedAtRef.current });
    }
    function onControllerChange() {
      // iOS tue le SW en arrière-plan et le relance à la réouverture de l'app — ce
      // relaunch peut tomber pile pendant le tout premier chargement de l'iframe
      // Fathom (confirmé par les logs : sw_controllerchange loggé avec embedLoaded:
      // false au moment exact du crash "flash/reload"). clients.claim() dans sw.js
      // interrompt alors la requête réseau en cours, et onLoad ne se déclenche
      // jamais — l'iframe reste bloquée indéfiniment. On force ici un remount
      // propre (nouvelle iframe, nouvelle requête) plutôt que de laisser
      // l'utilisateur constater un chargement infini et devoir rouvrir le modal.
      const stillLoading = embedRequestedRef.current && !embedLoadedRef.current;
      logClient('sw_controllerchange', { msSinceMount: Date.now() - mountedAtRef.current, embedLoaded: embedLoadedRef.current, forcingRemount: stillLoading });
      if (stillLoading) {
        embedLoadedRef.current = false;
        setEmbedLoaded(false);
        setIframeKey(k => k + 1);
      }
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker.getRegistration().then(reg => {
        logClient('sw_registration_state', {
          active: !!reg?.active,
          waiting: !!reg?.waiting,
          installing: !!reg?.installing,
          scope: reg?.scope ?? null,
        });
      }).catch(() => {});
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      logClient('unmount', { msSinceMount: Date.now() - mountedAtRef.current });
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      }
      if (safetyTimeoutRef.current) clearTimeout(safetyTimeoutRef.current);
    };
  }, [shareUrl]);

  useEffect(() => {
    embedRequestedRef.current = embedRequested;
  }, [embedRequested]);

  useEffect(() => {
    if (!embedRequested || !shareUrl) return;
    logClient('iframe_timer_start', { shareUrl, embedUrl: toEmbedUrl(shareUrl), iframeKey });

    timeoutRef.current = setTimeout(() => {
      logClient('iframe_timeout_fallback', { shareUrl, msWaited: IFRAME_LOAD_TIMEOUT_MS });
      setEmbedFailed(true);
    }, IFRAME_LOAD_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [shareUrl, embedRequested, iframeKey]);

  // Instrumentation temporaire — le crash "flash/reload" tue le process avant que
  // tout hook JS (unmount, pagehide, controllerchange) ait la moindre chance de
  // logger quoi que ce soit : les traces précédentes montrent un simple trou de
  // silence entre le dernier log et le mount suivant, sans aucun signal de sortie.
  // Un battement toutes les 500ms pendant le chargement de l'iframe (mémoire,
  // presence du SW controller, visibilité) permet de voir dans quel état exact on
  // était juste avant le dernier battement reçu — la dernière chose vue avant le
  // silence est le meilleur indice disponible sur la cause réelle.
  useEffect(() => {
    if (!embedRequested || embedLoaded) return;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const mem = (performance as any).memory;
      logClient('heartbeat_while_loading', {
        msSinceEmbedRequested: Date.now() - startedAt,
        memory: mem ? { usedJSHeapSize: mem.usedJSHeapSize, jsHeapSizeLimit: mem.jsHeapSizeLimit } : null,
        swController: !!navigator.serviceWorker?.controller,
        visibilityState: document.visibilityState,
      });
    }, 500);
    return () => clearInterval(interval);
  }, [embedRequested, embedLoaded]);

  const items = parseActionItems(actionItems);
  const transcriptLines = transcript ? parseTranscript(transcript) : null;
  const speakerColor = new Map<string, string>();
  function colorFor(name: string) {
    if (!speakerColor.has(name)) speakerColor.set(name, SPEAKER_COLORS[speakerColor.size % SPEAKER_COLORS.length]);
    return speakerColor.get(name)!;
  }

  if (!shareUrl && !summary && !items.length && !transcript) return null;

  // Rendu du bloc vidéo — factorisé pour être appelé soit inline (position normale
  // dans la modale), soit via un portal vers document.body (plein écran). Un
  // ancêtre avec transform (l'animation framer-motion de ModalShell) casse
  // position:fixed pour tout descendant — un fixed en profondeur devient relatif à
  // cet ancêtre au lieu du viewport (règle CSS standard, confirmée). D'où le
  // portal : seule façon de garantir un vrai plein écran couvrant l'écran entier.
  // Contrepartie acceptée : l'iframe se remonte (recharge ~2-3s) au passage en
  // plein écran, car le portal crée un nouveau nœud DOM plutôt que de déplacer
  // l'existant.
  function renderVideoBox(fullscreen: boolean) {
    return (
      <div
        style={fullscreen ? {
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100dvh', zIndex: 9999, background: '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        } : { position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', background: 'var(--surface-2)' }}
      >
      {/* Le player Fathom intégré ne remplit pas un cadre portrait extrême (ex.
          390x844 en plein écran mobile) — il garde son propre ratio 16:9 interne et
          laisse le reste de l'iframe vide en noir (confirmé par test réel, capture
          d'écran mobile : vidéo minuscule collée en haut). On contraint donc l'iframe
          elle-même à un ratio 16:9 centré dans l'overlay noir plutôt que de l'étirer
          sur 100% de la hauteur — en desktop/paysage ça occupe déjà quasi tout
          l'écran, en portrait mobile ça évite le vide noir sous une vidéo minuscule. */}
      <div
        style={fullscreen
          ? (isPortrait
            // Rotation CSS pure — le wrapper échange largeur/hauteur (sa largeur
            // tournée devient la hauteur d'écran, et vice versa) puis pivote de 90°
            // autour de son centre pour occuper l'espace ainsi libéré. Résultat
            // visuel équivalent à un vrai paysage sans jamais toucher à
            // l'orientation réelle du téléphone (impossible sur iOS PWA).
            ? { position: 'relative', width: '100dvh', maxHeight: '100vw', aspectRatio: '16 / 9', transform: 'rotate(90deg)' }
            : { position: 'relative', width: '100%', maxHeight: '100%', aspectRatio: '16 / 9' })
          : { display: 'contents' }}
      >
        {!embedRequested && !waitingForSafety && (
          <button
            type="button"
            onClick={(e) => {
              const btn = e.currentTarget;
              const msSincePageLoad = Date.now() - performance.timeOrigin;
              const remainingWait = POST_LOAD_SAFETY_MS - msSincePageLoad;
              logClient('embed_requested', {
                fullscreen,
                msSincePageLoad,
                remainingWait,
                // Écarte l'hypothèse d'un bouton dans un <form> qui déclencherait
                // une soumission/navigation involontaire sur iOS (type="button" est
                // déjà posé ci-dessus, mais on vérifie aussi qu'aucun ancêtre <form>
                // ou <a> n'englobe le bouton, ce qui casserait ça malgré tout).
                inForm: !!btn.closest('form'),
                inAnchor: !!btn.closest('a'),
                defaultPrevented: e.defaultPrevented,
              });
              if (remainingWait > 0) {
                setWaitingForSafety(true);
                safetyTimeoutRef.current = setTimeout(() => {
                  logClient('safety_wait_elapsed', { waitedMs: remainingWait });
                  setWaitingForSafety(false);
                  setEmbedRequested(true);
                }, remainingWait);
              } else {
                setEmbedRequested(true);
              }
            }}
            style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: fullscreen ? '#fff' : 'var(--ink-2)',
            }}
          >
            <Icon name="video" size={28} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Voir l'enregistrement</span>
          </button>
        )}
        {waitingForSafety && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 8, color: fullscreen ? '#fff' : 'var(--ink-2)',
          }}>
            <InlineLoader />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Un instant…</span>
          </div>
        )}
        {embedRequested && !embedLoaded && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <InlineLoader />
          </div>
        )}
        {embedRequested && (
          <iframe
            key={iframeKey}
            src={toEmbedUrl(shareUrl!)}
            title="Enregistrement de l'appel"
            allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            // Attributs préfixés legacy : Safari iOS/mobile en particulier peut
            // ignorer silencieusement la demande fullscreen du player interne sans
            // eux, même avec allow="fullscreen" présent.
            // @ts-expect-error — attribut HTML legacy non typé par React/JSX
            webkitallowfullscreen="true"
            mozallowfullscreen="true"
            style={fullscreen
              ? { width: '100%', height: '100%', border: 'none' }
              : { width: '100%', height: '100%', border: 'none', opacity: embedLoaded ? 1 : 0, transition: 'opacity 0.2s' }}
            onLoad={() => {
              logClient('iframe_onload', { msSinceMount: Date.now() - mountedAtRef.current, fullscreen });
              embedLoadedRef.current = true;
              setEmbedLoaded(true);
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
            }}
          />
        )}
        {embedRequested && (
          <button
            type="button"
            onClick={() => setVideoFullscreen(v => !v)}
            aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}
            style={{
              position: 'absolute', bottom: 10, right: 10, width: 34, height: 34,
              borderRadius: 8, border: 'none', background: 'rgba(0,0,0,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 1,
            }}
          >
            <Icon name={fullscreen ? 'x' : 'maximize'} size={16} style={{ color: '#fff' }} />
          </button>
        )}
      </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
      {shareUrl && (
        <div style={{ marginBottom: 16 }}>
          {!embedFailed ? (
            <>
              {renderVideoBox(false)}
              {videoFullscreen && typeof document !== 'undefined' && createPortal(renderVideoBox(true), document.body)}
            </>
          ) : (
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary-brand"
              style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              onClick={() => logClient('fallback_link_click', { shareUrl })}
            >
              <Icon name="video" size={15} /> Voir l'enregistrement
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

      {transcript && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: 13, fontWeight: 600, padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => setShowTranscript(v => !v)}
          >
            <Icon name={showTranscript ? 'chevron-up' : 'chevron-down'} size={14} />
            {showTranscript ? 'Masquer la transcription' : 'Voir la transcription complète'}
          </button>
          {showTranscript && (
            <div style={{ marginTop: 10, maxHeight: 320, overflowY: 'auto', padding: 14, background: 'var(--surface-2)', borderRadius: 8 }}>
              {transcriptLines ? (
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
                <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{transcript}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
