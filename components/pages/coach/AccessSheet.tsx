'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '@/components/ui/Icon';
import ModalShell from '@/components/ui/ModalShell';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import type { Resource } from './ResourceModal';

interface Props {
  resource: Resource;
  onClose: () => void;
  onChanged?: () => void;
  onDefaultChanged?: (resourceId: string, isDefault: boolean) => void;
}

type ConfirmData = {
  gaining: string[];
  losing: string[];
};

export default function AccessSheet({ resource, onClose, onChanged, onDefaultChanged }: Props) {
  const { clients, loading: clientsLoading } = useSupabaseClients();
  const supabase = createClient();
  const validClients = clients.filter(c => c.profile_id);

  const [initialState, setInitialState] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDefault, setIsDefault] = useState(resource.is_default);

  async function handleToggleDefault() {
    const next = !isDefault;
    setIsDefault(next);
    await supabase.from('resources').update({ is_default: next }).eq('id', resource.id);
    onDefaultChanged?.(resource.id, next);
  }

  // Écran de confirmation
  const [confirmData, setConfirmData] = useState<ConfirmData | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('resource_access')
        .select('client_id, unlocked')
        .eq('resource_id', resource.id);
      const map: Record<string, boolean> = {};
      for (const row of data || []) map[row.client_id] = row.unlocked;
      setInitialState(map);
      setDraft(map);
      setLoading(false);
    }
    load();
  }, [resource.id]);

  function toggleDraft(clientProfileId: string) {
    setDraft(prev => ({ ...prev, [clientProfileId]: !(prev[clientProfileId] ?? false) }));
  }

  function selectAll() {
    const next: Record<string, boolean> = {};
    for (const c of validClients) if (c.profile_id) next[c.profile_id] = true;
    setDraft(next);
  }

  function deselectAll() {
    const next: Record<string, boolean> = {};
    for (const c of validClients) if (c.profile_id) next[c.profile_id] = false;
    setDraft(next);
  }

  const allSelected = validClients.length > 0 && validClients.every(c => draft[c.profile_id!] ?? false);

  function handleRequestSave() {
    const changed = validClients.filter(c => {
      const id = c.profile_id!;
      return (draft[id] ?? false) !== (initialState[id] ?? false);
    });
    const gaining = changed.filter(c => draft[c.profile_id!] ?? false).map(c => c.name.split(' ')[0]);
    const losing = changed.filter(c => !(draft[c.profile_id!] ?? false)).map(c => c.name.split(' ')[0]);
    setConfirmData({ gaining, losing });
    setConfirmed(false);
  }

  async function handleConfirmSave() {
    setSaving(true);

    const changed = validClients.filter(c => {
      const id = c.profile_id!;
      return (draft[id] ?? false) !== (initialState[id] ?? false);
    });

    await Promise.all(changed.map(async c => {
      const id = c.profile_id!;
      const newVal = draft[id] ?? false;
      await supabase.from('resource_access').upsert({
        resource_id: resource.id,
        client_id: id,
        unlocked: newVal,
        unlocked_at: newVal ? new Date().toISOString() : null,
        seen_at: null,
      }, { onConflict: 'resource_id,client_id' });
    }));

    setSaving(false);
    onChanged?.();
    onClose();
  }

  function getInitials(name: string): string {
    return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  }

  const AVATAR_COLORS = [
    '#2563eb', '#7c3aed', '#db2777', '#d97706', '#059669', '#0891b2',
  ];
  function avatarColor(idx: number): string { return AVATAR_COLORS[idx % AVATAR_COLORS.length]; }

  const hasDraftChanges = validClients.some(c => {
    const id = c.profile_id!;
    return (draft[id] ?? false) !== (initialState[id] ?? false);
  });

  return (
    <ModalShell onClose={onClose} width={560}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        padding: '20px 24px 18px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>Accès à la ressource</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            « {resource.title} »
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, borderRadius: 6, lineHeight: 0, flexShrink: 0 }}
        >
          <Icon name="x" size={18} />
        </button>
      </div>

      {/* Toggle Ressource par défaut — même comportement/texte que ResourceModal.tsx */}
      <div style={{ padding: '14px 24px 0', flexShrink: 0 }}>
        <button
          type="button"
          onClick={handleToggleDefault}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', borderRadius: 10,
            background: isDefault ? 'rgba(5,150,105,0.07)' : 'var(--surface-2)',
            border: `1px solid ${isDefault ? 'rgba(5,150,105,0.25)' : 'var(--border)'}`,
            cursor: 'pointer', textAlign: 'left', width: '100%',
            transition: 'background 150ms, border-color 150ms',
          }}
        >
          <div style={{
            width: 32, height: 18, borderRadius: 9, flexShrink: 0,
            background: isDefault ? 'var(--green)' : 'var(--border)',
            position: 'relative', transition: 'background 200ms',
          }}>
            <div style={{
              position: 'absolute', top: 2, left: isDefault ? 16 : 2,
              width: 14, height: 14, borderRadius: '50%', background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              transition: 'left 200ms',
            }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: isDefault ? 'var(--green)' : 'var(--accent)' }}>
              Ressource par défaut
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.4 }}>
              Donnée automatiquement à tout nouvel élève qui rejoint.
              <br />
              Reste active même si tu retires l'accès à un élève existant — seul ce toggle contrôle les futurs élèves.
            </div>
          </div>
        </button>
      </div>

      <AnimatePresence mode="wait">
        {/* Écran liste élèves */}
        {!confirmData && (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
          >
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              {(loading || clientsLoading) ? (
                <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '32px 0' }}>Chargement…</div>
              ) : validClients.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <Icon name="users" size={28} style={{ color: 'var(--muted)', marginBottom: 10 }} />
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>Aucun élève pour le moment.</div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      Clique sur un élève pour modifier son accès, puis valide.
                    </div>
                    <button
                      type="button"
                      onClick={allSelected ? deselectAll : selectAll}
                      style={{
                        fontSize: 11, fontWeight: 600,
                        color: allSelected ? 'var(--red)' : 'var(--accent)',
                        background: allSelected ? 'rgba(205,91,63,0.08)' : 'rgba(var(--accent-rgb, 99,102,241),0.08)',
                        border: `1px solid ${allSelected ? 'rgba(205,91,63,0.25)' : 'var(--border)'}`,
                        borderRadius: 6, padding: '4px 10px',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                        flexShrink: 0, whiteSpace: 'nowrap',
                      }}
                    >
                      <Icon name={allSelected ? 'x' : 'users'} size={11} />
                      {allSelected ? 'Tout désélectionner' : 'Tout le monde'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
                    {validClients.map((client, idx) => {
                      const hasAccess = draft[client.profile_id!] ?? false;
                      const color = avatarColor(idx);
                      const initials = client.initials || getInitials(client.name);

                      return (
                        <motion.button
                          key={client.id}
                          type="button"
                          whileTap={{ scale: 0.92 }}
                          onClick={() => toggleDraft(client.profile_id!)}
                          style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                            background: 'none', border: 'none', cursor: 'pointer',
                            padding: 6,
                          }}
                        >
                          <div style={{ position: 'relative' }}>
                            <div style={{
                              width: 56, height: 56, borderRadius: '50%',
                              background: client.avatar_url ? undefined : color,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 17, fontWeight: 700, color: '#fff',
                              overflow: 'hidden',
                              filter: hasAccess ? 'none' : 'grayscale(1)',
                              opacity: hasAccess ? 1 : 0.45,
                              boxShadow: hasAccess ? `0 0 0 2.5px var(--surface), 0 0 0 4.5px var(--green)` : 'none',
                              transition: 'opacity 200ms, box-shadow 200ms, filter 200ms',
                            }}>
                              {client.avatar_url
                                ? <img src={client.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : initials}
                            </div>
                            <AnimatePresence>
                              {hasAccess && (
                                <motion.div
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  exit={{ scale: 0 }}
                                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                                  style={{
                                    position: 'absolute', bottom: -1, right: -1,
                                    width: 20, height: 20, borderRadius: '50%',
                                    background: 'var(--green)',
                                    border: '2px solid var(--surface)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}
                                >
                                  <Icon name="check" size={10} style={{ color: '#fff' }} />
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                          <span style={{
                            fontSize: 11, color: hasAccess ? 'var(--accent)' : 'var(--muted)',
                            fontWeight: hasAccess ? 600 : 400,
                            maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            transition: 'color 200ms',
                          }}>
                            {client.name.split(' ')[0]}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div style={{
              padding: '16px 24px 20px',
              borderTop: '1px solid var(--border)',
              display: 'flex', justifyContent: 'flex-end', gap: 8,
              flexShrink: 0,
            }}>
              {hasDraftChanges ? (
                <>
                  <button type="button" onClick={onClose} className="btn-ghost" style={{ fontSize: 13 }}>
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleRequestSave}
                    disabled={loading || clientsLoading}
                    className="btn-primary-brand"
                    style={{ fontSize: 13, minWidth: 90, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    Valider
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-primary-brand"
                  style={{ fontSize: 13, minWidth: 90, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  Fermer
                </button>
              )}
            </div>
          </motion.div>
        )}

        {/* Écran confirmation */}
        {confirmData && (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.15 }}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
          >
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
                Vérifie les changements avant d'enregistrer.
              </div>

              {confirmData.gaining.length > 0 && (
                <div style={{
                  padding: '14px 16px', borderRadius: 10,
                  background: 'rgba(5,150,105,0.07)', border: '1px solid rgba(5,150,105,0.18)',
                  marginBottom: 12,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="check" size={12} style={{ color: 'var(--green)' }} />
                    Auront désormais accès
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--accent)' }}>
                    {confirmData.gaining.join(', ')}
                  </div>
                </div>
              )}

              {confirmData.losing.length > 0 && (
                <div style={{
                  padding: '14px 16px', borderRadius: 10,
                  background: 'rgba(205,91,63,0.07)', border: '1px solid rgba(205,91,63,0.18)',
                  marginBottom: 12,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="x" size={12} style={{ color: 'var(--red)' }} />
                    N'auront plus accès
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--accent)' }}>
                    {confirmData.losing.join(', ')}
                  </div>
                </div>
              )}

              {/* Case à cocher obligatoire */}
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                marginTop: 20, cursor: 'pointer',
                padding: '12px 14px', borderRadius: 8,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
              }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={e => setConfirmed(e.target.checked)}
                  style={{ marginTop: 1, width: 15, height: 15, cursor: 'pointer', flexShrink: 0, accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: 13, color: 'var(--accent)', lineHeight: 1.4 }}>
                  Je confirme ces changements d'accès
                </span>
              </label>
            </div>

            <div style={{
              padding: '16px 24px 20px',
              borderTop: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', gap: 8,
              flexShrink: 0,
            }}>
              <button
                type="button"
                onClick={() => setConfirmData(null)}
                className="btn-ghost"
                style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <Icon name="arrowR" size={13} style={{ transform: 'rotate(180deg)' }} />
                Retour
              </button>
              <button
                type="button"
                onClick={handleConfirmSave}
                disabled={saving || !confirmed}
                className="btn-primary-brand"
                style={{
                  fontSize: 13, minWidth: 120,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  opacity: !confirmed ? 0.5 : 1,
                }}
              >
                {saving ? 'Enregistrement…' : 'Confirmer'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalShell>
  );
}
