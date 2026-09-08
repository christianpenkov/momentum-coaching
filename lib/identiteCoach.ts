import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Comment un élève voit son coach à l'écran : son prénom, et sa photo.
 *
 * ⚠️ UNE SEULE DÉFINITION. Deux écrans posent la même question — la page
 * « Conversations DM » de l'élève et sa fiche de lead dans Pipeline Leads — et
 * ils doivent y répondre pareil. Recopier `full_name.split(...)` dans le second
 * aurait suffi le premier jour, et aurait divergé le jour où le prénom se
 * calcule autrement (un nom composé, un pseudo, un profil sans nom).
 *
 * ⚠️ Rien n'est inventé : un coach sans photo rend `null`, et l'écran retombe
 * sur le glyphe. Un avatar par défaut fabriqué à partir des initiales
 * affirmerait une photo qui n'existe pas.
 */
export type IdentiteCoach = {
  /** Le prénom seul — `null` si le profil n'a pas de nom. */
  prenom: string | null;
  /** L'URL publique de sa photo — `null` s'il n'en a pas posé. */
  avatarUrl: string | null;
};

export const IDENTITE_COACH_INCONNUE: IdentiteCoach = { prenom: null, avatarUrl: null };

/**
 * Le prénom, c'est le premier mot du nom complet.
 *
 * ⚠️ « ton coach » n'est PAS décidé ici : un repli est une affaire d'écran, et
 * les deux écrans ne le formulent pas pareil (« Ton coach » en titre, « le
 * coach » dans une phrase). Cette fonction rend `null` et laisse dire.
 */
export function prenomDuNom(nomComplet: string | null | undefined): string | null {
  return (nomComplet || '').trim().split(/\s+/)[0] || null;
}

/** Lit le profil du coach. `coachId` absent ⇒ identité inconnue, sans requête. */
export async function identiteDuCoach(
  supa: SupabaseClient,
  coachId: string | null | undefined,
): Promise<IdentiteCoach> {
  if (!coachId) return IDENTITE_COACH_INCONNUE;
  const { data } = await supa
    .from('profiles').select('full_name, avatar_url').eq('id', coachId).maybeSingle();
  return {
    prenom: prenomDuNom(data?.full_name),
    avatarUrl: (data?.avatar_url as string | null) || null,
  };
}
