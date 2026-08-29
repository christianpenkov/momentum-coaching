'use client';

import { useState, useRef, useEffect } from 'react';

// ── Les quatre filtres réglables ──────────────────────────────────────────────
//
// LE RÉGLAGE VIT DANS LE BOUTON. Une ligne de précision séparée obligeait à
// chercher à quel filtre elle se rapportait, et deux filtres ajustables s'y
// gênaient. Ici chaque bouton porte son nom ET sa valeur : « Sans mouvement ·
// plus de 3 sem ».
//
// CUMUL EN UNION, pas en intersection. Deux filtres actifs gardent les leads qui
// entrent dans l'un OU l'autre. L'intersection donnait presque toujours une
// liste vide, sans que rien ne l'explique.
//
// LE GESTE DIFFÈRE SELON L'APPAREIL :
//
//                    │ Ordinateur              │ Téléphone
//   ─────────────────┼─────────────────────────┼──────────────────────
//   clic sur le NOM  │ active / désactive      │ ouvre les réglages
//   clic sur VALEUR  │ ouvre les réglages      │ ouvre les réglages
//   retirer          │ reclic, ou le menu      │ « Retirer ce filtre »
//
// Deux zones cliquables dans un bouton de 32 px sont trop risquées au doigt :
// sur mobile, tout le bouton ouvre le menu, et le retrait passe par une entrée
// explicite. « Retirer ce filtre » existe dans les deux cas.
//
// UN SEUL MENU OUVERT À LA FOIS : en ouvrir un ferme le précédent.

export type FiltreKey = 'sans_mouvement' | 'nb_rdv' | 'rendez_vous' | 'lead_magnets';

export interface EtatFiltre {
  actif: boolean;
  /** Le sens de la comparaison, quand le filtre en propose un. */
  sens?: 'plus' | 'moins';
  /** Le seuil, en jours ou en nombre selon le filtre. */
  seuil?: number;
  /** Précision propre au filtre (état des RDV, réclamés / reçus). */
  variante?: string;
}

export type EtatsFiltres = Record<FiltreKey, EtatFiltre>;

export const FILTRES_VIDES: EtatsFiltres = {
  sans_mouvement: { actif: false, sens: 'plus', seuil: 21 },
  nb_rdv:         { actif: false, seuil: 2, variante: 'tous' },
  rendez_vous:    { actif: false, sens: 'moins', seuil: 7 },
  lead_magnets:   { actif: false, seuil: 2, variante: 'reclames' },
};

const SEUILS_JOURS = [
  { v: 2,  label: '48 h' },
  { v: 3,  label: '3 j' },
  { v: 7,  label: '1 sem' },
  { v: 21, label: '3 sem' },
  { v: 30, label: '1 mois' },
  { v: 60, label: '2 mois' },
  { v: 90, label: '3 mois' },
];

function libelleJours(j: number): string {
  return SEUILS_JOURS.find(s => s.v === j)?.label ?? `${j} j`;
}

/** Ce que le bouton affiche à droite de son nom. */
export function resumeFiltre(key: FiltreKey, e: EtatFiltre): string {
  switch (key) {
    case 'sans_mouvement':
      return `${e.sens === 'moins' ? 'moins de' : 'plus de'} ${libelleJours(e.seuil ?? 21)}`;
    case 'nb_rdv': {
      const n = e.seuil === 0 ? 'aucun' : `${e.seuil} et plus`;
      const v = e.variante === 'manque' ? ', dont un manqué'
        : e.variante === 'honores' ? ', tous honorés' : '';
      return n + v;
    }
    case 'rendez_vous':
      return `il y a ${e.sens === 'moins' ? 'moins de' : 'plus de'} ${libelleJours(e.seuil ?? 7)}`;
    case 'lead_magnets':
      return `${e.seuil} ${e.variante === 'recus' ? 'reçus' : 'réclamés'}`;
  }
}

const NOMS: Record<FiltreKey, string> = {
  sans_mouvement: 'Sans mouvement',
  nb_rdv:         'Nombre de RDV',
  rendez_vous:    'Rendez-vous',
  lead_magnets:   'Lead magnets',
};

/**
 * Les filtres qui ont un sens sur une plateforme SANS lead magnet — YouTube et
 * « Autres ». Un lead YouTube arrive par un lien Calendly en description : il n'a
 * jamais réclamé de lead magnet, et le filtre resterait à zéro pour toujours.
 * Les trois autres sont des faits du lead, valables partout.
 */
export const FILTRES_SANS_LM: readonly FiltreKey[] = ['sans_mouvement', 'nb_rdv', 'rendez_vous'];

interface Props {
  etats: EtatsFiltres;
  /** Les filtres à afficher. Tous par défaut. */
  cles?: readonly FiltreKey[];
  onChange: (key: FiltreKey, e: EtatFiltre) => void;
  /** Le nombre de leads que chaque filtre garderait, seul. */
  comptes: Record<FiltreKey, number>;
  /** Vrai sous 767px : le geste change, voir le tableau en tête de fichier. */
  tactile: boolean;
}

export default function PipelineFilters({ etats, cles, onChange, comptes, tactile }: Props) {
  const [ouvert, setOuvert] = useState<FiltreKey | null>(null);
  const zone = useRef<HTMLDivElement>(null);

  // Fermer au clic dehors et à Échap : sans ça le menu reste ouvert derrière la
  // liste et intercepte les clics suivants.
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => {
      if (zone.current && !zone.current.contains(e.target as Node)) setOuvert(null);
    };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(null); };
    document.addEventListener('mousedown', dehors);
    document.addEventListener('keydown', echap);
    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('keydown', echap);
    };
  }, [ouvert]);

  function basculer(key: FiltreKey) {
    onChange(key, { ...etats[key], actif: !etats[key].actif });
  }
  function regler(key: FiltreKey, patch: Partial<EtatFiltre>) {
    // Régler un filtre l'active : ouvrir son menu pour choisir une valeur puis
    // devoir cliquer ailleurs pour l'allumer serait un pas de trop.
    onChange(key, { ...etats[key], ...patch, actif: true });
  }
  function retirer(key: FiltreKey) {
    onChange(key, { ...etats[key], actif: false });
    setOuvert(null);
  }

  return (
    <div ref={zone} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {(cles ?? (Object.keys(NOMS) as FiltreKey[])).map(key => {
        const e = etats[key];
        const on = e.actif;
        return (
          <div key={key} style={{ position: 'relative' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'stretch', fontSize: 11.5, fontWeight: 600,
              background: on ? 'var(--accent-brand, #3a6a86)' : 'var(--surface)',
              border: `1px solid ${on ? 'var(--accent-brand, #3a6a86)' : 'var(--border)'}`,
              borderRadius: 8, whiteSpace: 'nowrap', overflow: 'hidden',
            }}>
              <button
                type="button"
                onClick={() => (tactile ? setOuvert(o => o === key ? null : key) : basculer(key))}
                aria-pressed={on}
                title={tactile ? undefined : (on ? 'Désactiver ce filtre' : 'Activer ce filtre')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 32,
                  padding: '0 11px', border: 'none', cursor: 'pointer', font: 'inherit',
                  background: 'transparent', color: on ? '#fff' : 'var(--ink-2, #3d3a33)',
                }}
              >
                {NOMS[key]}
                <span style={{
                  fontSize: 10.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  color: on ? 'rgba(255,255,255,.78)' : 'var(--muted)',
                }}>{comptes[key]}</span>
              </button>
              <button
                type="button"
                onClick={() => setOuvert(o => o === key ? null : key)}
                aria-label={`Régler « ${NOMS[key]} »`}
                aria-expanded={ouvert === key}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32,
                  padding: '0 10px 0 9px', cursor: 'pointer', font: 'inherit', fontWeight: 500,
                  background: 'transparent', border: 'none',
                  borderLeft: `1px solid ${on ? 'rgba(255,255,255,.28)' : 'var(--border)'}`,
                  color: on ? '#fff' : 'var(--ink-2, #3d3a33)',
                }}
              >
                {resumeFiltre(key, e)}
                <span style={{ fontSize: 9, opacity: .6 }}>▾</span>
              </button>
            </div>

            {ouvert === key && (
              <Menu
                filtre={key}
                etat={e}
                onRegler={patch => regler(key, patch)}
                onRetirer={() => retirer(key)}
                actif={on}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Menu({
  filtre, etat, onRegler, onRetirer, actif,
}: {
  filtre: FiltreKey; etat: EtatFiltre;
  onRegler: (p: Partial<EtatFiltre>) => void; onRetirer: () => void; actif: boolean;
}) {
  return (
    <div
      role="dialog"
      style={{
        position: 'absolute', top: 'calc(100% + 5px)', left: 0, zIndex: 30,
        minWidth: 232, padding: 10, borderRadius: 12,
        background: 'var(--surface)', border: '1px solid var(--border)',
        boxShadow: '0 8px 28px rgba(0,0,0,.16)',
      }}
    >
      {filtre === 'sans_mouvement' && (
        <>
          <Groupe titre="Depuis">
            <Choix options={[['plus', 'plus de'], ['moins', 'moins de']]}
              valeur={etat.sens ?? 'plus'} onChoix={v => onRegler({ sens: v as 'plus' | 'moins' })} />
          </Groupe>
          <Groupe titre="Combien de temps">
            <Choix options={SEUILS_JOURS.map(s => [String(s.v), s.label] as [string, string])}
              valeur={String(etat.seuil ?? 21)} onChoix={v => onRegler({ seuil: Number(v) })} />
          </Groupe>
        </>
      )}

      {filtre === 'nb_rdv' && (
        <>
          <Groupe titre="Nombre de rendez-vous">
            <Choix options={[['0', 'aucun'], ['1', '1 et plus'], ['2', '2 et plus'], ['3', '3 et plus']]}
              valeur={String(etat.seuil ?? 2)} onChoix={v => onRegler({ seuil: Number(v) })} />
          </Groupe>
          {etat.seuil !== 0 && (
            <Groupe titre="Comment ils se sont passés">
              <Choix options={[['tous', 'tous'], ['manque', 'dont un manqué'], ['honores', 'tous honorés']]}
                valeur={etat.variante ?? 'tous'} onChoix={v => onRegler({ variante: v })} />
            </Groupe>
          )}
        </>
      )}

      {filtre === 'rendez_vous' && (
        <>
          {/* Uniquement les rendez-vous PASSÉS : ceux à venir sont déjà dans
              l'étape « RDV pris », les filtrer une seconde fois n'apprendrait
              rien de plus. */}
          <Groupe titre="Dernier rendez-vous passé">
            <Choix options={[['plus', 'il y a plus de'], ['moins', 'il y a moins de']]}
              valeur={etat.sens ?? 'moins'} onChoix={v => onRegler({ sens: v as 'plus' | 'moins' })} />
          </Groupe>
          <Groupe titre="Quand">
            <Choix options={SEUILS_JOURS.map(s => [String(s.v), s.label] as [string, string])}
              valeur={String(etat.seuil ?? 7)} onChoix={v => onRegler({ seuil: Number(v) })} />
          </Groupe>
        </>
      )}

      {filtre === 'lead_magnets' && (
        <>
          {/* Réclamés ≠ reçus. Réclamé = il a commenté le mot-clé. Reçu = il a en
              plus cliqué le bouton du DM1 pour obtenir le lien. L'écart entre les
              deux mesure la qualité du DM1 — c'est tout l'intérêt du filtre. */}
          <Groupe titre="Réclamés ou reçus">
            <Choix options={[['reclames', 'réclamés'], ['recus', 'reçus']]}
              valeur={etat.variante ?? 'reclames'} onChoix={v => onRegler({ variante: v })} />
          </Groupe>
          <Groupe titre="À partir de">
            <Choix options={[['1', '1'], ['2', '2'], ['3', '3'], ['4', '4 et plus']]}
              valeur={String(etat.seuil ?? 2)} onChoix={v => onRegler({ seuil: Number(v) })} />
          </Groupe>
        </>
      )}

      {actif && (
        <button
          type="button"
          onClick={onRetirer}
          style={{
            width: '100%', marginTop: 4, minHeight: 34, borderRadius: 8,
            fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
            border: '1px solid var(--border)', background: 'var(--surface-2, #f7f4ec)',
            color: 'var(--muted)',
          }}
        >
          Retirer ce filtre
        </button>
      )}
    </div>
  );
}

function Groupe({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
        color: 'var(--muted)', marginBottom: 5, paddingLeft: 2,
      }}>{titre}</div>
      {children}
    </div>
  );
}

function Choix({
  options, valeur, onChoix,
}: { options: [string, string][]; valeur: string; onChoix: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map(([v, label]) => {
        const on = v === valeur;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChoix(v)}
            aria-pressed={on}
            style={{
              minHeight: 30, padding: '0 10px', borderRadius: 7, cursor: 'pointer',
              // `font: 'inherit'` retiré : il effaçait la taille et la graisse
              // déclarées juste avant. La famille est héritée globalement.
              fontSize: 11.5, fontWeight: 600,
              border: `1px solid ${on ? 'var(--accent-brand, #3a6a86)' : 'var(--border)'}`,
              background: on ? 'var(--accent-brand, #3a6a86)' : 'var(--surface)',
              color: on ? '#fff' : 'var(--ink-2, #3d3a33)',
            }}
          >{label}</button>
        );
      })}
    </div>
  );
}
