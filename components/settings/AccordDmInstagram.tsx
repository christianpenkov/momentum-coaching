'use client';

import { useEffect, useState } from 'react';

/**
 * L'accord de l'élève : son coach peut-il lire ses conversations Instagram DM ?
 *
 * ⚠️ Le coach est nommé par son PRÉNOM RÉEL, jamais « ton coach ». Il vient de
 * la base (`clients.coach_id → profiles`), donc une plateforme livrée à
 * quelqu'un d'autre affiche le bon nom sans qu'on y touche. Le repli « ton
 * coach » n'existe que pour un profil sans nom — jamais comme libellé par défaut.
 *
 * ⚠️ « Instagram DM » et pas « conversations » tout court : l'élève a AUSSI une
 * messagerie Momentum avec son coach. Un libellé qui ne dit pas laquelle lui
 * fait croire qu'il accorde l'accès à celle qu'il utilise tous les jours.
 *
 * ⚠️ Il n'y a qu'UN interrupteur, parce qu'il n'y a qu'une capacité. La
 * plateforme n'envoie AUCUN message au nom de l'élève : le coach rédige une
 * suggestion, l'élève l'envoie depuis Instagram. Ne pas ajouter un second
 * interrupteur sans rouvrir cette décision (docs/conversations-instagram.md).
 */

type Etat = { accorde: boolean; coachPrenom: string | null; fils: number };

export default function AccordDmInstagram() {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmeRetrait, setConfirmeRetrait] = useState(false);

  useEffect(() => {
    let vivant = true;
    fetch('/api/client/ig-dm-consentement')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (vivant && d) setEtat(d); })
      .catch(() => { /* l'absence du bloc vaut mieux qu'un bloc en erreur */ });
    return () => { vivant = false; };
  }, []);

  if (!etat) return null;

  const coach = etat.coachPrenom || 'Ton coach';

  async function basculer(accorde: boolean) {
    // Retirer supprime des messages : on demande confirmation une fois, et on
    // dit ce qui part. Un « es-tu sûr ? » sans conséquence nommée ne protège rien.
    if (!accorde && !confirmeRetrait) { setConfirmeRetrait(true); return; }
    setEnCours(true);
    setErreur(null);
    try {
      const r = await fetch('/api/client/ig-dm-consentement', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accorde }),
      });
      // ⚠️ fetch ne lève PAS sur un 4xx/5xx : sans ce test, un échec serveur
      // passerait pour un succès et l'interrupteur mentirait.
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Échec');
      setEtat(e => (e ? { ...e, accorde, fils: accorde ? e.fils : 0 } : e));
      setConfirmeRetrait(false);
    } catch (e: any) {
      setErreur(e?.message || 'Impossible de mettre à jour');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div style={{ padding: '0 20px 16px' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 14,
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '13px 15px',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>
            {coach} peut lire mes conversations Instagram DM
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>
            Seulement les échanges avec des prospects identifiés, pour pouvoir les relire
            avec toi en session. Tes conversations personnelles ne lui sont jamais montrées,
            et celles que tu marques « ce n’est pas un lead » dans Pipeline Leads sont
            supprimées.
          </div>
          {etat.accorde && etat.fils > 0 && (
            <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 5 }}>
              {etat.fils} conversation{etat.fils > 1 ? 's' : ''} partagée{etat.fils > 1 ? 's' : ''} avec {coach}.
            </div>
          )}
          {confirmeRetrait && (
            <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 8, lineHeight: 1.5 }}>
              Retirer l’accès <strong>supprime définitivement</strong> les messages déjà
              enregistrés. Touche à nouveau pour confirmer.
            </div>
          )}
          {erreur && (
            <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 8 }}>{erreur}</div>
          )}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={etat.accorde}
          aria-label={`${coach} peut lire mes conversations Instagram DM`}
          disabled={enCours}
          onClick={() => basculer(!etat.accorde)}
          style={{
            width: 42, height: 24, borderRadius: 999, flexShrink: 0, marginTop: 2,
            border: 'none', padding: 0, position: 'relative', cursor: enCours ? 'wait' : 'pointer',
            background: etat.accorde ? 'var(--green)' : 'var(--border)',
            opacity: enCours ? 0.6 : 1,
            transition: 'background 140ms ease',
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: etat.accorde ? 20 : 2,
            width: 20, height: 20, borderRadius: '50%', background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left 140ms ease',
          }} />
        </button>
      </div>
    </div>
  );
}
