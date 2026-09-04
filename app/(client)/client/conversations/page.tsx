import DesktopOnly from '@/components/ui/DesktopOnly';
import PageConversationsIg from '@/components/pages/client/PageConversationsIg';

/**
 * ⚠️ Ordinateur seulement, comme `PageClientStats`. Un fil annotable ne tient
 * pas sur 390 px : la liste, le fil et les notes s'y disputeraient la même
 * largeur. `DesktopOnly` porte déjà cette décision pour cinq écrans du projet,
 * et son message de repli est écrit.
 */
export default function ClientConversationsPage() {
  return (
    <DesktopOnly>
      <PageConversationsIg />
    </DesktopOnly>
  );
}
