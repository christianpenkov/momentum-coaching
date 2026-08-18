'use client';

import { useState } from 'react';
import Icon from '@/components/ui/Icon';

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

export default function FathomRecordingSection({ shareUrl, summary, actionItems, transcript, currentUserEmail, callId, hasTranscript }: Props) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [onMobile] = useState(isMobile);
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

  return (
    <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
      {shareUrl && (
        <div style={{ marginBottom: 16 }}>
          {onMobile ? (
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
