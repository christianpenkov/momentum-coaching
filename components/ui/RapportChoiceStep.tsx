'use client';

import Icon from '@/components/ui/Icon';

/**
 * Une question du rapport de vente : un titre, une aide, une colonne de choix.
 *
 * Les écrans concernés ne sont PAS des copies l'un de l'autre — ce sont des
 * questions différentes. C'est leur habillage qui était rigoureusement identique,
 * recopié quatre fois : titre 22px/800, aide 13px/muted, boutons pleine largeur
 * espacés de 10.
 *
 * Ce qui justifie vraiment l'extraction : l'état SÉLECTIONNÉ. Revenir en arrière
 * dans le rapport doit montrer la réponse déjà donnée, sinon on retombe sur une
 * question qui semble vierge alors qu'on y a répondu. Écrit ici une fois, il vaut
 * pour toutes les questions.
 *
 * Hors périmètre : les écrans `*_found` (qui affichent un créneau détecté et non
 * une liste de choix), les formulaires (montant, paiement, commentaire, date
 * manuelle) et les écrans d'attente ou de confirmation.
 */

export interface RapportChoice<T extends string> {
  value: T;
  label: string;
  /**
   * `primary` : la réponse la plus probable, en bleu plein.
   * `neutral` : une réponse ordinaire, encadrée.
   * `muted`   : une échappatoire (« date pas encore connue ») — présente sans
   *             attirer l'œil.
   * `warning` : une bifurcation qui sort du parcours normal (appel reporté),
   *             signalée en ambre.
   */
  tone?: 'primary' | 'neutral' | 'muted' | 'warning';
}

export default function RapportChoiceStep<T extends string>({
  question,
  hint,
  choices,
  value,
  onChoose,
  disabled,
  children,
}: {
  question: string;
  hint?: string;
  choices: RapportChoice<T>[];
  /** Réponse déjà donnée — surlignée au retour en arrière. */
  value?: T | null;
  onChoose: (value: T) => void;
  disabled?: boolean;
  /** Inséré entre l'aide et les boutons (encadré de détails, avertissement…). */
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>{question}</div>
      {hint && (
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: children ? 8 : 24, lineHeight: 1.6 }}>{hint}</div>
      )}
      {children}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {choices.map(choice => {
          const selected = value != null && value === choice.value;
          // Une réponse a déjà été donnée, mais ce n'est pas celle-ci.
          const otherChosen = value != null && !selected;
          const tone = choice.tone ?? 'neutral';

          // Marquer la sélection par la seule couleur ne suffisait pas : un bouton
          // « primary » est déjà bleu plein qu'il soit choisi ou non, donc revenir
          // en arrière ne montrait rien. La coche tranche sans ambiguïté, et les
          // options écartées s'estompent pour que la réponse retenue ressorte.
          const marque = selected ? <Icon name="check" size={16} style={{ flexShrink: 0 }} /> : null;
          const attenue = otherChosen ? { opacity: 0.45 } : {};

          if (selected) {
            return (
              <button
                key={choice.value}
                type="button"
                className="btn-primary-brand"
                style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                disabled={disabled}
                onClick={() => onChoose(choice.value)}
              >
                {marque}{choice.label}
              </button>
            );
          }

          if (tone === 'primary') {
            return (
              <button
                key={choice.value}
                type="button"
                className="btn-primary-brand"
                style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700, ...attenue }}
                disabled={disabled}
                onClick={() => onChoose(choice.value)}
              >
                {choice.label}
              </button>
            );
          }

          return (
            <button
              key={choice.value}
              type="button"
              className="btn-ghost"
              style={{
                width: '100%',
                padding: '14px',
                fontSize: 14,
                color: tone === 'warning' ? '#d97706' : tone === 'muted' ? 'var(--muted)' : 'var(--accent)',
                border: tone === 'warning' ? '1px solid #fcd34d' : '1px solid var(--border)',
                ...attenue,
              }}
              disabled={disabled}
              onClick={() => onChoose(choice.value)}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
