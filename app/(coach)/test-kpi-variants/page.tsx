'use client';

// Page de test temporaire — 5 variantes de carte KPI "Leads" avec métrique secondaire
// (nouveaux prospects), inspirées de patterns réels utilisés par Stripe, Linear,
// HubSpot, Mixpanel. À supprimer après validation.

const BLUE = '#6b7cde';
const GREEN = '#3f8a52';
const total = 5;
const nouveaux = 3;

function CardShell({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  // Largeur figée à la vraie taille d'une carte dans la grille "repeat(5, 1fr)"
  // du bloc KPI réel (page.title ~1120px de large, gap:10 → ~208px par carte).
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', width: 208 }}>
      <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8 }}>
        <span>{label}</span>
        {sub && <span style={{ fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

export default function TestKpiVariants() {
  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Test — Variantes carte Leads</h1>
          <p className="page-sub">5 variantes réelles inspirées de Stripe / Linear / HubSpot / Mixpanel — page temporaire</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* 1. Stripe-style : trend badge à côté du chiffre, flèche + delta coloré */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>1. Stripe — trend badge (flèche + delta)</div>
          <CardShell label="Leads" sub="7j">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: BLUE, lineHeight: 1 }}>{total}</div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: GREEN }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
                {nouveaux} nouveaux
              </span>
            </div>
          </CardShell>
        </div>

        {/* 2. Linear-style : pill/tag arrondi avec fond léger */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>2. Linear — pill tag fond léger</div>
          <CardShell label="Leads" sub="7j">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: BLUE, lineHeight: 1 }}>{total}</div>
              <span style={{
                fontSize: 10, fontWeight: 700, color: GREEN, background: 'color-mix(in srgb, var(--green) 14%, transparent)',
                borderRadius: 20, padding: '2px 7px', lineHeight: 1.4, whiteSpace: 'nowrap',
              }}>
                +{nouveaux} nouveaux
              </span>
            </div>
          </CardShell>
        </div>

        {/* 3. HubSpot-style : fraction "X / Y" avec label sous chaque partie */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>3. HubSpot — deux blocs séparés par une barre (comme Publications)</div>
          <CardShell label="Leads" sub="7j">
            <div style={{ fontSize: 20, fontWeight: 800, color: BLUE, lineHeight: 1, marginBottom: 8 }}>{total}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{nouveaux}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>nouveaux</span>
              </div>
              <div style={{ width: 1, height: 12, background: 'var(--border)', flexShrink: 0 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--faint)', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{total - nouveaux}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>connus</span>
              </div>
            </div>
          </CardShell>
        </div>

        {/* 4. Mixpanel-style : gros chiffre + petit chiffre en exposant à droite, style "compteur ratio" */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>4. Mixpanel — ratio discret aligné à droite de la carte</div>
          <CardShell label="Leads" sub="7j">
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: BLUE, lineHeight: 1 }}>{total}</div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, lineHeight: 1 }}>{nouveaux}</div>
                <div style={{ fontSize: 9, color: 'var(--faint)', marginTop: 2 }}>nouveaux</div>
              </div>
            </div>
          </CardShell>
        </div>

        {/* 5. Amplitude-style : anneau de progression mini (donut) à droite du chiffre */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>5. Amplitude — mini donut proportion nouveaux/total</div>
          <CardShell label="Leads" sub="7j">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: BLUE, lineHeight: 1 }}>{total}</div>
              <div style={{ position: 'relative', width: 34, height: 34 }}>
                <svg width="34" height="34" viewBox="0 0 34 34">
                  <circle cx="17" cy="17" r="14" fill="none" stroke="var(--border)" strokeWidth="4" />
                  <circle
                    cx="17" cy="17" r="14" fill="none" stroke={GREEN} strokeWidth="4"
                    strokeDasharray={`${(nouveaux / total) * 2 * Math.PI * 14} ${2 * Math.PI * 14}`}
                    strokeLinecap="round"
                    transform="rotate(-90 17 17)"
                  />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: GREEN }}>
                  {nouveaux}
                </div>
              </div>
            </div>
          </CardShell>
        </div>

      </div>
    </div>
  );
}
