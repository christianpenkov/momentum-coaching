'use client';

import { useEffect, useState } from 'react';
import { createClient as createSupabase } from '@/lib/supabase/client';
import ModaleConversationsIg from '@/components/ig/ModaleConversationsIg';

/**
 * L'onglet « Conversations DM » de l'élève.
 *
 * ⚠️ POURQUOI CET ÉCRAN EXISTE. Les notes du coach sont, par décision produit,
 * TOUJOURS visibles par l'élève. Sans un endroit où il voit ses fils, elles lui
 * seraient invisibles — la décision serait inapplicable. Cet écran n'est donc
 * pas un confort, il est la condition d'une décision déjà prise.
 *
 * ⚠️ MÊME PÉRIMÈTRE QUE LE COACH, volontairement : les fils de prospects, pas
 * l'inbox complet. Élargir ici obligerait à stocker et garder tout l'inbox
 * (~550 Mo/an à 40 élèves au lieu de ~170), et ferait tomber la quarantaine de
 * 30 jours qui borne la conservation de sa vie privée. Pour le reste, il a
 * Instagram.
 *
 * ⚠️ Il LIT, il n'annote pas : `annotable={false}`. Les notes viennent du coach.
 */
export default function PageConversationsIg() {
  const [prenomCoach, setPrenomCoach] = useState<string>('Ton coach');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [accorde, setAccorde] = useState<boolean | null>(null);

  useEffect(() => {
    let vivant = true;
    (async () => {
      const supabase = createSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!vivant || !user) { setAccorde(false); return; }
      setProfileId(user.id);

      const r = await fetch('/api/client/ig-dm-consentement');
      if (!vivant) return;
      if (!r.ok) { setAccorde(false); return; }
      const d = await r.json();
      setAccorde(!!d.accorde);
      if (d.coachPrenom) setPrenomCoach(d.coachPrenom);
    })();
    return () => { vivant = false; };
  }, []);

  if (accorde === null) {
    return <div className="page-content" style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>Chargement…</div>;
  }

  if (!accorde) {
    return (
      <div className="page-content" style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', marginBottom: 10 }}>
          Conversations DM
        </h1>
        <div className="card" style={{ padding: '18px 20px', maxWidth: 620, lineHeight: 1.6, fontSize: 13.5 }}>
          <p style={{ margin: '0 0 10px' }}>
            Tu n’as pas encore autorisé <strong>{prenomCoach}</strong> à lire tes conversations
            Instagram DM, donc rien n’est enregistré ici.
          </p>
          <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 12.5 }}>
            En l’activant, seuls tes échanges avec des prospects identifiés lui seront montrés —
            jamais tes conversations personnelles. Tu peux revenir en arrière à tout moment, et les
            messages enregistrés sont alors supprimés.
          </p>
          <a href="/client/settings" className="btn-primary" style={{ fontSize: 12.5, textDecoration: 'none' }}>
            Ouvrir mes réglages
          </a>
        </div>
      </div>
    );
  }

  if (!profileId) return null;

  // La modale occupe l'écran : c'est le même maître-détail que le coach, sans
  // les gestes d'annotation. Réutiliser plutôt que réimplémenter évite d'avoir
  // deux rendus du même fil qui divergent.
  return (
    <ModaleConversationsIg
      profileId={profileId}
      prenomEleve={prenomCoach}
      annotable={false}
      onClose={() => { window.location.href = '/client'; }}
    />
  );
}
