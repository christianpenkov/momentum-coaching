/**
 * mutate — écriture réseau dont l'échec ne peut pas passer inaperçu.
 *
 * Le problème qu'elle résout : partout dans l'app, une action suit le même
 * motif — on met l'écran à jour tout de suite (c'est bien, ça rend l'app
 * instantanée), puis on envoie la requête. Mais le résultat de cette requête
 * n'était jamais lu :
 *
 *     setTasks(prev => prev.filter(t => t.id !== id));   // écran à jour
 *     await fetch(`/api/tasks/${id}`, { method: 'DELETE' }); // résultat ignoré
 *
 * Si le serveur refuse (session expirée, règle RLS, réseau coupé), la tâche
 * disparaît de l'écran alors qu'elle existe toujours en base. L'utilisateur
 * croit son action enregistrée, et ne s'aperçoit de rien jusqu'au prochain
 * rechargement. Sur un objectif « zéro maintenance », c'est le pire des cas :
 * une divergence silencieuse entre ce qui est affiché et ce qui est stocké.
 *
 * Ce que `mutate` change : elle renvoie `true` seulement si le serveur a
 * confirmé. Sinon elle appelle `rollback` — qui restaure l'écran — et
 * prévient l'utilisateur. Rien d'autre : pas de cache, pas de file d'attente,
 * pas de nouvelle dépendance. C'est le strict nécessaire pour qu'un échec
 * cesse d'être invisible.
 *
 * Usage :
 *
 *     const avant = tasks;
 *     setTasks(prev => prev.filter(t => t.id !== id));
 *     await mutate(`/api/tasks/${id}`, { method: 'DELETE' }, {
 *       rollback: () => setTasks(avant),
 *       erreur: 'Impossible de supprimer la tâche.',
 *     });
 */

export interface MutateOptions extends RequestInit {
  /** Restaure l'état affiché quand le serveur n'a pas confirmé. */
  rollback?: () => void;
  /** Message montré à l'utilisateur en cas d'échec. */
  erreur?: string;
  /** Affiche le message. Par défaut : bandeau discret en haut de l'écran. */
  notifier?: (message: string) => void;
}

/**
 * Bandeau d'erreur par défaut.
 *
 * Volontairement en DOM direct plutôt qu'en composant React : `mutate` est
 * appelée depuis des fonctions ordinaires, hors du cycle de rendu, et doit
 * fonctionner sans qu'on ait à brancher un fournisseur de contexte dans
 * chaque page. Une page qui a déjà son propre toast passe le sien via
 * `notifier` et celui-ci n'est jamais utilisé.
 */
function bandeauParDefaut(message: string) {
  if (typeof document === 'undefined') return;

  const ID = 'mutate-error-banner';
  document.getElementById(ID)?.remove();

  const el = document.createElement('div');
  el.id = ID;
  el.setAttribute('role', 'alert');
  el.textContent = message;
  el.style.cssText = [
    'position:fixed',
    // calc() plutôt qu'une valeur fixe : sur iPhone la zone sûre commence
    // sous l'encoche, un top fixe glisserait dessous.
    'top:calc(env(safe-area-inset-top) + 12px)',
    'left:14px',
    'right:14px',
    'z-index:99999',
    'margin:0 auto',
    'max-width:420px',
    'padding:12px 16px',
    'border-radius:10px',
    'background:#cd5b3f',
    'color:#fff',
    'font:600 13px/1.4 var(--font-inter, system-ui, sans-serif)',
    'box-shadow:0 4px 16px rgba(0,0,0,.18)',
    'text-align:center',
    'opacity:0',
    'transform:translateY(-8px)',
    'transition:opacity 160ms ease, transform 160ms ease',
  ].join(';');

  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), 200);
  }, 4000);
}

/**
 * Affiche le même bandeau que `mutate`, pour les appels qui lisent déjà leur
 * réponse (`data.url`, `data.ok`…) et n'ont donc pas besoin de `mutate`, mais
 * qui échouaient en silence faute de le dire à l'utilisateur.
 */
export function notifyError(message: string) {
  bandeauParDefaut(message);
}

export async function mutate(
  url: string,
  options: MutateOptions = {},
): Promise<boolean> {
  const { rollback, erreur, notifier, ...init } = options;

  let ok = false;
  try {
    const res = await fetch(url, init);
    ok = res.ok;
  } catch {
    // Réseau coupé, requête interrompue : traité comme un échec, jamais
    // comme un succès. Le catch est indispensable — sans lui l'exception
    // remonte et le rollback ne s'exécute pas.
    ok = false;
  }

  if (!ok) {
    rollback?.();
    const message = erreur ?? "L'action n'a pas pu être enregistrée.";
    (notifier ?? bandeauParDefaut)(message);
  }

  return ok;
}
