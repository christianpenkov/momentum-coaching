'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function InviteCallbackPage() {
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    async function run() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const clientId = user.user_metadata?.client_id as string | undefined;
      if (!clientId) { router.push('/client'); return; }

      await supabase.from('profiles').upsert({
        id: user.id,
        role: 'client',
        full_name: user.user_metadata?.full_name || null,
      });

      const { data: clientRow } = await supabase
        .from('clients')
        .update({ profile_id: user.id })
        .eq('id', clientId)
        .is('profile_id', null)
        .select('coach_id')
        .single();

      if (clientRow?.coach_id) {
        await fetch('/api/client/grant-default-resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coach_id: clientRow.coach_id }),
        });
      }

      router.push('/client');
    }
    run().catch(() => setError('Une erreur est survenue.'));
  }, [router]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ fontSize: 14, color: error ? 'var(--red)' : 'var(--muted)' }}>
        {error || 'Configuration de ton espace…'}
      </div>
    </div>
  );
}
