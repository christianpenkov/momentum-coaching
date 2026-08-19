'use client';

import { useState, useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import ModalShell from '@/components/ui/ModalShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { fmtEur } from './types';

/**
 * Création d'un lien de paiement, tout sur un écran.
 *
 * Trois origines possibles, dont « hors pipeline » qui est indispensable : sans
 * lui, l'élève créerait un faux prospect pour encaisser un client venu du
 * bouche-à-oreille, ce qui fausserait tout son pipeline et ses taux de conversion.
 */

type Who = 'prospect' | 'client' | 'free';
type Plan = 'one_shot' | 2 | 3 | 4;

interface LeadOption {
  id: string;
  name: string;
  subtitle: string | null;
  /** Détermine à quelle table l'id appartient — un id de call envoyé comme
   *  igLeadId violerait la clé étrangère. */
  kind: 'lead' | 'prospect' | 'call' | 'link' | 'client';
  avatarUrl?: string | null;
  /** Dernier deal de cette personne — un montant deja vendu change ce qu'on propose. */
  lastDeal?: { amount: number; signedAt: string; status: string } | null;
}

export default function CreateLinkModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const isMobile = useIsMobile();
  const [who, setWho] = useState<Who>('prospect');
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<LeadOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [selected, setSelected] = useState<LeadOption | null>(null);
  const [freeName, setFreeName] = useState('');
  const [amount, setAmount] = useState('');
  const [plan, setPlan] = useState<Plan>('one_shot');
  const [interval, setIntervalUnit] = useState<'month' | 'week'>('month');
  const [auto, setAuto] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; mode: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // Liste chargée dès l'ouverture, sans attendre une saisie : chercher suppose de
  // savoir qui on cherche, alors qu'on veut souvent juste « le prospect d'hier ».
  // Débounce sur la frappe pour ne pas requêter à chaque caractère.
  useEffect(() => {
    if (who === 'free') { setOptions([]); setLoadingOptions(false); return; }
    setLoadingOptions(true);
    const t = setTimeout(() => {
      fetch(`/api/payments/people?q=${encodeURIComponent(query.trim())}&kind=${who}`)
        .then(r => r.ok ? r.json() : { people: [] })
        .then(d => setOptions(d.people ?? []))
        .catch(() => setOptions([]))
        .finally(() => setLoadingOptions(false));
    }, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, who]);

  const amountNum = Number(amount.replace(',', '.'));
  const valid = (who === 'free' ? freeName.trim().length > 1 : !!selected)
    && Number.isFinite(amountNum) && amountNum > 0;

  const count = plan === 'one_shot' ? null : plan;
  const per = count ? amountNum / count : amountNum;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/payments/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          buyerName: who === 'free' ? freeName.trim() : selected!.name,
          amount: amountNum,
          paymentPlan: count ? (auto ? 'installments_auto' : 'installments_manual') : 'one_shot',
          installmentsCount: count,
          installmentInterval: interval,
          // L'id ne va pas dans le même champ selon sa provenance. Le type 'link'
          // (prospect_links) n'a pas de colonne dédiée sur deals : on ne transmet
          // que son pseudo, qui suffit à l'identifier dans les stats.
          igLeadId: selected?.kind === 'lead' ? selected.id : null,
          prospectId: selected?.kind === 'prospect' ? selected.id : null,
          callId: selected?.kind === 'call' ? selected.id : null,
          clientId: selected?.kind === 'client' ? selected.id : null,
          prospectHandle: selected?.kind === 'lead' || selected?.kind === 'link' ? selected.name : null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error === 'Stripe non connecté'
        ? 'Stripe n\'est pas connecté. Va dans Réglages pour le brancher.'
        : d.error || 'Création impossible');
      setResult({ url: d.url ?? d.links?.[0]?.url, mode: d.mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    // Bottom sheet sur mobile comme RapportModal, boîte centrée sur desktop.
    // ModalShell porte déjà le recalage clavier iOS/Android et l'animation.
    <ModalShell onClose={() => !submitting && onClose()} variant={isMobile ? 'sheet' : 'centered'} width={620}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        {isMobile && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 2px', flexShrink: 0 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)' }} />
          </div>
        )}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.1px' }}>Créer un lien de paiement</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Le lien est généré par Stripe.</div>
          </div>
          <button onClick={onClose} disabled={submitting} aria-label="Fermer"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
            <Icon name="x" size={18} color="var(--muted)" />
          </button>
        </div>

        <div style={{ padding: '4px 24px 18px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {result ? (
            <Done result={result} copied={copied} onCopy={copy} onDone={onCreated} />
          ) : (
            <>
              <Block n={1} label="Pour qui ?">
                <div style={{ display: 'flex', gap: 8, marginBottom: 11, flexWrap: 'wrap' }}>
                  {([['prospect', 'Prospect'], ['client', 'Client existant'], ['free', 'Hors pipeline']] as const).map(([k, l]) => (
                    <Chip key={k} on={who === k} onClick={() => { setWho(k); setSelected(null); setQuery(''); }}>{l}</Chip>
                  ))}
                </div>

                {who === 'free' ? (
                  <>
                    <input value={freeName} onChange={e => setFreeName(e.target.value)} placeholder="Prénom et nom"
                      style={inputStyle} autoFocus />
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                      Ce deal comptera dans ton cash, mais pas dans l&apos;attribution par contenu.
                    </div>
                  </>
                ) : selected ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, border: '1.5px solid var(--ink)', borderRadius: 8, padding: '8px 12px', background: 'var(--surface-2)' }}>
                    <Avatar initials={getInitials(selected.name)} avatarUrl={selected.avatarUrl} size={26} seed={selected.id} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{selected.name}</span>
                      {selected.subtitle && <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{selected.subtitle}</span>}
                    </span>
                    {selected.lastDeal && <DealBadge deal={selected.lastDeal} />}
                    <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 2 }}>
                      <Icon name="x" size={15} color="var(--muted)" />
                    </button>
                  </div>
                ) : (
                  <>
                    <input value={query} onChange={e => setQuery(e.target.value)}
                      placeholder={who === 'prospect' ? 'Chercher un prospect…' : 'Chercher un client…'}
                      style={inputStyle} />
                    {/* Hauteur RÉSERVÉE dès l'ouverture, jamais conditionnée au
                        chargement : sinon la liste apparaît après coup, la boîte
                        grandit et se recentre, et le doigt qui visait le champ de
                        recherche atterrit sur un résultat. La zone garde donc sa
                        place même vide ou en cours de chargement. */}
                    <div style={{
                      border: '1px solid var(--border)', borderRadius: 8, marginTop: 6,
                      height: 180, overflowY: 'auto',
                      background: options.length === 0 ? 'var(--surface-2)' : undefined,
                    }}>
                      {options.length === 0 ? (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)', padding: '0 16px', textAlign: 'center' }}>
                          {loadingOptions ? 'Chargement…'
                            : query ? 'Aucun résultat'
                            : who === 'prospect' ? 'Aucun prospect' : 'Aucun client'}
                        </div>
                      ) : (
                        options.map(o => (
                          <button key={o.id} onClick={() => { setSelected(o); setQuery(''); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                            <Avatar initials={getInitials(o.name)} avatarUrl={o.avatarUrl} size={24} seed={o.id} />
                            <span style={{ minWidth: 0, flex: 1 }}>
                              <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{o.name}</span>
                              {o.subtitle && <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{o.subtitle}</span>}
                            </span>
                            {o.lastDeal && <DealBadge deal={o.lastDeal} />}
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </Block>

              <Block n={2} label="Montant du deal">
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px', width: 210, background: 'var(--surface)' }}>
                  <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                    inputMode="decimal" placeholder="0"
                    className="tabular"
                    style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 19, fontWeight: 700, letterSpacing: '-0.4px', width: '100%', fontFamily: 'inherit', color: 'var(--ink)' }} />
                  <span style={{ fontSize: 15, color: 'var(--faint)', flexShrink: 0 }}>€</span>
                </div>
              </Block>

              <Block n={3} label="Plan de paiement" last>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>En combien de fois ?</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                  {([['one_shot', 'Comptant'], [2, '2×'], [3, '3×'], [4, '4×']] as const).map(([v, l]) => (
                    <Chip key={String(v)} on={plan === v} onClick={() => setPlan(v as Plan)}>{l}</Chip>
                  ))}
                </div>

                {count && (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>Tous les combien ?</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                      <Chip on={interval === 'month'} onClick={() => setIntervalUnit('month')}>Mensuel</Chip>
                      <Chip on={interval === 'week'} onClick={() => setIntervalUnit('week')}>Hebdomadaire</Chip>
                    </div>

                    {/* Le choix que le prototype omettait : c'est lui qui décide si
                        l'élève devra relancer, ou si Stripe encaisse tout seul. */}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>Comment le client paie-t-il ?</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                      <Chip on={auto} onClick={() => setAuto(true)}>Prélèvement auto</Chip>
                      <Chip on={!auto} onClick={() => setAuto(false)}>Un lien par échéance</Chip>
                    </div>
                  </>
                )}

                {amountNum > 0 && (
                  <div style={{ padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, maxWidth: 440 }}>
                    {count
                      ? <>{count} × {fmtEur(per)} · {interval === 'month' ? 'tous les mois' : 'toutes les semaines'}<br />
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {auto
                              ? 'Le client saisit sa carte une fois, Stripe prélève le reste et s\'arrête après la dernière échéance.'
                              : 'Tu envoies un lien à chaque échéance. Le client ne s\'engage sur rien de récurrent.'}
                          </span></>
                      : <>{fmtEur(amountNum)} en une fois<br />
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Le client paie une seule fois.</span></>}
                  </div>
                )}
              </Block>

              {error && <div style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 12 }}>{error}</div>}
            </>
          )}
        </div>

        {!result && (
          <div style={{ padding: '14px 24px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
            <button className="btn-primary-brand" style={{ fontSize: 12.5, opacity: valid && !submitting ? 1 : .5 }}
              disabled={!valid || submitting} onClick={submit}>
              {submitting ? 'Création…' : 'Générer le lien'}
            </button>
            <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={onClose} disabled={submitting}>Annuler</button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function Done({ result, copied, onCopy, onDone }: { result: { url: string; mode: string }; copied: boolean; onCopy: () => void; onDone: () => void }) {
  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--green-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={17} color="var(--green)" />
        </span>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Lien prêt à envoyer</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', marginBottom: 14 }}>
        <Icon name="link" size={15} color="var(--accent-brand)" />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {result.url.replace(/^https?:\/\//, '')}
        </span>
        <button className="btn-primary-brand" onClick={onCopy}
          style={{ fontSize: 12, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copié' : 'Copier'}
        </button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 20 }}>
        {result.mode === 'manual'
          ? 'Les liens des échéances suivantes t\'attendent dans l\'onglet Relances, à leur date.'
          : 'Envoie-le à ton client. Le paiement se rattachera automatiquement à ce deal.'}
      </div>

      <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={onDone}>Terminé</button>
    </div>
  );
}

/**
 * Deal existant : « 3 000 EUR · 15 juin » avec l'etat du paiement.
 *
 * Trois etats visuellement distincts, parce que la liste est triee dessus :
 * impaye (ambre, il reste de l'argent a aller chercher), paye (vert, un upsell
 * se propose a quelqu'un qui a deja paye), et rien du tout.
 */
function DealBadge({ deal }: { deal: { amount: number; signedAt: string; status: string } }) {
  const paid = deal.status === 'paid';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
      fontSize: 10.5, fontWeight: 600, padding: '3px 8px', borderRadius: 999,
      background: paid ? 'var(--green-soft)' : 'var(--amber-soft)',
      color: paid ? 'var(--green)' : 'var(--amber)',
      whiteSpace: 'nowrap',
    }}>
      {fmtEur(deal.amount)} · {new Date(deal.signedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
      {paid ? ' · payé' : ' · impayé'}
    </span>
  );
}

function Block({ n, label, children, last }: { n: number; label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ padding: '14px 0', borderBottom: last ? 'none' : '1px solid var(--border-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 9 }}>
        <span style={{
          width: 20, height: 20, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)',
          fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{n}</span>
        <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
      </div>
      <div style={{ paddingLeft: 31 }}>{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      borderRadius: 999, padding: '6px 13px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
      border: `1px solid ${on ? 'var(--accent-brand)' : 'var(--border)'}`,
      background: on ? 'var(--accent-brand)' : 'var(--surface)',
      color: on ? '#fff' : 'var(--ink-2)', fontWeight: on ? 600 : 400, whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none',
};
