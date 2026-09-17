import DesktopOnly from '@/components/ui/DesktopOnly';
import PageConversationsCoach from '@/components/pages/coach/PageConversationsCoach';

/**
 * ⚠️ Ordinateur seulement, comme la page de l'élève : la liste et le fil
 * s'y disputeraient la même largeur sur 390 px. `DesktopOnly` porte déjà cette
 * décision et son message de repli.
 */
export default function CoachConversationsPage() {
  return (
    <DesktopOnly>
      <PageConversationsCoach />
    </DesktopOnly>
  );
}
