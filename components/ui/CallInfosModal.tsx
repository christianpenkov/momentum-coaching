'use client';

import type { ReactNode } from 'react';
import Icon from '@/components/ui/Icon';
import ModalShell from '@/components/ui/ModalShell';
import FathomRecordingSection from '@/components/ui/FathomRecordingSection';
import { SESSION_TOPICS, type SessionTopic } from '@/lib/sessionRapport';
import { useUser } from '@/lib/UserContext';
import { useViewerTimeZone } from '@/lib/UserContext';
import { formatDateIn } from '@/lib/timezone';

interface FathomData {
  shareUrl: string | null;
  summary: string | null;
  actionItems: unknown;
  /**
   * Transcript déjà en mémoire. Laisser à null et renseigner `callId` +
   * `hasTranscript` pour un chargement à la demande (le transcript n'est plus
   * embarqué dans le contexte coach : ~40 Ko par call, sur chaque page).
   */
  transcript: string | null;
  callId?: string | null;
  hasTranscript?: boolean;
}

interface Props {
  counterpartName: string | null;
  scheduledAt: string | null;
  // Rapport de session (flux coaching) — optionnel, absent si pas encore rempli
  // ou si le call vient du flux vente (topic/notes gérés différemment côté RapportModal).
  attended?: boolean | null;
  topic?: SessionTopic | null;
  topicCustom?: string | null;
  notes?: string | null;
  studentNotes?: string | null;
  /** Commentaire que l'élève a laissé sur son propre call de vente. */
  leadComment?: string | null;
  /** Bloc éditable rendu en pied de modale (notes perso de l'élève sur un coaching). */
  editableNotes?: ReactNode;
  /**
   * Calls de vente uniquement : ouvre RapportModal en mode correction. Renseigné quand
   * un rapport existe déjà, pour permettre de corriger un montant mal saisi ou un deal
   * enregistré sur la mauvaise personne — sans ce chemin, un rapport rempli était
   * définitif (voir docs/tracking-prospect.md).
   *
   * La modale reste un flux de LECTURE : elle n'affiche pas de formulaire, elle se
   * contente d'ouvrir celui qui existe déjà.
   */
  onEditRapport?: () => void;
  fathomData: FathomData;
  onClose: () => void;
}

function formatDate(dateStr: string, tz: string) {
  return formatDateIn(new Date(dateStr), tz);
}

// Modale de consultation pure — jamais de formulaire, jamais de soumission. Affiche
// ce qui existe déjà (rapport rempli + infos Fathom) sans jamais réutiliser
// SessionRapportModal/RapportModal, qui sont des flux de saisie, pas de lecture.
export default function CallInfosModal({
  counterpartName, scheduledAt, attended, topic, topicCustom, notes, studentNotes, leadComment, editableNotes, onEditRapport, fathomData, onClose,
}: Props) {
  const { user } = useUser();
  const viewerTz = useViewerTimeZone();
  const topicLabel = topic === 'autre' ? topicCustom : SESSION_TOPICS.find(t => t.value === topic)?.label;
  const hasReport = attended !== undefined && attended !== null;
  const hasAnything = hasReport || !!leadComment || !!editableNotes || !!onEditRapport
    || !!fathomData.shareUrl || !!fathomData.summary || !!fathomData.transcript;

  return (
    <ModalShell onClose={onClose} width={520}>
      <div style={{ padding: '26px 30px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Icon name="phone-call" size={20} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--accent)' }}>
              Infos du call{counterpartName ? ` — ${counterpartName}` : ''}
            </div>
            {scheduledAt && (
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{formatDate(scheduledAt, viewerTz)}</div>
            )}
          </div>
        </div>
        <button onClick={onClose} type="button" className="icon-btn" aria-label="Fermer"><Icon name="x" size={18} /></button>
      </div>

      <div style={{ padding: '26px 30px' }}>
        <FathomRecordingSection
          shareUrl={fathomData.shareUrl}
          summary={fathomData.summary}
          actionItems={fathomData.actionItems}
          transcript={fathomData.transcript}
          callId={fathomData.callId ?? null}
          hasTranscript={fathomData.hasTranscript}
          currentUserEmail={user?.email ?? null}
        />

        {hasReport && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                background: attended === false ? 'var(--red-soft)' : 'var(--green-soft)',
                color: attended === false ? 'var(--red)' : 'var(--green)',
              }}>
                {attended === false ? 'Pas présent' : 'Présent'}
              </span>
              {/* En encre, comme dans la timeline de la fiche élève : le sujet est
                  une information de contenu, pas une métadonnée grise. */}
              {topicLabel && <span style={{ fontSize: 13, color: 'var(--ink)' }}>{topicLabel}</span>}
            </div>
            {notes && (
              <div style={{ marginBottom: 14 }}>
                <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Icon name="lock" size={10} /> Notes privées
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{notes}</div>
              </div>
            )}
            {studentNotes && (
              <div>
                <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Notes élève</div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{studentNotes}</div>
              </div>
            )}
          </div>
        )}

        {/* Hors du bloc hasReport : sur un call de VENTE il n'y a jamais de rapport
            de session, donc le commentaire serait resté invisible. */}
        {leadComment && (
          <div style={{ marginTop: hasReport ? 16 : 0 }}>
            <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Ton commentaire perso</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{leadComment}</div>
          </div>
        )}

        {editableNotes && (
          <div style={{ marginTop: hasReport || leadComment ? 18 : 0, paddingTop: hasReport || leadComment ? 18 : 0, borderTop: hasReport || leadComment ? '1px solid var(--border)' : 'none' }}>
            {editableNotes}
          </div>
        )}

        {!hasAnything && (
          <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>
            Aucune information disponible pour ce call.
          </div>
        )}
      </div>

      <div style={{ padding: '0 30px 26px', display: 'flex', justifyContent: onEditRapport ? 'space-between' : 'flex-end', alignItems: 'center', gap: 12 }}>
        {onEditRapport && (
          <button onClick={onEditRapport} className="btn-ghost" type="button" style={{ fontSize: 13 }}>
            Corriger le rapport
          </button>
        )}
        <button onClick={onClose} className="btn-primary-brand" type="button" style={{ fontSize: 14 }}>Fermer</button>
      </div>
    </ModalShell>
  );
}
