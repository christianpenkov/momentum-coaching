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
// Et ça marche aussi bien pour un COLD DM que pour un commentaire : la personne
// n'a pas besoin de nous avoir répondu.
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
