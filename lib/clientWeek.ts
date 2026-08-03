// clients.week était posé une seule fois à l'invitation (toujours 1) puis jamais
// incrémenté nulle part — figé depuis toujours pour tout le monde. Calculé ici à
// la volée depuis onboarding_completed_at (création réelle du compte Momentum),
// même référence temporelle que Cash/Closing (voir lib/salesCallStats.ts).
export function getClientWeek(onboardingCompletedAt: string | null | undefined): number {
  if (!onboardingCompletedAt) return 1;
  const start = new Date(onboardingCompletedAt).getTime();
  const now = Date.now();
  if (now <= start) return 1;
  const weeksElapsed = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000));
  return weeksElapsed + 1;
}
