'use client';

import { useEffect, useState } from 'react';
import { createClient as createSupabase } from '@/lib/supabase/client';
import ConversationsIg from '@/components/ig/ConversationsIg';

/**
 * L'onglet « Conversations DM » de l'élève — une PAGE, pas une modale.
 *
 * ⚠️ La première version rendait ici la modale du coach, `ModalShell` compris :
 * l'élève arrivait sur une boîte flottante posée sur du vide, avec une croix qui
 * ne fermait rien puisqu'il n'y avait rien derrière. Le maître-détail vit
 * désormais dans `ConversationsIg`, qui ne décide pas de son enveloppe.
 *
 * ⚠️ POURQUOI CET ÉCRAN EXISTE. Les notes du coach sont, par décision produit,
 * toujours visibles par l'élève. Sans un endroit où il voit ses fils, elles lui
 * seraient invisibles — la décision serait inapplicable. Cet écran n'est pas un
 * confort, il est la condition d'un choix déjà fait.
 *
 * ⚠️ MÊME PÉRIMÈTRE QUE LE COACH : les fils de prospects, pas l'inbox complet.
 * L'élargir obligerait à stocker tout l'inbox (~550 Mo/an à 40 élèves au lieu de
 * ~170) et ferait tomber la quarantaine de 30 jours qui borne la conservation de
 * sa vie privée. Pour le reste, il a Instagram.
 */

type Etat = { accorde: boolean; coachPrenom: string | null; fils: number } | null;

export default function PageConversationsIg() {
  const [etat, setEtat] = useState<Etat>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [echec, setEchec] = useState(false);

  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const supabase = createSupabase();
        const { data: { user } } = await supabase.auth.getUser();
        if (!vivant || !user) { setEchec(true); return; }
        setProfileId(user.id);

        const r = await fetch('/api/client/ig-dm-consentement');
        if (!vivant) return;
        // fetch ne lève pas sur un 4xx : sans ce test, un échec serveur
        // passerait pour « pas d'accord », ce qui est un message faux.
        if (!r.ok) { setEchec(true); return; }
        setEtat(await r.json());
      } catch {
        if (vivant) setEchec(true);
      }
    })();
    return () => { vivant = false; };
  }, []);

  const coach = etat?.coachPrenom || 'Ton coach';

  return (
    <div className="page-content">
      {/* Convention du projet : `page-header` / `page-title` / `page-sub`, comme
          toutes les autres pages élève. Des styles en ligne auraient donné un
          titre proche mais jamais identique — et c'est ce genre d'écart qui fait
          qu'une application « sent » le patchwork. */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Conversations DM</h1>
          <p className="page-sub" style={{ maxWidth: '68ch' }}>
            {etat?.accorde
              ? `Tes échanges Instagram avec des prospects identifiés. ${coach} les voit aussi et peut y laisser des notes.`
              : 'Tes échanges Instagram avec des prospects identifiés.'}
          </p>
        </div>
      </div>

      {echec && (
        <div role="alert" className="card" style={{ padding: '16px 18px', fontSize: 13, maxWidth: 620 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Chargement impossible</div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.55 }}>
            La page n’a pas pu récupérer tes conversations. Recharge la page ; si le problème
            persiste, préviens {coach}.
          </div>
        </div>
      )}

      {!echec && etat === null && (
        <div className="card" style={{ padding: '16px 18px', fontSize: 12.5, color: 'var(--muted)' }} aria-busy="true">
          Chargement…
        </div>
      )}

      {/* État vide qui explique et propose une action, plutôt qu'un écran blanc. */}
      {!echec && etat && !etat.accorde && (
        <div className="card" style={{ padding: '20px 22px', maxWidth: 620, lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 10px', fontSize: 13.5 }}>
            Tu n’as pas encore autorisé <strong>{coach}</strong> à lire tes conversations
            Instagram DM, donc rien n’est enregistré ici.
          </p>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 12.5 }}>
            En l’activant, seuls tes échanges avec des prospects identifiés lui seront montrés,
            jamais tes conversations personnelles. Tu peux revenir en arrière à tout moment, et
            les messages enregistrés sont alors supprimés.
          </p>
          <a href="/client/settings" className="btn-primary"
             style={{ fontSize: 12.5, textDecoration: 'none', display: 'inline-block' }}>
            Ouvrir mes réglages
          </a>
        </div>
      )}

      {!echec && etat?.accorde && profileId && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <ConversationsIg
            profileId={profileId}
            prenomEleve={coach}
            annotable={false}
            titre="Mes conversations"
            // Pleine hauteur utile : c'est une page, il n'y a rien derrière à
            // laisser voir. On réserve la place de l'en-tête et des marges.
            hauteur="calc(100dvh - 210px)"
          />
        </div>
      )}
    </div>
  );
}
