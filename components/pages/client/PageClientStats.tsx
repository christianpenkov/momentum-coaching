'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';

const AreaChart = dynamic(() => import('@/components/charts/AreaChart'), { ssr: false });

interface StripeData {
  mrr: number;
  monthlyRevenue: number;
  activeSubscriptions: number;
  availableBalance: number;
  recentPayments: {
    id: string;
    amount: number;
    currency: string;
    description: string;
    date: string;
    status: string;
  }[];
}

function KpiCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 11, marginTop: 4, color: positive === false ? 'var(--red)' : positive ? 'var(--green)' : 'var(--muted)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export default function PageClientStats() {
  const [stripeData, setStripeData] = useState<StripeData | null>(null);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [hasStripeKey, setHasStripeKey] = useState<boolean | null>(null);

  useEffect(() => {
    async function load() {
      // Vérifie si la clé Stripe est configurée
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: integ } = await supabase
        .from('integrations')
        .select('id')
        .eq('profile_id', user.id)
        .eq('provider', 'stripe')
        .single();

      if (!integ) {
        setHasStripeKey(false);
        setStripeLoading(false);
        return;
      }

      setHasStripeKey(true);

      try {
        const res = await fetch('/api/stripe/client-data');
        if (res.ok) {
          const data = await res.json();
          setStripeData(data);
        } else {
          const err = await res.json().catch(() => ({}));
          setStripeError(err.error || 'Erreur lors du chargement des données Stripe');
        }
      } catch {
        setStripeError('Impossible de contacter Stripe');
      } finally {
        setStripeLoading(false);
      }
    }
    load();
  }, []);

  // Prépare les données pour le graphique MRR (historique paiements par mois)
  const chartData = stripeData?.recentPayments
    ? Object.entries(
        stripeData.recentPayments.reduce((acc, p) => {
          const month = new Date(p.date).toLocaleDateString('fr-FR', { month: 'short' });
          acc[month] = (acc[month] || 0) + p.amount;
          return acc;
        }, {} as Record<string, number>)
      )
        .slice(-6)
        .map(([month, amount]) => ({ month, amount }))
    : [];

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mes stats</h1>
          <p className="page-sub">Données en temps réel depuis tes intégrations</p>
        </div>
      </div>

      {/* Section Stripe */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="stripe" size={18} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Revenus Stripe</span>
          </div>
          {stripeData && (
            <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon name="refresh-cw" size={11} /> Mis à jour à l'instant
            </span>
          )}
        </div>

        {stripeLoading ? (
          <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            <Icon name="refresh-cw" size={16} /> Chargement des données Stripe…
          </div>
        ) : !hasStripeKey ? (
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>💳</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Stripe non connecté</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
              Ajoute ta clé Stripe dans Réglages pour voir ton MRR, tes paiements et tes abonnements en temps réel.
            </div>
            <a href="/espace/settings" className="btn-primary" style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="link" size={13} /> Connecter Stripe
            </a>
          </div>
        ) : stripeError ? (
          <div className="card" style={{ padding: '24px', background: '#fef2f2', border: '1px solid #fca5a5' }}>
            <div style={{ fontSize: 13, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="shield" size={14} />
              <div>
                <div style={{ fontWeight: 600 }}>Erreur Stripe</div>
                <div style={{ fontSize: 12, marginTop: 2 }}>{stripeError}</div>
                <a href="/espace/settings" style={{ fontSize: 12, color: '#dc2626', marginTop: 6, display: 'inline-block' }}>
                  Vérifier la clé dans Réglages →
                </a>
              </div>
            </div>
          </div>
        ) : stripeData ? (
          <>
            {/* KPIs */}
            <div className="grid-4" style={{ marginBottom: 20 }}>
              <KpiCard
                label="MRR"
                value={`${stripeData.mrr.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`}
                sub="Revenus mensuels récurrents"
              />
              <KpiCard
                label="Ce mois"
                value={`${stripeData.monthlyRevenue.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`}
                sub="Encaissé ce mois"
                positive={stripeData.monthlyRevenue > 0}
              />
              <KpiCard
                label="Abonnements actifs"
                value={String(stripeData.activeSubscriptions)}
                sub={stripeData.activeSubscriptions === 0 ? 'Aucun abonnement actif' : 'Clients actifs'}
                positive={stripeData.activeSubscriptions > 0}
              />
              <KpiCard
                label="Solde disponible"
                value={`${stripeData.availableBalance.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`}
                sub="Prêt à virer"
                positive={stripeData.availableBalance > 0}
              />
            </div>

            {/* Graphique paiements récents */}
            {chartData.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-head">
                  <div className="card-title">Revenus par mois</div>
                  <div className="card-sub">Basé sur tes paiements récents</div>
                </div>
                <AreaChart
                  data={chartData}
                  areas={[{ key: 'amount', label: 'Revenus', color: 'var(--green)' }]}
                  xKey="month"
                  height={180}
                  formatter={(n) => `${n.toLocaleString('fr-FR')} €`}
                />
              </div>
            )}

            {/* Derniers paiements */}
            {stripeData.recentPayments.length > 0 && (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div className="card-title">Derniers paiements</div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th>Montant</th>
                        <th>Date</th>
                        <th>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stripeData.recentPayments.map(p => (
                        <tr key={p.id}>
                          <td style={{ fontSize: 13, color: 'var(--accent)' }}>{p.description}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>
                            {p.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {p.currency.toUpperCase()}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                            {new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </td>
                          <td>
                            <span className={`pill pill-${p.status === 'succeeded' ? 'green' : 'amber'}`} style={{ fontSize: 11 }}>
                              {p.status === 'succeeded' ? 'Réussi' : p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Placeholder autres intégrations */}
      <div className="card" style={{ padding: '24px', textAlign: 'center', border: '1px dashed var(--border)', background: 'transparent' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          📊 Stats Instagram, YouTube et Calendly arrivent prochainement.<br />
          Connecte tes comptes dans <a href="/espace/settings" style={{ color: 'var(--accent)' }}>Réglages</a> pour les activer.
        </div>
      </div>
    </div>
  );
}
