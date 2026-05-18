'use client';

import Icon from '@/components/ui/Icon';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';

export default function PageAnalytics() {
  const { clients, loading } = useSupabaseClients();

  if (loading) {
    return (
      <div className="page-content">
        <div className="page-header"><h1 className="page-title">Analytics</h1></div>
        <div style={{ color: 'var(--muted)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
          <Icon name="refresh-cw" size={16} /> Chargement…
        </div>
      </div>
    );
  }

  const totalMRR = clients.reduce((sum, c) => sum + (c.latestMetrics?.stripe_mrr || 0), 0);
  const activeClients = clients.filter(c => c.status === 'green').length;

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'MRR total', value: `${totalMRR.toLocaleString('fr-FR')} €` },
          { label: 'Clients actifs', value: String(clients.length) },
          { label: 'En vert', value: String(activeClients) },
          { label: 'Semaine moyenne', value: clients.length > 0 ? `S${Math.round(clients.reduce((s, c) => s + c.week, 0) / clients.length)}` : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="card">
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{label}</div>
            <div className="kpi-value">{value}</div>
          </div>
        ))}
      </div>

      {clients.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
          Les graphiques apparaîtront ici une fois que tes clients auront des métriques enregistrées.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Semaine</th>
                <th>MRR</th>
                <th>Followers IG</th>
                <th>Followers YT</th>
                <th>Closing</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>S{c.week}</td>
                  <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{(c.latestMetrics?.stripe_mrr || 0).toLocaleString('fr-FR')} €</td>
                  <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{(c.latestMetrics?.followers_ig || 0).toLocaleString('fr-FR')}</td>
                  <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{(c.latestMetrics?.followers_yt || 0).toLocaleString('fr-FR')}</td>
                  <td style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{c.latestMetrics?.closing_rate || 0}%</td>
                  <td>
                    <span className={`pill pill-${c.status}`} style={{ fontSize: 11 }}>
                      {c.status === 'green' ? 'Vert' : c.status === 'amber' ? 'Vigilance' : 'Alerte'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
