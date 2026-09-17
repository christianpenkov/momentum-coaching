// ─────────────────────────────────────────────────────────────────────────────
// La photo de profil d'un lead Instagram
//
// ── POURQUOI ON LA RECOPIE CHEZ NOUS ─────────────────────────────────────────
//
// L'URL que renvoie Instagram est signée et EXPIRE. Un lead affiché avec l'URL
// d'origine perd sa photo au bout de quelques jours, sans que rien ne le
// signale — la balise image échoue en silence. On télécharge donc l'image une
// fois et on la sert depuis notre propre stockage, où elle ne périme pas.
//
// ── CE QU'IL FAUT SAVOIR SUR L'API ───────────────────────────────────────────
//
// Le champ s'appelle `profile_pic`, sur `graph.instagram.com`. Ni
// `profile_picture_url`, ni `graph.facebook.com` : les deux existent dans la
// documentation Meta mais pour l'API Facebook Login, pas pour Instagram Login.
//
// ⚠️ LE JETON DOIT ÊTRE CELUI DU COMPTE QUI A REÇU LE MESSAGE. Un `ig_user_id`
// est un identifiant SCOPÉ : il n'a de sens que pour le compte Instagram avec
// lequel la personne a interagi. Interroger avec le jeton d'un autre compte de
// la plateforme renvoie « Object with ID … does not exist » — un message qui
// fait croire à un problème de permission alors que c'est un problème
// d'appariement. Vérifié le 2026-09-05 : les mêmes identifiants échouent avec
// un jeton étranger et réussissent avec le bon.
//
// ⚠️ CETTE PHRASE ÉTAIT FAUSSE, corrigée le 2026-09-17. Elle disait que la photo
// s'obtenait pour un COLD DM « sans que la personne ait répondu ». Mesuré sur trois
// destinataires qui ne nous avaient jamais écrit : `profile_pic` répond « User
// consent is required to access user profile » (code 230). Le test d'origine avait
// dû porter sur quelqu'un qui avait déjà interagi avec le compte.
//
// Conséquence : un lead Cold DM naît SANS photo, et c'est normal. Elle arrive au
// premier message qu'il nous envoie — `enregistrer_message_ig` rend alors
// `lead_sans_photo`, et le webhook la rattrape (voir `rattraperPhotoLead`). Le
// PSEUDO, lui, ne dépend pas de ce consentement : il se lit dans les participants
// de la conversation (`lireFilPourColdDm`).
//
// ── SANS IMPORT, VOLONTAIREMENT ──────────────────────────────────────────────
//
// Ce fichier est lu par Node (webhook, route de backfill) ET par Deno (le cron
// `poll-leads`). Il ne peut donc dépendre d'aucun paquet : le client Supabase
// lui est passé en paramètre. Même contrainte que `lib/shortio-link-category.ts`.
// ─────────────────────────────────────────────────────────────────────────────

/** Le strict minimum du client Supabase dont cette fonction a besoin. */
interface ClientStockage {
  storage: {
    from(bucket: string): {
      upload(chemin: string, corps: ArrayBuffer, options: { contentType: string; upsert: boolean }):
        Promise<{ error: { message: string } | null }>;
      getPublicUrl(chemin: string): { data: { publicUrl: string } };
    };
  };
}

export interface ResultatAvatar {
  url: string | null;
  /** Pourquoi ça n'a pas marché. `null` quand tout va bien. */
  echec: string | null;
}

/**
 * Récupère la photo de profil d'un lead et la range dans notre stockage.
 *
 * Rend TOUJOURS un résultat, jamais une exception : cette fonction est appelée
 * en marge d'un webhook qui doit aboutir même sans photo. Mais elle dit POURQUOI
 * elle a échoué — l'ancienne version rendait `null` sur cinq chemins différents
 * sans laisser de trace, et un lead sans photo était indiscernable d'un lead
 * dont la récupération avait planté.
 *
 * @param jeton Le jeton du compte Instagram QUI A REÇU l'interaction.
 */
export async function recupererAvatar(
  supa: ClientStockage,
  igUserId: string,
  jeton: string,
): Promise<ResultatAvatar> {
  try {
    const profil = await fetch(
      `https://graph.instagram.com/v22.0/${igUserId}?fields=profile_pic&access_token=${jeton}`,
    );
    if (!profil.ok) {
      const corps = await profil.text().catch(() => '');
      return { url: null, echec: `profil http ${profil.status} ${corps.slice(0, 120)}` };
    }
    const donnees = await profil.json();
    const urlPhoto: string | undefined = donnees?.profile_pic;
    if (!urlPhoto) return { url: null, echec: 'aucun champ profile_pic' };

    const image = await fetch(urlPhoto);
    if (!image.ok) return { url: null, echec: `image http ${image.status}` };
    const corps = await image.arrayBuffer();

    const { error } = await supa.storage
      .from('instagram-avatars')
      .upload(`${igUserId}.jpg`, corps, { contentType: 'image/jpeg', upsert: true });
    if (error) return { url: null, echec: `stockage ${error.message}` };

    const { data } = supa.storage.from('instagram-avatars').getPublicUrl(`${igUserId}.jpg`);
    return { url: data.publicUrl, echec: null };
  } catch (e) {
    return { url: null, echec: `exception ${(e as Error)?.message ?? 'inconnue'}` };
  }
}


/** Ce dont `rattraperPhotoLead` a besoin en plus du stockage. */
interface ClientLeads extends ClientStockage {
  // deno-lint-ignore no-explicit-any
  rpc(fonction: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }>;
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

/**
 * Tente la photo d'un lead SI la règle l'autorise, et range le résultat.
 *
 * ── UNE SEULE RÈGLE, TROIS APPELANTS ─────────────────────────────────────────
 * Le webhook, le cron `poll-leads` et le bouton Rafraîchir portaient chacun leur
 * propre version de « lire le lead, appeler Meta, écrire l'URL ou l'échec ». Le
 * webhook ne réessayait jamais ; le cron réessayait toutes les cinq minutes, sans
 * limite ; le bouton ne tentait rien du tout. Trois copies, trois comportements.
 *
 * La décision « faut-il tenter maintenant ? » vit en base,
 * `lead_photo_a_tenter` : lead non écarté, sans photo, aucun échec depuis 24 h.
 * Un échec passager se rattrape donc le lendemain ; un échec permanent coûte au
 * plus un appel à Meta par jour.
 *
 * Jamais d'exception : la photo est un agrément, et ses appelants traitent un
 * webhook ou une passe de collecte qui doivent aboutir sans elle. Mais l'échec
 * est ÉCRIT — c'est lui qui déclenche le délai de 24 h.
 *
 * @param jeton Le jeton du compte Instagram QUI A REÇU l'interaction.
 * @returns vrai si une photo a été posée.
 */
export async function rattraperPhotoLead(
  supa: ClientLeads,
  profileId: string,
  igUserId: string,
  jeton: string,
  contexte = '',
): Promise<boolean> {
  try {
    const { data: leadId, error } = await supa.rpc('lead_photo_a_tenter', {
      p_profile_id: profileId, p_ig_user_id: igUserId,
    });
    if (error || !leadId) return false;

    const { url, echec } = await recupererAvatar(supa, igUserId, jeton);
    if (url) {
      await supa.from('instagram_leads').update({ avatar_url: url }).eq('id', leadId);
      return true;
    }
    await supa.from('instagram_avatar_echecs').insert({
      profile_id: profileId, ig_user_id: igUserId, lead_id: leadId,
      raison: `${contexte}${echec ?? 'inconnue'}`,
    });
    return false;
  } catch {
    return false;
  }
}
