// clients.week était posé une seule fois à l'invitation (toujours 1) puis jamais
// incrémenté nulle part — figé depuis toujours pour tout le monde. Calculé ici à
// la volée depuis onboarding_completed_at (création réelle du compte Momentum),
// même référence temporelle que Cash/Closing (voir lib/salesCallStats.ts).
//
// ⚠️ REND `null` QUAND LA DATE MANQUE, et c'est le point de cette fonction.
//
// Elle rendait `1`. Un élève sans date d'arrivée s'affichait donc « Semaine 1 » partout,
// c'est-à-dire un chiffre inventé présenté comme une mesure — l'inverse exact de la règle
// du projet (« un 0 affirme quelque chose, un trou dit on ne sait pas »). Le cas n'est pas
// théorique : au 2026-09-04, un élève du compte a `integrations_ready_at` posé et aucune
// date d'arrivée, donc il apparaissait « Semaine 1 » dans la liste des conversations.
//
// Le plus révélateur : `SidebarClient` écrivait DÉJÀ `week ? … : ''` pour ne rien
// afficher sans donnée. La garde était juste, elle était simplement désamorcée par une
// fonction qui ne rendait jamais `null`. C'est pourquoi la correction est ici et non aux
// quatre sites d'appel : une garde qu'on ne peut pas déclencher ne protège de rien.
export function getClientWeek(onboardingCompletedAt: string | null | undefined): number | null {
  if (!onboardingCompletedAt) return null;
  const start = new Date(onboardingCompletedAt).getTime();
  if (Number.isNaN(start)) return null;
  const now = Date.now();
  if (now <= start) return 1;
  const weeksElapsed = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000));
  return weeksElapsed + 1;
}
