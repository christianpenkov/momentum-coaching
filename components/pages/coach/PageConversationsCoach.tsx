'use client';

import { useEffect, useState } from 'react';
import { createClient as createSupabase } from '@/lib/supabase/client';
import ConversationsIg from '@/components/ig/ConversationsIg';

/**
 * « Conversations DM » du coach — SES propres fils Instagram, pas ceux de ses
 * élèves (ceux-là s'ouvrent depuis la fiche client).
 *
 * ⚠️ Toute la collecte existait déjà (migration `20260908200000_conversations_ig_du_coach`) :
 * la garde d'écriture `collecte_dm_ig_autorisee` accepte le rôle coach sans
 * consentement, puisqu'il n'y a personne avec qui partager. Cet écran ne fait que
 * rendre visible ce qui était déjà stocké — et jusqu'ici lisible seulement fil par
 * fil, depuis une fiche du Pipeline.
 *
 * ⚠️ Pas d'écran de consentement, contrairement à `PageConversationsIg` de l'élève.
 * Celui-ci aurait bloqué le coach : la route de consentement lit `clients`, où le
 * coach n'a pas de ligne, et répond donc « non accordé » pour toujours.
 *
 * ⚠️ `annotable={false}`, et ce n'est pas un oubli. Annoter est le geste du coach
 * sur le fil d'un ÉLÈVE, et `/api/coach/ig-note` le vérifie par `clients.coach_id`.
 * Sur ses propres fils, un champ de note ne mènerait qu'à un 403 — et personne
 * d'autre ne le lirait.
 *
 * ⚠️ Même périmètre que les autres écrans : les fils de PROSPECTS identifiés
 * (`instagram_leads`), pas l'inbox complet. Pour le reste, il a Instagram.
 */

type Etat =
  | { phase: 'chargement' }
  | { phase: 'echec' }
  | { phase: 'non_connecte' }
  | { phase: 'pret'; profileId: string; prenom: string };

export default function PageConversationsCoach() {
  const [etat, setEtat] = useState<Etat>({ phase: 'chargement' });

  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const supabase = createSupabase();
        const { data: { user } } = await supabase.auth.getUser();
        if (!vivant) return;
        if (!user) { setEtat({ phase: 'echec' }); return; }

        // ⚠️ `id` seulement, jamais le jeton : on veut savoir SI Instagram est
        // connecté, pas avec quoi. Et une erreur de lecture n'est PAS « non
        // connecté » — l'afficher enverrait le coach reconnecter un compte qui
        // l'est déjà (docs/requetes-qui-echouent-en-silence.md).
        const [{ data: integ, error }, { data: profil }] = await Promise.all([
          supabase.from('integrations').select('id')
            .eq('profile_id', user.id).eq('provider', 'instagram').maybeSingle(),
          supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
        ]);
        if (!vivant) return;
        if (error) { setEtat({ phase: 'echec' }); return; }
        if (!integ) { setEtat({ phase: 'non_connecte' }); return; }

        const prenom = (profil?.full_name || '').trim().split(/\s+/)[0] || 'Toi';
        setEtat({ phase: 'pret', profileId: user.id, prenom });
      } catch {
        if (vivant) setEtat({ phase: 'echec' });
      }
    })();
    return () => { vivant = false; };
  }, []);

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Conversations DM</h1>
          <p className="page-sub" style={{ maxWidth: '68ch' }}>
            Tes échanges Instagram avec tes prospects identifiés.
          </p>
        </div>
      </div>

      {etat.phase === 'chargement' && (
        <div className="card" style={{ padding: '16px 18px', fontSize: 12.5, color: 'var(--muted)' }} aria-busy="true">
          Chargement…
        </div>
      )}

      {etat.phase === 'echec' && (
        <div role="alert" className="card" style={{ padding: '16px 18px', fontSize: 13, maxWidth: 620 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Chargement impossible</div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.55 }}>
            La page n’a pas pu récupérer tes conversations. Recharge la page.
          </div>
        </div>
      )}

      {etat.phase === 'non_connecte' && (
        <div className="card" style={{ padding: '20px 22px', maxWidth: 620, lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 10px', fontSize: 13.5 }}>
            Ton compte Instagram n’est pas encore connecté, donc aucune conversation n’est enregistrée.
          </p>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 12.5 }}>
            Une fois connecté, tes échanges avec tes prospects apparaissent ici, ainsi que ceux des
            douze derniers mois. Tes conversations personnelles, elles, ne sont jamais affichées.
          </p>
          <a href="/settings" className="btn-primary"
             style={{ fontSize: 12.5, textDecoration: 'none', display: 'inline-block' }}>
            Connecter Instagram
          </a>
        </div>
      )}

      {etat.phase === 'pret' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <ConversationsIg
            profileId={etat.profileId}
            // Aucune note ne peut exister sur ses propres fils (voir plus haut) :
            // ce nom n'apparaît donc nulle part, il satisfait la signature.
            prenomEleve={etat.prenom}
            annotable={false}
            titre="Mes conversations"
            hauteur="calc(100dvh - 210px)"
            // C'est SON compte Instagram : « Ouvrir la discussion » mène bien à son
            // inbox, et il peut retirer un fil comme l'élève le peut.
            proprietaire
            messageVide="Aucune conversation pour l’instant. Tes échanges avec des prospects identifiés apparaîtront ici."
          />
        </div>
      )}
    </div>
  );
}
