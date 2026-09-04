'use client';

import Link from 'next/link';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import { getClientWeek } from '@/lib/clientWeek';
import { isNotCanceled } from '@/lib/salesCallStats';
import { SEUIL_JOURS_SANS_PUBLIER } from '@/lib/clientSignals';
import type { ClientWithMetrics } from '@/lib/supabase/useCoachData';
import type { Call } from '@/lib/supabase/types';

/* Panneau de contexte de la messagerie coach.
 *
 * ⚠️ SON RÔLE, tranché avec Chris le 2026-09-04 : permettre de RÉPONDRE sans quitter la
 * conversation. Tout ce qu'il affiche doit servir à écrire le message suivant ; ce qui
 * ne sert qu'à analyser vit sur la fiche client, à un clic.
 *
 * ⚠️ TOUT CE QU'IL LIT EST DÉJÀ CHARGÉ par `useCoachData` — zéro requête ajoutée, quelle
 * que soit la conversation ouverte. C'est une contrainte, pas une coïncidence : un coach
 * qui parcourt vingt conversations multiplierait par vingt tout appel posé ici, et
 * l'egress de ce projet se paie au NOMBRE de requêtes (voir AGENTS.md). Le format de la
 * dernière publication a été écarté pour cette raison : il coûtait trois requêtes par
 * élève pour une information qui ne change pas la réponse.
 *
 * ── Trois défauts corrigés le 2026-09-04, tous du même genre ────────────────
 *
 * 1. « Cash » affichait le CONTRACTÉ sous un mot qui laissait croire à de l'encaissé.
 *    Il montre maintenant les deux, le collecté en premier — et il vient de
 *    `cashCollectedAllTime`, qui applique `lib/dealCash.ts` et déduit les remboursements.
 *    Une somme à la main sur ce même compte donne 2 800 € pour 2 600 € réellement en
 *    caisse : le remboursement de 200 € s'y perd.
 * 2. « Signaux actifs : 2 » comptait sans dire lesquels, donc n'appelait aucune action —
 *    et le compte était faux, `getClientSignals` étant appelé sans son troisième signal.
 *    Le compteur disparaît au profit des choses elles-mêmes : les tâches sont listées,
 *    les jours sans publier sont affichés.
 * 3. « Semaine N » affichait « Semaine 1 » pour un élève sans date d'arrivée. Un trou
 *    n'est pas une valeur : la semaine ne s'affiche plus dans ce cas.
 *
 * ⚠️ Le point 3 a été corrigé DANS `getClientWeek` elle-même le 2026-09-04, donc pour
 * les quatre écrans qui l'appellent. `SidebarClient` écrivait déjà `week ? … : ''` : sa
 * garde était juste, simplement désamorcée par une fonction qui ne rendait jamais `null`.
 */

interface ChatContextPanelProps {
  client: ClientWithMetrics;
  calls: Call[];
  open: boolean;
  onClose: () => void;
}

const LARGEUR = 320;

export default function ChatContextPanel({ client, calls, open, onClose }: ChatContextPanelProps) {
  /* ⚠️ `call_type === 'google'` : le call de COACHING. Sans ce filtre, le panneau
   * annonçait comme « dernier call » un rendez-vous de vente pris par un prospect de
   * l'élève — voir docs/calls-coach-id-piege.md. `isNotCanceled` vient de
   * `lib/salesCallStats.ts`, la même règle que la fiche client. */
  const callsCoaching = calls
    .filter(c => c.client_id === client.id && c.call_type === 'google' && isNotCanceled(c) && c.scheduled_at);

  const maintenant = Date.now();
  const prochain = callsCoaching
    .filter(c => new Date(c.scheduled_at!).getTime() >= maintenant)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())[0];
  const dernier = callsCoaching
    .filter(c => new Date(c.scheduled_at!).getTime() < maintenant)
    .sort((a, b) => new Date(b.scheduled_at!).getTime() - new Date(a.scheduled_at!).getTime())[0];

  const dateLongue = (iso: string) =>
    new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const heure = (iso: string) =>
    new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const joursDepuis = (iso: string) =>
    Math.max(0, Math.floor((maintenant - new Date(iso).getTime()) / 86_400_000));

  /* Les tâches OUVERTES. `done` est la colonne qui fait foi (`completed_at` existe aussi
   * mais n'est pas toujours posée). Trois au maximum : au-delà, le panneau devient une
   * liste de tâches, et la fiche client est faite pour ça. */
  const tachesOuvertes = (client.tasks ?? []).filter(t => !t.done);
  const tachesMontrees = tachesOuvertes.slice(0, 3);

  // `getClientWeek` rend `null` sans date d'arrivée : plus besoin de le garder ici.
  const semaine = getClientWeek(client.onboarding_completed_at);

  const collecte = client.cashCollectedAllTime ?? 0;
  const contracte = client.currentStats?.cashContracted ?? 0;
  // Le taux ne se calcule pas sur un dénominateur nul : « 0 % de rien » n'a pas de sens.
  const taux = contracte > 0 ? Math.round((collecte / contracte) * 100) : null;

  const jours = client.joursSansPublier;
  const aucuneAudience = jours === null;

  return (
    <aside style={{
      width: open ? LARGEUR : 0, flexShrink: 0,
      borderLeft: open ? '1px solid var(--border)' : 'none',
      background: 'var(--surface)', overflow: 'hidden',
      transition: 'width 200ms ease',
    }}>
      <div style={{
        width: LARGEUR, flexShrink: 0, padding: '20px 16px', position: 'relative',
        display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', height: '100%',
      }}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le panneau infos"
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--muted)'; }}
          style={{
            position: 'absolute', top: 12, right: 12, background: 'none', border: 'none',
            borderRadius: 6, padding: 4, cursor: 'pointer', color: 'var(--muted)', display: 'flex',
            transition: 'background 150ms ease, color 150ms ease',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        {/* ── Identité ─────────────────────────────────────────────────── */}
        <div style={{ textAlign: 'center' }}>
          {/* ⚠️ `display: flex` + `justifyContent: center`, et non `textAlign` ni
              `margin: 0 auto`. `Avatar` rend un élément de BLOC (une `div` colorée, ou
              une `img` en `display: block`) : `text-align` du parent ne le centre pas, et
              son `margin: auto` ne fait rien tant que le conteneur n'a pas de largeur
              propre. L'avatar restait donc collé à gauche pendant que le nom, lui, était
              bien centré — un décalage qu'on voit sans savoir le nommer. */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <Avatar initials={client.initials || getInitials(client.name)} avatarUrl={client.avatar_url} size={60} seed={client.id} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{client.name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {client.niche || 'Infopreneur'}
            {/* Pas de « Semaine 1 » inventée quand la date d'arrivée manque. */}
            {semaine !== null && ` · Semaine ${semaine}`}
          </div>
        </div>

        {/* ── Audience et rythme ───────────────────────────────────────── */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: '12px 14px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginBottom: 9 }}>
            Audience
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Instagram</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {(client.currentStats?.followersIg ?? 0).toLocaleString('fr-FR')}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>YouTube</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {(client.currentStats?.followersYt ?? 0).toLocaleString('fr-FR')}
              </div>
            </div>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10,
            marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border-soft)',
          }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Dernière publication</span>
            {aucuneAudience ? (
              <span style={{ fontSize: 12, color: 'var(--faint)', fontStyle: 'italic' }}>inconnue</span>
            ) : (
              <span style={{
                fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                // Le seuil est celui du signal « ne publie plus », jamais un seuil local :
                // le panneau et la bande à surveiller doivent s'alarmer au même moment.
                color: jours > SEUIL_JOURS_SANS_PUBLIER ? 'var(--amber)' : 'var(--ink)',
              }}>
                {jours === 0 ? "aujourd'hui" : jours === 1 ? 'hier' : `il y a ${jours} j`}
              </span>
            )}
          </div>
        </div>

        {/* ── Tâches ───────────────────────────────────────────────────── */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: '12px 14px' }}>
          <div style={{
            fontSize: 10.5, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.07em',
            fontWeight: 600, marginBottom: 9, display: 'flex', justifyContent: 'space-between',
          }}>
            <span>Tâches</span>
            {tachesOuvertes.length > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)' }}>{tachesOuvertes.length}</span>
            )}
          </div>
          {tachesMontrees.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--faint)', fontStyle: 'italic' }}>Aucune tâche en cours</div>
          ) : (
            <>
              {tachesMontrees.map(t => (
                <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.45, marginTop: 8 }}>
                  <span style={{
                    width: 12, height: 12, borderRadius: 3, border: '1.5px solid var(--muted)',
                    flexShrink: 0, marginTop: 3,
                  }} />
                  <span>{t.label}</span>
                </div>
              ))}
              {tachesOuvertes.length > tachesMontrees.length && (
                <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 8 }}>
                  + {tachesOuvertes.length - tachesMontrees.length} autre{tachesOuvertes.length - tachesMontrees.length > 1 ? 's' : ''}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Call de coaching ─────────────────────────────────────────────
            ⚠️ La carte s'affiche TOUJOURS. L'ancienne ne paraissait que s'il existait un
            call à venir — donc quasiment jamais, aucun élève du compte n'en ayant un.
            Or « aucun prochain call posé » est précisément ce qu'un coach veut voir. */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: '12px 14px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginBottom: 9 }}>
            Call de coaching
          </div>
          {prochain?.scheduled_at ? (
            <>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Prochain</div>
              <div style={{ fontSize: 14, fontWeight: 600, textTransform: 'capitalize', marginTop: 1 }}>
                {dateLongue(prochain.scheduled_at)} · {heure(prochain.scheduled_at)}
              </div>
              {prochain.topic && (
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{prochain.topic}</div>
              )}
            </>
          ) : dernier?.scheduled_at ? (
            <>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Dernier tenu</div>
              <div style={{ fontSize: 14, fontWeight: 600, textTransform: 'capitalize', marginTop: 1 }}>
                {dateLongue(dernier.scheduled_at)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                il y a {joursDepuis(dernier.scheduled_at)} j · aucun prochain call posé
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--faint)', fontStyle: 'italic' }}>Aucun call de coaching</div>
          )}
        </div>

        {/* ── Business ─────────────────────────────────────────────────── */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: '12px 14px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, marginBottom: 9 }}>
            Business
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Cash collecté</span>
            <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {collecte.toLocaleString('fr-FR')} €
            </span>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10,
            marginTop: 7, paddingTop: 7, borderTop: '1px solid var(--border-soft)',
          }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Contracté</span>
            <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {contracte.toLocaleString('fr-FR')} €{taux !== null && ` · ${taux} %`}
            </span>
          </div>
        </div>

        {/* ── Les trois portes de sortie ───────────────────────────────────
            ⚠️ Les ancres `#ressources` et `#calls` doivent EXISTER dans la fiche client.
            Elles n'existaient pas jusqu'au 2026-09-04 : les deux liens ouvraient la page
            et ne descendaient nulle part — le même défaut silencieux qu'un bouton qui ne
            fait rien. Ajoutées dans `PageClientDetail.tsx` ; ne pas renommer l'une sans
            l'autre. */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: '2px 14px' }}>
          <Link href={`/clients/${client.id}`} className="dc-liftrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', fontSize: 12.5, borderBottom: '1px solid var(--border-soft)', textDecoration: 'none', color: 'var(--ink)' }}>
            Voir la fiche client<span style={{ color: 'var(--faint)' }}>›</span>
          </Link>
          <Link href={`/clients/${client.id}#ressources`} className="dc-liftrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', fontSize: 12.5, borderBottom: '1px solid var(--border-soft)', textDecoration: 'none', color: 'var(--ink)' }}>
            Ressources partagées<span style={{ color: 'var(--faint)' }}>›</span>
          </Link>
          <Link href={`/clients/${client.id}#calls`} className="dc-liftrow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', fontSize: 12.5, textDecoration: 'none', color: 'var(--ink)' }}>
            Rapports de calls<span style={{ color: 'var(--faint)' }}>›</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}
