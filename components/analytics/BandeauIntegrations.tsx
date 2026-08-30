'use client';

import { useQuery } from '@tanstack/react-query';
import type { IntegrationSante } from '@/app/api/integrations/health/route';

/**
 * Bandeau unique de santé des intégrations, posé une fois en haut de Mes Stats.
 *
 * Il remplace le bandeau `snapshotError`, qui ne regardait qu'Instagram et
 * YouTube : si le jeton Calendly, Short.io ou Stripe mourait, les chiffres se
 * figeaient sans qu'aucun écran ne le dise. Aucun chiffre n'était faux — c'est
 * leur FRAÎCHEUR qui mentait, l'échec silencieux dans sa forme la plus coûteuse,
 * parce qu'il ne laisse aucune trace à l'écran.
 *
 * Ce composant ne décide de rien : ni de la liste des intégrations, ni de ce qui
 * compte comme un retard. Les deux viennent de la vue `integrations_sante`. Une
 * huitième intégration, ou un nouveau seuil, apparaît ici sans qu'on y touche.
 */

const COULEURS: Record<IntegrationSante['etat'], { fond: string; bord: string; texte: string }> = {
  non_connectee:     { fond: '#cd5b3f10', bord: '#cd5b3f40', texte: '#cd5b3f' },
  en_echec:          { fond: '#cd5b3f10', bord: '#cd5b3f40', texte: '#cd5b3f' },
  collecte_degradee: { fond: '#b5802510', bord: '#b5802540', texte: '#b58025' },
  ok:                { fond: '', bord: '', texte: '' },
};

function dateLisible(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/** Une phrase par intégration en peine — ce qui se passe, et ce que ça change à
 *  l'écran. « Short.io est en erreur » ne dit pas quoi en faire ; « les clics
 *  affichés s'arrêtent au 12 août » si. */
function phrase(i: IntegrationSante): string {
  if (i.etat === 'non_connectee') {
    return `${i.libelle} n’est pas connecté — rien n’est collecté de ce côté.`;
  }
  if (i.etat === 'en_echec') {
    const depuis = dateLisible(i.derniere_donnee);
    return depuis
      ? `${i.libelle} refuse la connexion — les données s’arrêtent au ${depuis}.`
      : `${i.libelle} refuse la connexion — plus rien n’est collecté.`;
  }
  // Cas a part : ce n'est PAS l'integration qui est en peine, c'est sa SURVEILLANCE.
  // Stripe ne collecte rien quotidiennement — son etat ne se connait qu'en
  // l'appelant, ce que fait /api/stripe/cron-health une fois par jour. Si ce ping
  // s'arrete, aucun chiffre ne devient faux : c'est la capacite a detecter une panne
  // qui disparait. Dire « Stripe ne repond plus, les chiffres s'arretent la »
  // serait doublement faux, et c'est exactement la phrase qui s'est affichee le
  // 2026-08-30 avant cette correction.
  if (i.etat_collecte === 'ping_absent') {
    const depuisPing = dateLisible(i.derniere_donnee);
    return depuisPing
      ? `La surveillance de ${i.libelle} ne tourne plus depuis le ${depuisPing} — une panne de paiement passerait inaperçue. Les chiffres, eux, restent justes.`
      : `La surveillance de ${i.libelle} ne tourne plus — une panne de paiement passerait inaperçue.`;
  }

  const depuis = dateLisible(i.derniere_donnee);
  const retard = i.retard_jours ?? 0;
  if (retard > 1 && depuis) {
    return `${i.libelle} ne répond plus depuis le ${depuis} — les chiffres affichés s’arrêtent là.`;
  }
  // Retard nul mais collecte imparfaite : des journées manquent dans l'historique,
  // le cron les rattrape de lui-même. On le dit sans alarmer.
  return `${i.libelle} : des journées manquent dans l’historique, elles se rattrapent automatiquement.`;
}

export default function BandeauIntegrations({ profileId }: { profileId?: string }) {
  const { data } = useQuery<{ integrations: IntegrationSante[] } | { error: string }>({
    queryKey: ['integrations-sante', profileId],
    queryFn: () => fetch(`/api/integrations/health${profileId ? `?profileId=${profileId}` : ''}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  if (!data || 'error' in data) return null;

  // Les pannes franches d'abord : une intégration débranchée prime sur un jour de
  // retard, et c'est elle qu'on veut lire en premier.
  const rang: Record<IntegrationSante['etat'], number> = { non_connectee: 0, en_echec: 1, collecte_degradee: 2, ok: 3 };
  const enPeine = data.integrations
    .filter(i => i.etat !== 'ok')
    .sort((a, b) => rang[a.etat] - rang[b.etat] || a.libelle.localeCompare(b.libelle));

  if (enPeine.length === 0) return null;

  const pire = enPeine[0].etat;
  const c = COULEURS[pire];

  return (
    <div
      role="status"
      style={{
        marginBottom: 16, padding: '10px 16px',
        background: c.fond, border: `1px solid ${c.bord}`, borderRadius: 8,
        fontSize: 13, color: c.texte,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
    >
      {enPeine.map(i => (
        <div key={i.provider} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span aria-hidden style={{ flexShrink: 0 }}>⚠️</span>
          <span>{phrase(i)}</span>
        </div>
      ))}
    </div>
  );
}
