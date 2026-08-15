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
// Délai volontairement généreux : l'iframe charge une page complète (HTML/JS/player),
// pas juste un fichier vidéo — un timeout court (ex. 4s) déclenchait le fallback à
// tort sur une modale qui vient de s'ouvrir, alors que l'embed finissait par charger
// correctement une seconde plus tard (observé en conditions réelles).
const IFRAME_LOAD_TIMEOUT_MS = 15000;

function toEmbedUrl(shareUrl: string): string {
  return shareUrl.replace('/share/', '/embed/');
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Un seul timer par shareUrl — le nettoyage se fait via onLoad (clearTimeout direct),
  // pas via une dépendance embedLoaded qui reprogrammerait inutilement le timer à
  // chaque changement d'état.
  useEffect(() => {
    if (!shareUrl) return;
    timeoutRef.current = setTimeout(() => setEmbedFailed(true), IFRAME_LOAD_TIMEOUT_MS);
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
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', background: 'var(--surface-2)' }}>
              {!embedLoaded && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <InlineLoader />
                </div>
              )}
              <iframe
                src={toEmbedUrl(shareUrl)}
                title="Enregistrement de l'appel"
                allow="fullscreen"
                allowFullScreen
                style={{ width: '100%', height: '100%', border: 'none', opacity: embedLoaded ? 1 : 0, transition: 'opacity 0.2s' }}
                onLoad={() => { setEmbedLoaded(true); if (timeoutRef.current) clearTimeout(timeoutRef.current); }}
              />
            </div>
          ) : (
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary-brand"
              style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}
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
