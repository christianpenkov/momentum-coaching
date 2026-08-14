'use client';

import { useEffect, useState } from 'react';
import ModalShell from '@/components/ui/ModalShell';

interface ShortioDomainOption { id: number | string; hostname: string; }
interface AffectedLm { lmId: string; lmName: string; platform: 'ig' | 'yt'; currentUrl: string; }
interface RegeneratedLm { lmId: string; lmName: string; platform: 'ig' | 'yt'; newUrl: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  profileId: string;
  currentDomainId: number | string | null;
  onSelected: (domain: ShortioDomainOption) => void;
}

// Sélecteur de domaine Short.io — affiché quand le compte a plusieurs domaines,
// soit juste après la connexion de la clé (needsDomainSelection), soit via le bouton
// "Changer de domaine" depuis Réglages (toujours visible — l'appel API qui détermine
// s'il y a effectivement plusieurs domaines ne se fait qu'à l'ouverture de ce modal,
// pas au chargement de la page). Écrit le choix dans integrations.metadata via
// PATCH /api/shortio/domain-select, sans jamais toucher à la clé API.
//
// Lors d'un vrai changement (un domaine était déjà actif), les liens bio des lead
// magnets sont régénérés automatiquement sur le nouveau domaine côté serveur — l'ancien
// lien Short.io n'est jamais touché et continue de rediriger. Comme Instagram et YouTube
// n'exposent aucune API d'écriture sur le champ bio/description, remplacer le lien dans
// la bio reste un geste manuel — ce composant l'explique avant de laisser confirmer.
export default function ShortioDomainPicker({ open, onClose, profileId, currentDomainId, onSelected }: Props) {
  const [domains, setDomains] = useState<ShortioDomainOption[]>([]);
  const [selected, setSelected] = useState<string>(currentDomainId != null ? String(currentDomainId) : '');
  const [affectedLm, setAffectedLm] = useState<AffectedLm[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ domain: string; regenerated: RegeneratedLm[] } | null>(null);

  const isChange = currentDomainId != null;

  useEffect(() => {
    if (!open) return;
    setSelected(currentDomainId != null ? String(currentDomainId) : '');
    setConfirmed(false);
    setResult(null);
    setError(null);
    setDomains([]);
    setAffectedLm([]);
    setLoading(true);

    const fetches: Promise<any>[] = [
      fetch(`/api/shortio/domains?profileId=${profileId}`).then(r => r.json()).catch(() => null),
    ];
    if (isChange) {
      fetches.push(fetch(`/api/shortio/domain-select?profileId=${profileId}`).then(r => r.json()).catch(() => null));
    }

    Promise.all(fetches).then(([domainsRes, affectedRes]) => {
      if (domainsRes?.domains?.length) setDomains(domainsRes.domains);
      if (affectedRes?.affected) setAffectedLm(affectedRes.affected);
    }).finally(() => setLoading(false));
  }, [open, profileId, currentDomainId, isChange]);

  if (!open) return null;

  const selectedChanged = selected !== '' && String(currentDomainId ?? '') !== selected;
  const needsConfirmCheckbox = isChange && selectedChanged && affectedLm.length > 0;
  const canConfirm = !!selected && (!needsConfirmCheckbox || confirmed) && !saving;
  const onlyOneDomain = !loading && domains.length <= 1;

  async function confirm() {
    const domain = domains.find(d => String(d.id) === selected);
    if (!domain) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/shortio/domain-select', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, domainId: domain.id, hostname: domain.hostname }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Erreur lors de la sauvegarde');
        setSaving(false);
        return;
      }
      onSelected(domain);
      setSaving(false);
      if (data.regenerated?.length > 0) {
        setResult({ domain: domain.hostname, regenerated: data.regenerated });
      } else {
        onClose();
      }
    } catch (e: any) {
      setError(e?.message || 'Erreur réseau');
      setSaving(false);
    }
  }

  if (result) {
    return (
      <ModalShell onClose={onClose} width={420}>
        <div style={{ padding: '24px 24px 20px' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Domaine mis à jour ✓</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
            Voici tes nouveaux liens — remplace l'ancien par le nouveau dans ta bio Instagram/YouTube dès que possible.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, maxHeight: 260, overflowY: 'auto' }}>
            {result.regenerated.map((r, i) => (
              <div key={i} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{r.lmName} — {r.platform === 'ig' ? 'Bio Instagram' : 'Bio YouTube'}</div>
                <div style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{r.newUrl}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-primary-brand" style={{ fontSize: 12 }} type="button" onClick={() => { setResult(null); onClose(); }}>
              J'ai noté, fermer
            </button>
          </div>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} width={420}>
      <div style={{ padding: '24px 24px 20px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>
          {isChange ? 'Changer de domaine Short.io' : 'Choisis ton domaine Short.io'}
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--muted)', margin: '14px 0' }}>Chargement…</div>
        ) : onlyOneDomain ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
              Un seul domaine est disponible sur ton compte Short.io — il n'y a rien d'autre à choisir pour l'instant.
            </div>
            {domains.length === 1 && (
              <div style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
                {domains[0].hostname}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn-primary-brand" style={{ fontSize: 12 }} type="button" onClick={onClose}>Fermer</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
              {isChange
                ? 'Choisis le nouveau domaine à utiliser pour tous les futurs liens (bio, description, DM, lead magnets, Calendly).'
                : 'Ton compte Short.io a plusieurs domaines — choisis celui à utiliser pour tous les liens (bio, description, DM, lead magnets, Calendly).'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {domains.map(d => (
                <label key={String(d.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: `1px solid ${selected === String(d.id) ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input type="radio" name="shortio-domain" checked={selected === String(d.id)} onChange={() => { setSelected(String(d.id)); setConfirmed(false); }} />
                  {d.hostname}
                </label>
              ))}
            </div>

            {!isChange && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 6 }}>
                Ce domaine sera utilisé pour tous tes futurs liens. Si tu en changes plus tard, les liens déjà collés dans tes bios Instagram/YouTube ne seront pas mis à jour automatiquement — Instagram et YouTube ne permettent pas ça.
              </div>
            )}

            {needsConfirmCheckbox && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 6 }}>
                  {affectedLm.length} lien{affectedLm.length > 1 ? 's' : ''} bio à mettre à jour manuellement après :
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, maxHeight: 160, overflowY: 'auto' }}>
                  {affectedLm.map((a, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6 }}>
                      {a.lmName} — {a.platform === 'ig' ? 'Bio Instagram' : 'Bio YouTube'}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                  Un nouveau lien sera généré automatiquement pour chacun sur le nouveau domaine — l'ancien continuera de fonctionner, mais tu devras coller le nouveau lien toi-même dans Instagram/YouTube. Le lien bio Calendly, lui, se met à jour tout seul au prochain passage dans Paramètres.
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
                  J'ai compris que je dois mettre à jour ces liens moi-même dans mes bios Instagram/YouTube
                </label>
              </div>
            )}

            {error && (
              <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10, padding: '7px 10px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5' }}>
                ✗ {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={onClose} disabled={saving}>Annuler</button>
              <button className="btn-primary-brand" style={{ fontSize: 12 }} type="button" onClick={confirm} disabled={!canConfirm}>
                {saving ? 'Sauvegarde…' : 'Confirmer'}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
