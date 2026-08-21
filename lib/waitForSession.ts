import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Résout l'utilisateur connecté de façon fiable au réveil d'une PWA.
 *
 * Le problème : quand l'app a été fermée un moment, le JS ne tourne pas et le
 * token d'accès expire. Au relancement, `getUser()` peut renvoyer null pendant
 * que le SDK rafraîchit le token en arrière-plan. Conclure « pas de session »
 * sur ce premier null fait afficher un état vide (« ton coach configure ton
 * espace ») avant que le middleware ne redirige vers /login — alors que la
 * session est parfaitement valide.
 *
 * La solution : ne pas deviner un délai, mais écouter l'événement que le SDK
 * émet quand il a fini. Un setTimeout fixe est soit trop court sur réseau lent,
 * soit du temps perdu à chaque lancement ; ici on repart à la milliseconde où
 * la session est prête.
 *
 * Distingue deux situations que `getUser() === null` confond :
 *   - aucun refresh token en stockage  -> réellement déconnecté, on rend la
 *     main immédiatement (pas de latence ajoutée sur l'écran de login) ;
 *   - un refresh token existe          -> session récupérable, on attend
 *     l'événement de restauration.
 */
export async function resolveUser(
  supabase: SupabaseClient,
  timeoutMs = 8000,
): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return user;

  // getSession lit le stockage local sans appel réseau : présence d'une session
  // = un refresh token existe, donc le SDK est en train de la restaurer ou peut
  // le faire. Son absence est un vrai « déconnecté », inutile d'attendre.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  return new Promise<User | null>((resolve) => {
    let done = false;
    const finish = (u: User | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      data.subscription.unsubscribe();
      resolve(u);
    };

    // TOKEN_REFRESHED / SIGNED_IN : le SDK a restauré la session.
    // SIGNED_OUT : le refresh token était mort, inutile d'attendre le délai.
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') return finish(null);
      if (s?.user) finish(s.user);
    });

    // Filet : si aucun événement n'arrive (réseau coupé, SDK bloqué), on ne
    // reste pas suspendu indéfiniment. On retente une dernière lecture plutôt
    // que de renvoyer null d'office — la session a pu être restaurée sans que
    // l'événement nous parvienne.
    const timer = setTimeout(async () => {
      const { data } = await supabase.auth.getUser();
      finish(data.user ?? null);
    }, timeoutMs);
  });
}
