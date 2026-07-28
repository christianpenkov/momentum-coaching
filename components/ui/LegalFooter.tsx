export default function LegalFooter() {
  return (
    <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.6 }}>
      © 2026 Momentum — Une solution technologique éditée par UbizenAI (Christian PENKOV).<br />
      SIREN : 988 924 627 | Siège social : 21 Rue de l'Oisans, 38400 Saint-Martin-d'Hères, France.<br />
      <a href="https://ubizenai.com/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>Politique de Confidentialité</a>
      {' | '}
      <a href="https://ubizenai.com/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>Conditions d'Utilisation</a>
      {' | '}
      <a href="https://ubizenai.com/data-deletion.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>Suppression des données</a>
    </p>
  );
}
