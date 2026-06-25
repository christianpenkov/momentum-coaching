'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import type { Resource } from './ResourceModal';

interface Props {
  resource: Resource;
  onClose: () => void;
  onChanged?: () => void;
}

export default function AccessSheet({ resource, onClose, onChanged }: Props) {
  const { clients } = useSupabaseClients();
  const supabase = createClient();
  const validClients = clients.filter(c => c.profile_id);
  const [accessMap, setAccessMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('resource_access')
        .select('client_id, unlocked')
        .eq('resource_id', resource.id);
      const map: Record<string, boolean> = {};
      for (const row of data || []) map[row.client_id] = row.unlocked;
      setAccessMap(map);
      setLoading(false);
    }
    load();
  }, [resource.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function toggleAccess(clientProfileId: string) {
    setToggling(t => ({ ...t, [clientProfileId]: true }));
    const current = accessMap[clientProfileId] ?? false;
    const newVal = !current;

    await supabase.from('resource_access').upsert({
      resource_id: resource.id,
      client_id: clientProfileId,
      unlocked: newVal,
      unlocked_at: newVal ? new Date().toISOString() : null,
    }, { onConflict: 'resource_id,client_id' });

    if (newVal) {
      await supabase.from('resources').update({ is_new: true }).eq('id', resource.id);
    }

    setAccessMap(prev => ({ ...prev, [clientProfileId]: newVal }));
    setToggling(t => ({ ...t, [clientProfileId]: false }));
    onChanged?.();
  }

  function getInitials(name: string): string {
    return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  }

  const AVATAR_COLORS = [
    '#2563eb', '#7c3aed', '#db2777', '#d97706', '#059669', '#0891b2',
  ];

  function avatarColor(idx: number): string {
    return AVATAR_COLORS[idx % AVATAR_COLORS.length];
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1001,
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px',
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          onClick={e => e.stopPropagation()}
          style={{
            width: 420, maxWidth: '94vw',
            background: 'var(--surface)',
            borderRadius: 16,
            boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            padding: '18px 20px 16px',
            borderBottom: '1px solid var(--border)',
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>Accès à la ressource</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          <div style={{ padding: '20px' }}>
            {loading ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>Chargement…</div>
            ) : validClients.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <Icon name="users" size={28} style={{ color: 'var(--muted)', marginBottom: 10 }} />
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>Aucun élève pour le moment.</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                  Clique sur un élève pour lui donner ou retirer l'accès.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                  {validClients.map((client, idx) => {
                    const hasAccess = accessMap[client.profile_id!] ?? false;
                    const isToggling = toggling[client.profile_id!];
                    const color = avatarColor(idx);
                    const initials = client.initials || getInitials(client.name);

                    return (
                      <motion.button
                        key={client.id}
                        type="button"
                        whileTap={{ scale: 0.92 }}
                        onClick={() => !isToggling && toggleAccess(client.profile_id!)}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                          background: 'none', border: 'none', cursor: isToggling ? 'default' : 'pointer',
                          padding: 4,
                          opacity: isToggling ? 0.7 : 1,
                        }}
                      >
                        {/* Avatar avec anneau */}
                        <div style={{ position: 'relative' }}>
                          <div style={{
                            width: 52, height: 52, borderRadius: '50%',
                            background: color,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 16, fontWeight: 700, color: '#fff',
                            filter: hasAccess ? 'none' : 'grayscale(1)',
                            opacity: hasAccess ? 1 : 0.45,
                            boxShadow: hasAccess ? `0 0 0 2.5px var(--surface), 0 0 0 4.5px var(--green)` : 'none',
                            transition: 'opacity 200ms, box-shadow 200ms, filter 200ms',
                          }}>
                            {initials}
                          </div>
                          {/* Badge check */}
                          <AnimatePresence>
                            {hasAccess && (
                              <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                exit={{ scale: 0 }}
                                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                                style={{
                                  position: 'absolute', bottom: -1, right: -1,
                                  width: 18, height: 18, borderRadius: '50%',
                                  background: 'var(--green)',
                                  border: '2px solid var(--surface)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                              >
                                <Icon name="check" size={9} style={{ color: '#fff' }} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        {/* Prénom */}
                        <span style={{
                          fontSize: 11, color: hasAccess ? 'var(--accent)' : 'var(--muted)',
                          fontWeight: hasAccess ? 600 : 400,
                          maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
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
            padding: '14px 20px 18px',
            borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'flex-end',
          }}>
            <button type="button" onClick={onClose} className="btn-primary" style={{ fontSize: 13 }}>
              Terminé
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
