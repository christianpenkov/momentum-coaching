// Libelles des echecs de connexion OAuth, partages par les deux pages Reglages.
//
// Les callbacks redirigent avec `?error=<code>`. Les deux pages affichaient ce code
// brut — « Erreur de connexion (instagram_jeton_inerte) » — ce qui ne dit rien a un
// eleve et ne dit pas non plus quoi faire. Chaque code a maintenant une phrase qui
// nomme la cause ET l'action.

const FOURNISSEURS: Record<string, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  google: 'Google',
  calendly: 'Calendly',
  fathom: 'Fathom',
  stripe: 'Stripe',
};

// Messages propres a un code precis. Tout ce qui n'est pas ici retombe sur le
// libelle generique construit a partir du suffixe (_denied, _state, _token...).
const MESSAGES: Record<string, string> = {
  // Meta emet un jeton et annonce les permissions accordees meme quand l'app n'a aucun
  // acces reel au compte : tous les appels echouent ensuite, /me compris. Deux causes
  // cote tableau de bord Meta — un compte sans role dans une app encore en mode
  // Developpement, ou une permission restee en acces standard au lieu d'avance.
  instagram_jeton_inerte:
    "Instagram a refusé l'accès à ce compte. Vérifiez qu'il s'agit bien d'un compte professionnel et que l'application dispose des accès avancés.",
  instagram_compte_personnel:
    "Ce compte Instagram est un compte personnel. Passez-le en compte professionnel (Business ou Créateur) depuis l'application Instagram, puis reconnectez-le.",
  instagram_echange_jeton:
    "Instagram n'a pas délivré d'accès longue durée. Réessayez dans quelques minutes.",
};

export function messageErreurOAuth(code: string): string {
  if (MESSAGES[code]) return MESSAGES[code];

  const provider = code.split('_')[0];
  const nom = FOURNISSEURS[provider] ?? provider;

  if (code.endsWith('_denied')) return `Connexion à ${nom} annulée.`;
  if (code.endsWith('_state')) return `Lien de connexion à ${nom} expiré. Relancez la connexion depuis cette page.`;
  if (code.endsWith('_token')) return `${nom} n'a pas délivré d'accès. Réessayez dans quelques minutes.`;
  if (code.endsWith('_save')) return `L'accès ${nom} n'a pas pu être enregistré. Réessayez.`;

  return `Erreur de connexion à ${nom}.`;
}
