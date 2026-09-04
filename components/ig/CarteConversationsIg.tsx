'use client';

import { useEffect, useState } from 'react';
import { createClient as createSupabase } from '@/lib/supabase/client';
import { useIsMobile } from '@/lib/useIsMobile';
import ModaleConversationsIg from '@/components/ig/ModaleConversationsIg';

/**
 * La carte « Conversations Instagram » de la fiche client.
 *
 * ⚠️ SA HAUTEUR NE DÉPEND D'AUCUNE DONNÉE. Trois chiffres et un bouton, jamais
 * une liste : 3 conversations ou 300, la fiche gagne les mêmes ~140 px, une fois,
 * pour toujours. Toute la croissance vit dans la modale, qui défile pour son
 * compte. C'est le principe qui règle « ça prend de plus en plus de place ».
 *
 * ⚠️ Sur mobile, la carte reste, le bouton non. La fiche client s'ouvre sur
 * téléphone — trois chiffres y tiennent parfaitement — mais un fil annotable ne
 * tient pas sur 390 px. Masquer la carte ferait croire à un coach mobile que la
 * fonctionnalité n'existe pas.
 *
 * ⚠️ Rien n'est rendu tant que l'élève n'a pas accordé la lecture : dans ce cas
 * la vue ne rend aucune ligne, et aucun message n'est stocké non plus.
 *
 * ⚠️ Une seule requête, à l'ouverture de la fiche. Aucun Realtime, aucun
 * minuteur — le Realtime pesait 45 % de l'egress Supabase récemment.
 */

type Resume = {
  fils: number;
  actifsSemaine: number;
  attendent: number;
  dernier: string | null;
  dernierPseudo: string | null;
};

export default function CarteConversationsIg({ profileId, prenomEleve }: {
  profileId: string;
  prenomEleve: string;
}) {
  const [resume, setResume] = useState<Resume | null>(null);
  const [ouverte, setOuverte] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    let vivant = true;
    const supabase = createSupabase();
    supabase
      .from('ig_conversations_visibles')
      .select('last_message_at, attend_reponse, peer_username')
      .eq('profile_id', profileId)
      .order('last_message_at', { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!vivant || !data) return;
        const semaine = Date.now() - 7 * 24 * 3600 * 1000;
        setResume({
          fils: data.length,
          actifsSemaine: data.filter(d => new Date(d.last_message_at).getTime() > semaine).length,
          attendent: data.filter(d => d.attend_reponse).length,
          dernier: data[0]?.last_message_at ?? null,
          dernierPseudo: data[0]?.peer_username ?? null,
        });
      });
    return () => { vivant = false; };
  }, [profileId]);

  // Pas d'accord, ou aucun fil de prospect : rien à montrer, et surtout rien à
  // expliquer. Une carte vide poserait une question à laquelle le coach ne peut
  // pas répondre — c'est l'élève qui décide.
  if (!resume || resume.fils === 0) return null;

  return (
    <>
      <div className="card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 14 }}>
            {/* Le glyphe officiel, repris de components/ui/Icon.tsx — pas un carré
                dégradé fabriqué à la main, qui se remarque immédiatement. */}
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                 style={{ flexShrink: 0 }}>
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" />
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
            </svg>
            Conversations Instagram
          </div>
          {resume.attendent > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: '#fff', background: 'var(--accent-brand)',
              padding: '2px 8px', borderRadius: 999, fontVariantNumeric: 'tabular-nums', flexShrink: 0,
            }}>
              {resume.attendent} en attente
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 22, flexWrap: 'wrap' }}>
          <Chiffre valeur={resume.fils} libelle={`fil${resume.fils > 1 ? 's' : ''} suivi${resume.fils > 1 ? 's' : ''}`} />
          <Chiffre valeur={resume.actifsSemaine} libelle="actifs cette semaine" />
          {/* « attendent une réponse » = le prospect a écrit APRÈS le dernier
              message de l'élève. C'est le seul signal d'urgence de l'écran. */}
          <Chiffre valeur={resume.attendent} libelle="attendent une réponse" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>
            {resume.dernier
              ? `Dernier échange ${ilYA(resume.dernier)}${resume.dernierPseudo ? ` · @${resume.dernierPseudo}` : ''}`
              : '—'}
          </span>
          {isMobile ? (
            <span style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0 }}>
              Consultation sur ordinateur
            </span>
          ) : (
            <button type="button" className="btn-primary" style={{ fontSize: 12.5, flexShrink: 0 }}
                    onClick={() => setOuverte(true)}>
              Ouvrir
            </button>
          )}
        </div>
      </div>

      {ouverte && !isMobile && (
        <ModaleConversationsIg
          profileId={profileId}
          prenomEleve={prenomEleve}
          annotable
          onClose={() => setOuverte(false)}
        />
      )}
    </>
  );
}

function Chiffre({ valeur, libelle }: { valeur: number; libelle: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <b style={{
        fontFamily: 'var(--font-display, inherit)', fontSize: 21, fontWeight: 700,
        letterSpacing: '-.4px', fontVariantNumeric: 'tabular-nums',
      }}>{valeur}</b>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{libelle}</span>
    </div>
  );
}

function ilYA(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `il y a ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  const j = Math.round(s / 86400);
  return j < 30 ? `il y a ${j} j` : `le ${new Date(iso).toLocaleDateString('fr-FR')}`;
}
