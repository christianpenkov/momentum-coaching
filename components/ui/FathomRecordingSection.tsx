'use client';

import { useState, useRef, useEffect } from 'react';
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

function toEmbedUrl(shareUrl: string): string {
  return shareUrl.replace('/share/', '/embed/');
}

// Log de debug mobile — écrit dans webhook_debug_log via une route API (pas de
// console accessible sur mobile). Fire-and-forget, ne doit jamais bloquer l'UI.
function logClient(message: string, data: Record<string, unknown> = {}) {
  try {
    fetch('/api/client-log', {
      method: 'POST',
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

export default function FathomRecordingSection({ shareUrl, summary, actionItems, transcript, currentUserEmail }: Props) {
  const [embedFailed, setEmbedFailed] = useState(false);
  const [embedLoaded, setEmbedLoaded] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  // La vraie Fullscreen API est bloquée/limitée sur iOS pour une vidéo à l'intérieur
  // d'un iframe cross-origin (limitation documentée de la plateforme, pas un bug
  // corrigeable côté code) — bouton plein écran maison à la place : agrandit le
  // conteneur de la vidéo en overlay CSS plein écran, pas une vraie sortie
  // fullscreen système, mais donne l'espace visuel attendu.
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  // Remonter l'iframe avec une clé fraîche force un rechargement propre — utilisé
  // en secours si le SW prend le contrôle de la page en plein chargement (voir
  // useEffect controllerchange ci-dessous).
  const [iframeKey, setIframeKey] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedAtRef = useRef<number>(0);
  const embedLoadedRef = useRef(false);

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
    // Confirmé par les logs : iOS tue le Service Worker en arrière-plan quand la PWA
    // est fermée, et le relance (install/activate/clients.claim) au tout premier
    // chargement de page suivant une réouverture — pile le moment où cette section
    // se monte pour la première fois. clients.claim() interrompt le chargement de
    // l'iframe en cours (jamais d'iframe_onload observé dans ce cas), d'où le "flash/
    // reload" — corrigé ici en relançant proprement l'iframe si ça arrive avant que
    // la vidéo ait fini de charger, plutôt que de laisser un état cassé.
    function onControllerChange() {
      logClient('sw_controllerchange', { msSinceMount: Date.now() - mountedAtRef.current, embedLoaded: embedLoadedRef.current });
      if (!embedLoadedRef.current) {
        logClient('iframe_reload_after_controllerchange', {});
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
    };
  }, [shareUrl]);

  useEffect(() => {
    if (!shareUrl) return;
    logClient('iframe_timer_start', { shareUrl, embedUrl: toEmbedUrl(shareUrl) });
    timeoutRef.current = setTimeout(() => {
      logClient('iframe_timeout_fallback', { shareUrl, msWaited: IFRAME_LOAD_TIMEOUT_MS });
      setEmbedFailed(true);
    }, IFRAME_LOAD_TIMEOUT_MS);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [shareUrl]);

  const items = parseActionItems(actionItems);
  const transcriptLines = transcript ? parseTranscript(transcript) : null;
  const speakerColor = new Map<string, string>();
  function colorFor(name: string) {
    if (!speakerColor.has(name)) speakerColor.set(name, SPEAKER_COLORS[speakerColor.size % SPEAKER_COLORS.length]);
    return speakerColor.get(name)!;
  }

  if (!shareUrl && !summary && !items.length && !transcript) return null;

  return (
    <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
      {shareUrl && (
        <div style={{ marginBottom: 16 }}>
          {!embedFailed ? (
            <div
              style={videoFullscreen ? {
                position: 'fixed', top: 0, left: 0, width: '100vw', height: '100dvh', zIndex: 9999, background: '#000',
              } : { position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', background: 'var(--surface-2)' }}
            >
              {!embedLoaded && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <InlineLoader />
                </div>
              )}
              <iframe
                key={iframeKey}
                src={toEmbedUrl(shareUrl)}
                title="Enregistrement de l'appel"
                allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                // Attributs préfixés legacy : Safari iOS/mobile en particulier peut
                // ignorer silencieusement la demande fullscreen du player interne sans
                // eux, même avec allow="fullscreen" présent.
                // @ts-expect-error — attribut HTML legacy non typé par React/JSX
                webkitallowfullscreen="true"
                mozallowfullscreen="true"
                style={{ width: '100%', height: '100%', border: 'none', opacity: embedLoaded ? 1 : 0, transition: 'opacity 0.2s' }}
                onLoad={() => {
                  logClient('iframe_onload', { msSinceMount: Date.now() - mountedAtRef.current });
                  embedLoadedRef.current = true;
                  setEmbedLoaded(true);
                  if (timeoutRef.current) clearTimeout(timeoutRef.current);
                }}
              />
              {embedLoaded && (
                <button
                  type="button"
                  onClick={() => setVideoFullscreen(v => !v)}
                  aria-label={videoFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
                  style={{
                    position: 'absolute', bottom: 10, right: 10, width: 34, height: 34,
                    borderRadius: 8, border: 'none', background: 'rgba(0,0,0,0.55)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  }}
                >
                  <Icon name={videoFullscreen ? 'x' : 'maximize'} size={16} style={{ color: '#fff' }} />
                </button>
              )}
            </div>
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
