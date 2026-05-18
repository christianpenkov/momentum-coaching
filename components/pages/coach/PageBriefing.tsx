'use client';

import Link from 'next/link';
import Avatar from '@/components/ui/Avatar';
import Pill from '@/components/ui/Pill';
import Icon from '@/components/ui/Icon';
import { getClient } from '@/lib/data';

interface Props { id: string }

const QUESTIONS_TEMPLATE = [
  'Comment as-tu progressé sur ton objectif principal depuis notre dernier call ?',
  'Quels ont été tes 3 meilleurs posts cette semaine en termes d\'engagement ?',
  'Tu as envoyé {dms} DM — quels retours as-tu eus ?',
  'Est-ce qu\'il y a un obstacle spécifique qui t\'a bloqué cette semaine ?',
  'Qu\'est-ce que tu veux absolument accomplir avant notre prochain call ?',
];

export default function PageBriefing({ id }: Props) {
  const client = getClient(id);
  if (!client) return null;

  const last = client.weeklyHistory[11];
  const prev = client.weeklyHistory[10];
  const followerDelta = last.followersIG - prev.followersIG;
  const mrrDelta = last.stripeMRR - prev.stripeMRR;

  const aiSummary = `${client.name} est en semaine ${client.week}. Son audience IG est passée de ${prev.followersIG.toLocaleString('fr-FR')} à ${last.followersIG.toLocaleString('fr-FR')} abonnés (${followerDelta >= 0 ? '+' : ''}${followerDelta}). Il a publié ${last.postsCount} posts avec ${last.avgViews.toLocaleString('fr-FR')} vues en moyenne, et envoyé ${last.dmsSent} DM (${last.dmsReplyRate}% de réponses). Son MRR est de ${last.stripeMRR.toLocaleString('fr-FR')} € (${mrrDelta >= 0 ? '+' : ''}${mrrDelta} € vs semaine précédente).`;

  const focus = last.postsCount < 3
    ? 'Fréquence de publication très basse — explorer les blocages créatifs'
    : last.dmsReplyRate < 15
    ? 'Taux de réponse DM faible — revoir le script de prospection'
    : followerDelta < 0
    ? 'Perte de followers — analyser le contenu récent et l\'engagement'
    : 'Maintenir la dynamique de croissance et augmenter le closing DM';

  return (
    <div className="page-content">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar initials={client.initials} size={42} />
          <div>
            <h1 className="page-title">Briefing IA — {client.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Semaine {client.week} · {client.niche}</span>
              <Pill status={client.status as 'green' | 'amber' | 'red'} label={client.statusText} size="sm" />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href={`/clients/${id}`} className="btn-ghost">
            ← Fiche
          </Link>
          <button className="btn-primary" type="button" onClick={() => window.open('https://calendly.com/app/scheduled_events/upcoming', '_blank')}>
            <Icon name="mic" size={14} /> Lancer le call
          </button>
        </div>
      </div>

      {/* Badge IA */}
      <div className="ai-badge" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'linear-gradient(135deg, #f0ede8, #faf8f4)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 24, fontSize: 12, color: 'var(--muted)' }}>
        <Icon name="sparkle" size={14} />
        <span>Briefing généré par IA · basé sur les données des 12 dernières semaines · mise à jour automatique avant chaque call</span>
      </div>

      <div className="grid-2">
        {/* TL;DR */}
        <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
          <div className="card-head">
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="zap" size={15} /> TL;DR
            </div>
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--accent)', marginTop: 12 }}>
            {aiSummary}
          </p>
          {client.suspens && client.suspens.length > 0 && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, borderLeft: '3px solid var(--amber)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--amber)', marginBottom: 6 }}>Points en suspens du dernier call</div>
              {client.suspens.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 3 }}>· {s.label}</div>
              ))}
            </div>
          )}
        </div>

        {/* Métriques clés */}
        <div className="card">
          <div className="card-head">
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="activity" size={15} /> Métriques semaine {client.week}
            </div>
          </div>
          <div className="metric-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
            {[
              { label: 'Followers IG', value: last.followersIG.toLocaleString('fr-FR'), delta: `+${followerDelta}`, positive: followerDelta >= 0 },
              { label: 'YouTube', value: last.followersYT.toLocaleString('fr-FR'), delta: `+${last.followersYT - prev.followersYT}`, positive: true },
              { label: 'Taux de closing', value: `${last.closingRate}%`, delta: last.closingRate > 20 ? 'Bon' : 'À améliorer', positive: last.closingRate > 20 },
              { label: 'Taux no-show', value: `${last.noShowRate}%`, delta: last.noShowRate < 15 ? 'OK' : 'Élevé', positive: last.noShowRate < 15 },
              { label: 'Rétention vidéo', value: `${last.videoRetention}%`, delta: last.videoRetention > 40 ? 'Bon' : 'À améliorer', positive: last.videoRetention > 40 },
              { label: 'CTR lien bio', value: `${last.ctrBioLink}%`, delta: 'Short.io', positive: last.ctrBioLink > 2 },
              { label: 'DM envoyés', value: last.dmsSent.toString(), delta: `${last.dmsReplyRate}% réponse`, positive: last.dmsReplyRate > 15 },
              { label: 'MRR Stripe', value: `${last.stripeMRR.toLocaleString('fr-FR')} €`, delta: `${mrrDelta >= 0 ? '+' : ''}${mrrDelta} €`, positive: mrrDelta >= 0 },
            ].map(({ label, value, delta, positive }) => (
              <div key={label} style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{value}</div>
                {delta && (
                  <div style={{ fontSize: 11, marginTop: 2, color: positive === undefined ? 'var(--muted)' : positive ? 'var(--green)' : 'var(--red)' }}>
                    {delta}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Focus + Questions */}
      <div className="grid-2" style={{ marginTop: 24 }}>
        <div className="card" style={{ borderLeft: '3px solid var(--amber)' }}>
          <div className="card-head">
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="target" size={15} /> Focus de ce call
            </div>
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--accent)', marginTop: 12 }}>
            {focus}
          </p>
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>OBJECTIFS DU CALL</div>
            {[
              'Valider les tâches de la semaine (plan)',
              'Identifier le principal frein actuel',
              'Définir 3 actions pour la semaine prochaine',
            ].map((obj, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, border: '1.5px solid var(--border)', flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--accent)' }}>{obj}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="message-circle" size={15} /> Questions suggérées
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name="sparkle" size={11} /> IA
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {QUESTIONS_TEMPLATE.map((q, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)', minWidth: 18, marginTop: 2 }}>Q{i + 1}</span>
                <span style={{ fontSize: 12, color: 'var(--accent)', lineHeight: 1.5 }}>
                  {q.replace('{dms}', last.dmsSent.toString())}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
