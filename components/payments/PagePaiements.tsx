'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Icon from '@/components/ui/Icon';
import FicheClient from './FicheClient';
import ListeClients from './ListeClients';
import ReconcileTab from './ReconcileTab';
import RelancesTab from './RelancesTab';
import CreateLinkModal from './CreateLinkModal';
import { useIsMobile } from '@/lib/useIsMobile';
import type { PaymentsData, DealRow } from './types';
import { fmtEur, fmtDateLong } from './types';

/**
 * Page Paiements — « où est mon argent ».
 *
 * Un seul composant monté deux fois, comme PageClientStats : le coach voit son
 * propre business, l'élève le sien. Les deux business ne sont jamais reliés —
 * qu'un élève paie Quennel n'a aucun rapport avec ce que cet élève encaisse de
 * ses prospects.
 */

type Tab = 'deals' | 'reconcile' | 'relances';
type Filter = 'all' | 'open' | 'unpaid' | 'paid' | 'ended' | 'canceled';

export default function PagePaiements({ title = 'Paiements', isCoach = false }: { title?: string; isCoach?: boolean }) {
  const [tab, setTab] = useState<Tab>('deals');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [openDeal, setOpenDeal] = useState<string | null>(null);
  /** Personne ouverte dans la fiche — la fiche porte un client, pas une vente. */
  const [openPerson, setOpenPerson] = useState<string | null>(null);

  // ?deal=<id> ouvre directement le panneau de détail : une notification de
  // rappel doit mener à la personne concernée, pas à une liste où il faut la
  // retrouver. Lu une seule fois au montage — ensuite l'état local prime, pour
  // que fermer le panneau ne le rouvre pas au rendu suivant.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('deal');
    if (id) setOpenDeal(id);
  }, []);
  const [creating, setCreating] = useState(false);
  const isMobile = useIsMobile();

  const { data, isLoading, refetch } = useQuery<PaymentsData>({
    queryKey: ['payments'],
    queryFn: () => fetch('/api/payments').then(r => {
      if (!r.ok) throw new Error('Chargement impossible');
      return r.json();
    }),
    staleTime: 60_000,
  });

  const deals = data?.deals ?? [];
  const people = data?.people ?? [];

  // ── Le filtre porte sur les VENTES, la liste affiche des PERSONNES ────────
  // Une personne ressort dès qu'une seule de ses ventes correspond : filtrer sur
  // son état de ligne — qui n'est que le plus urgent — ferait disparaître un
  // client dont une vente sur trois est impayée, précisément celui qu'on cherche.
  const filtered = useMemo(() => {
    const correspond = (d: DealRow) =>
      filter === 'all' ? true
      : filter === 'open' ? d.status === 'open' && !d.hasFailure
      : filter === 'unpaid' ? d.status === 'past_due' || d.hasFailure
      : filter === 'paid' ? d.status === 'paid'
      : filter === 'ended' ? d.status === 'ended'
      : d.status === 'canceled';

    const gardees = new Set(deals.filter(correspond).map(d => d.id));
    let rows = people.filter(p => p.dealIds.some(id => gardees.has(id)));

    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter(p =>
      p.name.toLowerCase().includes(q) || (p.subtitle ?? '').toLowerCase().includes(q)
    );
    return rows;
  }, [deals, people, filter, search]);

  // ── Les litiges ouverts ───────────────────────────────────────────────────
  // Le bandeau n'occupe AUCUNE place quand il n'y a rien à signaler : il pousse
  // le reste vers le bas le jour où il apparaît, plutôt que de réserver un vide
  // permanent qui deviendrait invisible à force d'être là.
  const litiges = useMemo(() => deals.filter(d => d.status === 'disputed'), [deals]);

  // La fiche s'ouvre sur une personne. Un lien ?deal=<id> désigne une vente : on
  // remonte à son propriétaire, sans quoi la notification n'ouvrirait rien.
  const personneOuverte = useMemo(() => {
    if (openPerson) return people.find(p => p.key === openPerson) ?? null;
    if (openDeal) return people.find(p => p.dealIds.includes(openDeal)) ?? null;
    return null;
  }, [openPerson, openDeal, people]);

  function fermerFiche() { setOpenPerson(null); setOpenDeal(null); }

  const k = data?.kpis;
  const orphanCount = data?.orphans.length ?? 0;
  const relanceCount = useMemo(() => countRelances(deals), [deals]);

  return (
    <div className="page-content" style={{ paddingBottom: 40 }}>
      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px', margin: 0 }}>{title}</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {isLoading
              ? <span className="skeleton-shimmer" style={{ display: 'block', width: 96, height: 10, borderRadius: 4, marginTop: 3 }} />
              : subtitleFor(tab, people.length, deals.length, orphanCount, relanceCount, isCoach)}
          </div>
        </div>
        {/* Masqué tant que Stripe n'est pas connecté : proposer une action
            impossible fait perdre le temps de remplir un formulaire pour rien. */}
        {/* Libellé court sur mobile : en toutes lettres, le bouton mange la
            moitié de la largeur d'écran et écrase le titre de page. */}
        {data?.stripeConnected !== false && (
          <button className="btn-primary-brand" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
            onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} /> {isMobile ? 'Lien' : 'Créer un lien de paiement'}
          </button>
        )}
      </div>

      {/* Skeleton sur toute la zone de données — KPI, onglets et liste d'un
          bloc. Les afficher vides avec des « — » puis les remplir donnerait
          deux états successifs pour un même chargement. */}
      {isLoading && <PaymentsSkeleton isMobile={isMobile} />}

      {!isLoading && <>

      {/* ── Litiges en cours ────────────────────────────────────────────── */}
      {litiges.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 11, marginBottom: 18,
          background: 'var(--red-soft)', border: '1px solid rgba(205,91,63,.3)',
          borderRadius: 10, padding: '12px 14px',
        }}>
          <Icon name="alert-triangle" size={16} color="var(--red)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
              {litiges.length === 1
                ? `${litiges[0].buyerName} conteste un paiement`
                : `${litiges.length} paiements contestés`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.55 }}>
              {litiges.length === 1 && litiges[0].disputeDueBy
                ? <>Réponse à donner dans Stripe avant le {fmtDateLong(litiges[0].disputeDueBy)}. Passé ce délai, l’argent est perdu automatiquement.</>
                : <>Une réponse doit être donnée dans Stripe pour chacun. Passé le délai, l’argent est perdu automatiquement.</>}
            </div>
          </div>
          <a href="https://dashboard.stripe.com/disputes" target="_blank" rel="noopener noreferrer"
            className="btn-primary-brand"
            style={{ fontSize: 12, flexShrink: 0, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--red)', borderColor: 'var(--red)' }}>
            <Icon name="external" size={13} /> Répondre dans Stripe
          </a>
        </div>
      )}

      {/* ── Ruban de KPI ────────────────────────────────────────────────── */}
      {/* Mobile : un KPI héros (le collecté, la seule question qui compte sur un
          écran de 390px) et trois chiffres secondaires. Quatre cartes égales y
          seraient illisibles. */}
      {isMobile ? (
        <div style={{ marginBottom: 18 }}>
          {/* Pas de mention de période : les KPI portent sur l'intégralité des
              deals, pas sur une fenêtre glissante. Le « · 30 derniers jours »
              affiché jusqu'ici décrivait un bornage qui n'a jamais existé côté
              serveur — seul l'onglet « À rattacher » est borné. */}
          <CashCollectedHero k={k} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <MiniKpi label="Reste dû" value={k ? fmtEur(k.remaining) : '—'} />
            <MiniKpi label="Impayés" value={k ? fmtEur(k.unpaid) : '—'} color={k && k.unpaid > 0 ? 'var(--red)' : undefined} />
            <MiniKpi label="Deals" value={String(k?.dealsCount ?? 0)} />
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 20 }}>
          <Kpi label="Cash contracté" value={k ? fmtEur(k.contracted) : '—'}
            sub={k ? `${k.dealsCount} deal${k.dealsCount > 1 ? 's' : ''} signé${k.dealsCount > 1 ? 's' : ''}` : ''} />
          <Kpi label="Cash collecté" value={k ? fmtEur(k.collected) : '—'}
            sub={k ? `${k.collectedRate} % du contracté` : ''} color="var(--green)" />
          <Kpi label="Reste à encaisser" value={k ? fmtEur(k.remaining) : '—'} sub="échéances à venir" />
          <Kpi label="Impayés" value={k ? fmtEur(k.unpaid) : '—'}
            sub={k && k.failedCount > 0
              ? `${k.failedCount} paiement${k.failedCount > 1 ? 's' : ''} en échec`
              : 'tout est à jour'}
            color={k && k.unpaid > 0 ? 'var(--red)' : 'var(--green)'} />
        </div>
      )}

      {/* ── Onglets ─────────────────────────────────────────────────────── */}
      {/* Mobile : les trois onglets se partagent la largeur au lieu d'être
          serrés à gauche — ça agrandit aussi les cibles tactiles. */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 18 }}>
        {/* « Clients » et non « Deals » : la liste montre des personnes depuis
            qu'un même client peut avoir plusieurs ventes. */}
        <TabButton active={tab === 'deals'} onClick={() => setTab('deals')} label="Clients" grow={isMobile} />
        <TabButton active={tab === 'reconcile'} onClick={() => setTab('reconcile')} label="À rattacher" count={orphanCount} alert grow={isMobile} />
        <TabButton active={tab === 'relances'} onClick={() => setTab('relances')} label="Relances" count={relanceCount} grow={isMobile} />
      </div>

      {tab === 'deals' ? (
        <>
          {/* Filtres masqués sans deal à filtrer : ils n'auraient aucun effet et
              encombreraient l'écran d'accueil d'un nouvel utilisateur. */}
          <div style={{ display: deals.length === 0 ? 'none' : 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {([['all', 'Tous'], ['open', 'En cours'], ['unpaid', 'Impayés'], ['paid', 'Soldés'], ['ended', 'Terminés'], ['canceled', 'Annulés']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)}
                className="paiements-filter"
                style={{
                  border: `1px solid ${filter === key ? 'var(--ink)' : 'var(--border)'}`,
                  background: filter === key ? 'var(--ink)' : 'var(--surface)',
                  color: filter === key ? '#fff' : 'var(--ink-2)',
                  fontWeight: filter === key ? 600 : 400,
                  borderRadius: 999, padding: '6px 13px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
                }}>{label}</button>
            ))}
            {/* Desktop : poussée à droite de la rangée de filtres. Mobile : elle
                passe à la ligne, où `marginLeft: auto` la laissait décalée à
                droite sur une largeur fixe de 180px au lieu de prendre la
                largeur disponible. */}
            {/* Le focus se pose sur l'enveloppe, pas sur le champ : c'est elle
                qui porte la bordure visible, et l'input a `outline: none`.
                Sans ça, cliquer dans la zone n'affichait aucun retour — la
                loupe restant en dehors de tout indicateur. */}
            <span style={{
              marginLeft: isMobile ? 0 : 'auto',
              width: isMobile ? '100%' : undefined,
              display: 'flex', alignItems: 'center', gap: 8,
              border: `1px solid ${searchFocused ? 'var(--ink)' : 'var(--border)'}`,
              boxShadow: searchFocused ? '0 0 0 3px var(--surface-2)' : undefined,
              borderRadius: 8, padding: '8px 12px', background: 'var(--surface)',
              transition: 'border-color .15s, box-shadow .15s',
            }}>
              <Icon name="search" size={15} color={searchFocused ? 'var(--muted)' : 'var(--faint)'} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une personne…"
                onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, color: 'var(--ink)', fontFamily: 'inherit', width: isMobile ? '100%' : 180, minWidth: 0 }} />
            </span>
          </div>

          {/* Stripe absent prime sur « aucun deal » : c'est ce qui bloque, et le
              premier écran que verra tout nouvel utilisateur. */}
          {data && !data.stripeConnected
            ? <StripeDisconnected isCoach={isCoach} />
            : deals.length === 0
              ? <EmptyDeals onCreate={() => setCreating(true)} />
              : <ListeClients people={filtered} deals={deals} onOuvrir={setOpenPerson} isCoach={isCoach} />}
        </>
      ) : tab === 'reconcile' ? (
        <ReconcileTab orphans={data?.orphans ?? []} onDone={refetch} />
      ) : (
        <RelancesTab deals={deals} details={data?.details ?? {}} onChange={refetch} />
      )}

      </>}

      {/* La personne doit exister : depuis qu'un ?deal=<id> peut venir d'une
          notification, l'id peut désigner une vente supprimée ou d'un autre
          profil — sans cette garde, la fiche recevrait undefined et planterait
          à l'ouverture de la page. */}
      {personneOuverte && data && (
        <FicheClient
          person={personneOuverte}
          deals={deals.filter(d => personneOuverte.dealIds.includes(d.id))}
          details={data.details}
          onClose={fermerFiche}
          onChange={refetch}
          isCoach={isCoach}
        />
      )}

      {creating && (
        <CreateLinkModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refetch(); }} />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value tabular" style={color ? { color } : undefined}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 5 }}>{sub}</div>
    </div>
  );
}

/**
 * Squelette de chargement — reprend la structure exacte de la page (ruban de
 * KPI, onglets, lignes) pour que le contenu se substitue à lui sans que la
 * mise en page saute. Le shimmer `.skeleton-shimmer` est le même que sur les
 * autres écrans de l'app.
 */
function PaymentsSkeleton({ isMobile }: { isMobile: boolean }) {
  const bar = (w: number | string, h: number, extra?: React.CSSProperties) => (
    <div className="skeleton-shimmer" style={{ width: w, height: h, borderRadius: 4, ...extra }} />
  );

  return (
    <div aria-busy="true" aria-label="Chargement des paiements">
      {isMobile ? (
        <div style={{ marginBottom: 18 }}>
          <div className="card" style={{ padding: '16px 18px', marginBottom: 10 }}>
            {bar(110, 10, { marginBottom: 11 })}
            {bar(150, 30, { borderRadius: 6, marginBottom: 12 })}
            {bar('100%', 4, { borderRadius: 2 })}
            {bar(170, 10, { marginTop: 9 })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[0, 1, 2].map(i => (
              <div key={i} className="card" style={{ padding: '12px 13px' }}>
                {bar('70%', 9, { marginBottom: 9 })}
                {bar('85%', 16, { borderRadius: 5 })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 20 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="card" style={{ padding: '16px 18px' }}>
              {bar('65%', 10, { marginBottom: 11 })}
              {bar('80%', 22, { borderRadius: 5, marginBottom: 9 })}
              {bar('50%', 9)}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: isMobile ? 4 : 20, borderBottom: '1px solid var(--border)', marginBottom: 18, padding: '0 0 11px' }}>
        {[70, 92, 78].map((w, i) => (
          <div key={i} style={{ flex: isMobile ? 1 : undefined, display: 'flex', justifyContent: isMobile ? 'center' : undefined }}>
            {bar(isMobile ? '70%' : w, 12)}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="card" style={{ padding: isMobile ? '14px 16px' : '15px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 11 }}>
              {bar(isMobile ? 32 : 30, isMobile ? 32 : 30, { borderRadius: '50%', flexShrink: 0 })}
              <div style={{ flex: 1, minWidth: 0 }}>
                {bar(`${45 + ((i * 13) % 30)}%`, 12, { marginBottom: 6 })}
                {bar(`${30 + ((i * 17) % 25)}%`, 9)}
              </div>
              {bar(72, 20, { borderRadius: 999, flexShrink: 0 })}
            </div>
            {bar('100%', 4, { borderRadius: 2 })}
          </div>
        ))}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label, count, alert, grow }: {
  active: boolean; onClick: () => void; label: string; count?: number; alert?: boolean;
  /** Partage la largeur disponible à parts égales (mobile). */
  grow?: boolean;
}) {
  return (
    <button onClick={onClick} style={{
      flex: grow ? 1 : undefined,
      justifyContent: grow ? 'center' : undefined,
      display: 'inline-flex', alignItems: 'center', gap: 8,
      // minHeight plutot qu'un padding plus grand : la cible atteint les 44px
      // recommandes par Apple (elle faisait 38px) sans deplacer la bordure
      // basse qui marque l'onglet actif.
      minHeight: grow ? 44 : undefined,
      padding: grow ? '10px 4px' : '10px 15px', fontSize: 13,
      marginBottom: -1, borderBottom: `2px solid ${active ? 'var(--accent-brand)' : 'transparent'}`,
      color: active ? 'var(--ink)' : 'var(--muted)', fontWeight: active ? 600 : 400,
      background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
      borderBottomWidth: 2, borderBottomStyle: 'solid',
      borderBottomColor: active ? 'var(--accent-brand)' : 'transparent',
    }}>
      {label}
      {count !== undefined && count > 0 && (
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
          background: alert ? 'var(--red)' : 'var(--surface-2)',
          color: alert ? '#fff' : 'var(--muted)',
        }}>{count}</span>
      )}
    </button>
  );
}

/**
 * Carte « Cash collecté » — le seul chiffre que l'élève lit en ouvrant la page
 * sur son téléphone. Il répond à « combien j'ai vraiment encaissé », pas à
 * « combien j'ai vendu » : c'est le collecté, jamais le contracté.
 *
 * Le vert est réservé à ce chiffre sur tout l'écran — il signifie « argent
 * réellement arrivé ». La barre reste verte quel que soit le taux : un taux de
 * collecte bas n'est pas une erreur, et les impayés ont déjà leur carte rouge
 * juste en dessous.
 *
 * Sur desktop cette hiérarchie n'existe pas : les 4 KPI y sont à égalité. Le
 * chiffre dominant est une réponse à la contrainte mobile, pas une règle.
 */
function CashCollectedHero({ k }: { k: PaymentsData['kpis'] | undefined }) {
  const reduceMotion = usePrefersReducedMotion();
  const target = k?.collected ?? 0;
  const displayed = useCountUp(target, !!k && !reduceMotion);

  // Plafonné à 100 % : un client qui paie d'avance (ou un upsell encaissé avant
  // signature) donnerait un ratio > 100 et une barre débordant de sa piste. Le
  // pourcentage en légende garde la vraie valeur, lui.
  const rate = k?.collectedRate ?? 0;
  const barWidth = Math.min(100, Math.max(0, rate));

  // Un montant long (« 124 500 € ») revient à la ligne en 34px : on descend d'un
  // cran plutôt que de tronquer un montant, qui deviendrait faux.
  const text = k ? fmtEur(displayed) : '—';
  const fontSize = text.length > 9 ? 30 : 34;

  return (
    <div className="card" style={{ padding: '16px 18px', marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 7 }}>Cash collecté</div>
      <div className="tabular" style={{
        fontSize, fontWeight: 700, letterSpacing: '-1px', lineHeight: 1,
        color: k && k.collected > 0 ? 'var(--green)' : 'var(--muted)',
        marginBottom: 11,
      }}>
        {text}
      </div>
      <div
        role="progressbar"
        aria-valuenow={rate} aria-valuemin={0} aria-valuemax={100}
        aria-label="Part du contracté déjà encaissée"
        style={{ height: 4, borderRadius: 2, background: 'var(--surface-2)', overflow: 'hidden' }}
      >
        {/* La piste reste visible à 0 % : c'est elle qui donne l'échelle. */}
        <div style={{
          height: '100%', width: `${barWidth}%`, background: 'var(--green)', borderRadius: 2,
          transition: reduceMotion ? undefined : `width ${HERO_ANIM_MS}ms var(--ease-out)`,
        }} />
      </div>
      {/* Pas de mention de période : cette carte porte sur tous les deals, pas
          sur une fenêtre glissante. La légende garde le contracté même à zéro
          encaissé — sans lui la carte ne dirait plus rien de ce qui reste. */}
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
        {!k ? ''
          : k.contracted === 0 ? 'aucun deal signé'
          : rate >= 100 ? 'intégralement encaissé'
          : `${rate} % de ${fmtEur(k.contracted)} contractés`}
      </div>
    </div>
  );
}

/**
 * Durée du count-up ET de la barre : les deux se terminent ensemble, sinon le
 * chiffre se fige pendant que la barre court encore. 600ms plutôt que la
 * seconde de la spec : sur un écran consulté plusieurs fois par jour, une
 * animation trop longue se subit au lieu de se remarquer.
 */
const HERO_ANIM_MS = 700;

/** Count-up en easing cubique sortant — le chiffre se pose au lieu d'apparaître. */
function useCountUp(target: number, enabled: boolean): number {
  const [value, setValue] = useState(enabled ? 0 : target);

  useEffect(() => {
    if (!enabled) { setValue(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / HERO_ANIM_MS);
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);

  return value;
}

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduce;
}

function MiniKpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '11px 12px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      <div className="tabular" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px', color: color ?? 'var(--ink)' }}>{value}</div>
    </div>
  );
}

export function Pill({ label, tone }: { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }) {
  const map = {
    green: { bg: 'var(--green-soft)', fg: 'var(--green)' },
    amber: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
    red: { bg: 'var(--red-soft)', fg: 'var(--red)' },
    neutral: { bg: 'var(--surface-2)', fg: 'var(--muted)' },
  }[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
      padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', background: map.bg, color: map.fg,
    }}>
      {tone !== 'neutral' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />}
      {label}
    </span>
  );
}

/**
 * Premier écran de tout nouvel utilisateur : il doit vendre ce que la connexion
 * débloque, pas se contenter de constater une absence.
 */
function StripeDisconnected({ isCoach }: { isCoach: boolean }) {
  const bullets = [
    'Chaque euro encaissé rattaché à son deal et à son prospect',
    'Le contenu Instagram ou YouTube qui a produit le lead',
    'Échéances, impayés et relances suivis sans aucune saisie',
  ];
  return (
    <div className="card" style={{ padding: '48px 40px', maxWidth: 620, margin: '32px auto 0' }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-brand-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <Icon name="stripe" size={20} color="var(--accent-brand)" />
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.2px', marginBottom: 10 }}>
        Relie Stripe, et le reste se fait tout seul
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.65, maxWidth: 420, marginBottom: 22 }}>
        Quand un client paie sur Stripe, il apparaît ici automatiquement, rattaché au deal et au contenu qui l&apos;a produit.
      </div>
      {bullets.map(t => (
        <div key={t} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', marginBottom: 11 }}>
          <span style={{ marginTop: 4, flexShrink: 0, display: 'flex' }}>
            <Icon name="check" size={14} color="var(--green)" />
          </span>
          <span style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{t}</span>
        </div>
      ))}
      <a href={isCoach ? '/settings' : '/client/settings'} className="btn-primary-brand"
        style={{ fontSize: 12.5, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
        <Icon name="link" size={13} /> Connecter Stripe
      </a>
    </div>
  );
}

function EmptyDeals({ onCreate }: { onCreate: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 60, paddingBottom: 60 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="circle-dollar-sign" size={20} color="var(--muted)" />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Aucun deal pour l&apos;instant</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 300 }}>
          Un deal apparaît ici dès que tu clôtures un call, ou quand tu crées un lien de paiement à la main.
        </div>
      </div>
      <button className="btn-primary-brand" style={{ fontSize: 12, marginTop: 6 }} onClick={onCreate}>
        Créer un lien de paiement
      </button>
    </div>
  );
}

function subtitleFor(tab: Tab, clients: number, deals: number, orphans: number, relances: number, isCoach: boolean): string {
  if (tab === 'reconcile') return `${orphans} paiement${orphans > 1 ? 's' : ''} sans identifiant Momentum`;
  if (tab === 'relances') return `${relances} relance${relances > 1 ? 's' : ''} en attente`;
  // Les deux chiffres, parce qu'ils diffèrent dès qu'un client rachète — et que
  // « 4 ventes » sur une liste de 3 lignes se lirait comme une erreur.
  const ventes = deals === clients ? '' : ` · ${deals} vente${deals > 1 ? 's' : ''}`;
  return `${isCoach ? 'Mon business · ' : ''}${clients} client${clients > 1 ? 's' : ''}${ventes}`;
}

/** Un deal appelle une relance dès qu'il reste de l'argent à aller chercher. */
function countRelances(deals: DealRow[]): number {
  return deals.filter(d => d.status !== 'paid' && d.status !== 'canceled').length;
}
