'use client';

import { getPeriodWindow } from '@/lib/period';

/* Sélecteur de période partagé — extrait de PageClientStats.tsx le 2026-09-01, quand
 * Stats Clients (page coach, portefeuille entier) en a eu besoin à son tour.
 *
 * ⚠️ Il vit ici pour n'exister QU'UNE FOIS. Deux copies d'un sélecteur de période
 * divergent dès que l'une bouge, et le projet a déjà payé ce prix : les onze écarts
 * entre écrans du 2026-08-19 venaient tous d'une règle de périmètre recopiée.
 *
 * Les bornes viennent de `lib/period.ts`, donc elles sont CALENDAIRES — semaine
 * lundi-dimanche, ou mois entier. Ce n'est pas un détail d'affichage : c'est la
 * garantie sur laquelle repose `degrossir_historiques_analytics()` (voir AGENTS.md).
 * Une fenêtre glissante invaliderait la rétention, et la perte serait silencieuse.
 */

export type Period = 7 | 30;
// TODO (chantier futur, voir plan) : passer Period en granularité calendaire
// (semaine lundi-dimanche / mois calendaire) via lib/period.ts. Reporté après
// découverte que 15+ sites font de l'arithmétique littérale avec 7/30 (pas
// seulement des libellés) — refactor plus large que prévu, à faire dans une
// session dédiée avec le vrai périmètre connu dès le départ.
export function periodLabel(period: number, index: number): string {
  // Bornes calendaires réelles (semaine lundi-dimanche si period=7, mois calendaire
  // sinon) via lib/period.ts — même source que tous les autres calculateurs de bornes
  // du fichier, élimine la classe de bug "décalage d'un jour entre deux endroits".
  const { periodStart, periodEnd } = getPeriodWindow(index, period === 7 ? 'week' : 'month');
  // timeZone Europe/Paris (pas UTC) : periodStart/periodEnd (getPeriodWindow) sont des
  // instants UTC correspondant à minuit/23:59:59.999 heure de Paris, pas minuit UTC —
  // les lire en UTC affichait un jour "trop tôt" (ex: "30 juin" au lieu de "1 juil").
  // Pas d'annee ici : ce libelle borne la periode SELECTIONNEE (« 1 août – 31 août »),
  // toujours proche du present. L'annee n'apporte rien et alourdit le bandeau.
  // Elle n'a de sens que sur les dates de publication, qui peuvent remonter a plusieurs
  // annees.
  const fmt2 = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
  return `${fmt2(periodStart)} – ${fmt2(periodEnd)}`;
}

// ── Pill période flottante (onglet Funnel & Calls) ────────────────────────────
export default function PeriodPill({ period, setPeriod, periodIndex, setPeriodIndex, connectedAt, allTimeStart, sinceConnection, setSinceConnection }: {
  period: Period; setPeriod: (p: Period) => void;
  periodIndex: number; setPeriodIndex: (fn: (i: number) => number) => void;
  connectedAt?: string | null;
  /** Début RÉEL de la fenêtre All-Time (integrations_ready_at). Borne AUSSI la
   *  navigation arrière depuis le 2026-08-31 — voir maxIndex ci-dessous. */
  allTimeStart?: string | null;
  sinceConnection?: boolean; setSinceConnection?: (v: boolean) => void;
}) {
  // Jusqu'où la flèche « ‹ » peut reculer. Deux corrections en une, le 2026-08-31 :
  //
  // - la référence était `connectedAt` — la plus ancienne connexion IG/YT, 29/05 sur le
  //   profil de test — au lieu de `integrations_ready_at`, 09/06. C'est la règle 1 du
  //   référentiel de périmètre : la date de démarrage, jamais une autre. L'écart rendait
  //   MAI atteignable, un mois entièrement antérieur à la mise en route, où le bandeau de
  //   couverture annonçait « les 39 premiers jours » d'un mois qui en compte 31 ;
  // - le calcul comptait des périodes GLISSANTES de `period` jours, alors que les périodes
  //   affichées sont des semaines et des mois CALENDAIRES (lib/period.ts). Les deux ne
  //   coïncident pas, et selon le jour du mois l'écart laissait passer une période de trop.
  //   Corriger la seule date sans corriger le grain aurait reproduit le défaut ailleurs.
  //
  // On compare donc la vraie fenêtre calendaire à la date de démarrage : une période reste
  // atteignable tant qu'elle se termine après. Le cas « période entièrement antérieure »
  // devient inatteignable par construction, plutôt que rattrapé par un texte.
  const debutMesure = allTimeStart ?? connectedAt;
  const maxIndex = (() => {
    if (!debutMesure) return 12;
    const plancher = new Date(debutMesure).getTime();
    const grain = period === 7 ? 'week' : 'month';
    let i = 0;
    // Garde-fou de boucle : 120 périodes, soit 10 ans de mois ou 2 ans de semaines.
    while (i < 120 && getPeriodWindow(i + 1, grain).periodEnd.getTime() >= plancher) i++;
    return i;
  })();
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '5px 10px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        userSelect: 'none', WebkitUserSelect: 'none',
      } as React.CSSProperties}
    >
      <button onClick={() => setPeriodIndex(i => Math.min(i + 1, maxIndex))} disabled={sinceConnection || periodIndex >= maxIndex}
        style={{ background: 'none', border: 'none', cursor: (sinceConnection || periodIndex >= maxIndex) ? 'default' : 'pointer', fontSize: 20, color: (sinceConnection || periodIndex >= maxIndex) ? 'var(--faint)' : 'var(--ink)', padding: '0 4px', lineHeight: 1 }}>‹</button>
      <div style={{ textAlign: 'center', minWidth: 120 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
          {/* « All-Time » plutôt que « Depuis connexion » : le nom du mode côté
              utilisateur. La fenêtre est [integrations_ready_at, aujourd'hui] —
              le jour où le pipeline Momentum de l'élève est devenu opérationnel. */}
          {sinceConnection ? 'All-Time' : (periodIndex === 0 ? 'Période actuelle' : `${period === 7 ? 'S' : 'M'}−${periodIndex}`)}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{sinceConnection ? ((allTimeStart ?? connectedAt) ? `depuis le ${new Date((allTimeStart ?? connectedAt)!).toLocaleDateString('fr-FR')}` : '') : periodLabel(period, periodIndex)}</div>
      </div>
      <button onClick={() => setPeriodIndex(i => Math.max(i - 1, 0))} disabled={sinceConnection || periodIndex === 0}
        style={{ background: 'none', border: 'none', cursor: (sinceConnection || periodIndex === 0) ? 'default' : 'pointer', fontSize: 20, color: (sinceConnection || periodIndex === 0) ? 'var(--faint)' : 'var(--ink)', padding: '0 4px', lineHeight: 1 }}>›</button>
      <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 4px' }} />
      <div style={{ display: 'flex', gap: 2, background: 'var(--surface-chat-field)', borderRadius: 8, padding: 3 }}>
        {([7, 30] as Period[]).map(p => (
          <button key={p} onClick={() => { setSinceConnection?.(false); setPeriod(p); setPeriodIndex(() => 0); }} style={{
            padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none',
            background: !sinceConnection && period === p ? 'var(--ink)' : 'transparent',
            color: !sinceConnection && period === p ? 'var(--surface)' : 'var(--muted)',
            transition: 'all .15s',
          }}>{p}j</button>
        ))}
        {setSinceConnection && (
          <button
            key="since-connection"
            onClick={() => connectedAt && setSinceConnection(true)}
            disabled={!connectedAt}
            title={!connectedAt ? "Date de connexion inconnue" : undefined}
            style={{
              padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none',
              cursor: connectedAt ? 'pointer' : 'not-allowed',
              background: sinceConnection ? 'var(--ink)' : 'transparent',
              color: !connectedAt ? 'var(--faint)' : (sinceConnection ? 'var(--surface)' : 'var(--muted)'),
              transition: 'all .15s', whiteSpace: 'nowrap',
            }}>All-Time</button>
        )}
      </div>
    </div>
  );
}
