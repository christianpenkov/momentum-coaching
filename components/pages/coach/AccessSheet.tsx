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
}

export default function AccessSheet({ resource, onClose, onChanged }: Props) {
  const { clients, loading: clientsLoading } = useSupabaseClients();
  const supabase = createClient();
  const validClients = clients.filter(c => c.profile_id);

  const [initialState, setInitialState] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  async function handleSave() {
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
      }, { onConflict: 'resource_id,client_id' });
      if (newVal) {
        await supabase.from('resources').update({ is_new: true }).eq('id', resource.id);
      }
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

      {/* Body */}
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
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              Clique sur un élève pour modifier son accès, puis valide.
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
                        background: color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 17, fontWeight: 700, color: '#fff',
                        filter: hasAccess ? 'none' : 'grayscale(1)',
                        opacity: hasAccess ? 1 : 0.45,
                        boxShadow: hasAccess ? `0 0 0 2.5px var(--surface), 0 0 0 4.5px var(--green)` : 'none',
                        transition: 'opacity 200ms, box-shadow 200ms, filter 200ms',
                      }}>
                        {initials}
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

      {/* Footer */}
      <div style={{
        padding: '16px 24px 20px',
        borderTop: '1px solid var(--border)',
        display: 'flex', justifyContent: 'flex-end', gap: 8,
        flexShrink: 0,
      }}>
        <button type="button" onClick={onClose} className="btn-ghost" style={{ fontSize: 13 }}>
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading || clientsLoading}
          className="btn-primary"
          style={{ fontSize: 13, minWidth: 90, opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'Enregistrement…' : hasDraftChanges ? 'Valider' : 'Fermer'}
        </button>
      </div>
    </ModalShell>
  );
}
