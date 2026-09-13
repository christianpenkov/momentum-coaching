/**
 * La rédaction des e-mails d'incident.
 *
 * Même contrainte que les alertes de vues (`app/api/sante/alerte-vues/route.ts`) : cet
 * e-mail sera peut-être lu dans un an, par quelqu'un qui n'a jamais vu le code. Il doit
 * donc se suffire : ce qui s'est passé, où, combien de fois, avec quel code déployé, les
 * dernières occurrences COMPLÈTES (le « log » que Vercel a effacé depuis longtemps), et
 * de quoi agir tout de suite — la requête SQL et un prompt prêt à coller.
 */

export interface IncidentLu {
  empreinte: string;
  source: string;
  gravite: 'critique' | 'normale';
  titre: string;
  premiere_le: string;
  derniere_le: string;
  occurrences: number;
  dernier_detail: Record<string, unknown>;
  echantillons: Record<string, unknown>[];
  version_derniere: string | null;
}

const echapper = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function dateParis(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'medium', timeStyle: 'medium' });
  } catch {
    return iso;
  }
}

function referenceProjet(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? '(voir PROJET.json)';
}

function lienCommit(sha: string | null): string | null {
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  return sha && owner && slug ? `https://github.com/${owner}/${slug}/commit/${sha}` : null;
}

/** Ce qui aide à démarrer, selon la nature de l'incident. */
function pistes(i: IncidentLu): string[] {
  const type = String(i.dernier_detail?.type ?? '');
  const communes = [
    `Tout le contexte est en base : <code>select * from incidents where empreinte = '${i.empreinte}';</code> — la colonne <code>echantillons</code> garde les 5 dernières occurrences complètes.`,
  ];
  if (type.startsWith('supabase_refus')) {
    return [
      'Une requête vers la base a été REFUSÉE. L’appelant ne lit peut-être pas son <code>{ error }</code> : dans ce cas la route a répondu « OK » pendant que rien n’était écrit — c’est précisément pour ça que ce filet existe.',
      'Lire <code>code</code>, <code>message</code> et <code>hint</code> ci-dessous : 42703 = colonne inconnue (schéma et code divergent), 42501 = permission / RLS, 23502 = valeur obligatoire manquante, 23503 = clé étrangère, P0001 = exception levée par une fonction SQL.',
      'La <code>route</code> et la <code>pile_appel</code> disent QUEL fichier a émis la requête. Y chercher l’appel sur la table ou la RPC nommée dans le titre.',
      'Si une migration vient d’être appliquée, vérifier qu’elle n’a pas renommé ou retiré ce que ce code lit (<code>select * from migrations_sante;</code>).',
      ...communes,
    ];
  }
  if (type === 'supabase_injoignable') {
    return [
      'La base n’a pas répondu du tout (réseau, DNS, délai). Un cas isolé est un hoquet ; si les occurrences montent, regarder l’état de Supabase (status.supabase.com) et le quota du plan (base en lecture seule, egress dépassé → réponses 402).',
      ...communes,
    ];
  }
  if (type === 'exception_serveur' || type.startsWith('navigateur_') || type.startsWith('edge_')) {
    return [
      'Une exception n’a été attrapée par personne. La <code>pile</code> ci-dessous donne le fichier et la ligne ; le <code>commit</code> dit quel code tournait.',
      'Si l’incident est apparu juste après un déploiement, commencer par le diff de ce commit.',
      ...communes,
    ];
  }
  if (type === 'graph_version_surclassee') {
    return [
      'Meta a retiré cette version de la Graph API et sert une version plus récente à la place, sans erreur. Rien n’a cassé visiblement, mais une métrique peut avoir changé de sens.',
      '<code>select * from versions_api_sante;</code> liste les fichiers qui utilisent chaque version. Remplacer, puis refaire l’audit métrique par métrique (skill <code>audit-metrique-bout-en-bout</code>).',
      ...communes,
    ];
  }
  return communes;
}

export function promptIncident(i: IncidentLu): string {
  return [
    `Dans le projet Momentum (dossier orbit/), un incident ${i.gravite} a été enregistré par la surveillance automatique.`,
    ``,
    `Titre : ${i.titre}`,
    `Empreinte : ${i.empreinte} — source : ${i.source} — ${i.occurrences} occurrence(s), de ${i.premiere_le} à ${i.derniere_le}.`,
    `Projet Supabase : ${referenceProjet()}.`,
    ``,
    `Commence par lire orbit/AGENTS.md, puis orbit/docs/surveillance-et-incidents.md.`,
    `Lis l'incident complet en base : select * from incidents where empreinte = '${i.empreinte}';`,
    `Établis la cause AVANT de proposer une correction : lis le fichier et la ligne indiqués par la pile, et vérifie`,
    `ce que la base contient réellement. Ne corrige aucune donnée sans m'avoir montré, ligne par ligne, ce qui changerait.`,
    `Une fois la cause corrigée et déployée, marque l'incident résolu :`,
    `update incidents set resolu_le = now(), resolu_note = '<le commit qui corrige>' where empreinte = '${i.empreinte}';`,
    `(S'il revient, il se rouvrira et renverra un e-mail tout seul.)`,
  ].join('\n');
}

export function sujetIncident(i: IncidentLu): string {
  return `Momentum — ${i.gravite === 'critique' ? '🔴 ' : ''}${i.titre}`.slice(0, 250);
}

export function blocIncident(i: IncidentLu): string {
  const commit = i.version_derniere;
  const lien = lienCommit(commit);
  const detail = JSON.stringify(i.dernier_detail, null, 2);
  const autres = (i.echantillons ?? []).slice(1);
  return `
  <p style="font-size:17px;font-weight:600;margin:0 0 4px">${echapper(i.titre)}</p>
  <p style="margin:0 0 16px;color:#797569;font-size:13px">
    ${i.gravite === 'critique' ? '<strong style="color:#cd5b3f">Critique</strong>' : 'Non urgent'} ·
    source <code>${echapper(i.source)}</code> ·
    <strong>${i.occurrences}</strong> occurrence${i.occurrences > 1 ? 's' : ''} ·
    première ${dateParis(i.premiere_le)} · dernière ${dateParis(i.derniere_le)} (heure de Paris)<br>
    Code déployé : ${commit ? (lien ? `<a href="${lien}">${echapper(commit)}</a>` : `<code>${echapper(commit)}</code>`) : 'inconnu'} ·
    empreinte <code>${echapper(i.empreinte)}</code>
  </p>

  <p style="margin:0 0 6px"><strong>Pour démarrer</strong></p>
  <ol style="margin:0 0 16px;padding-left:20px">
    ${pistes(i).map((p) => `<li style="margin:0 0 6px">${p}</li>`).join('')}
  </ol>

  <p style="margin:0 0 6px"><strong>Dernière occurrence, complète</strong></p>
  <pre style="margin:0 0 16px;padding:12px 14px;background:#f7f5f0;border:1px solid #eeeae0;border-radius:8px;font-size:11.5px;line-height:1.5;overflow-x:auto;white-space:pre-wrap;word-break:break-word">${echapper(detail.slice(0, 12_000))}</pre>

  ${autres.length ? `
  <details style="margin:0 0 16px"><summary style="cursor:pointer;font-size:13px">${autres.length} occurrence(s) précédente(s)</summary>
    ${autres.map((e) => `<pre style="margin:8px 0 0;padding:10px 12px;background:#f7f5f0;border:1px solid #eeeae0;border-radius:8px;font-size:11px;white-space:pre-wrap;word-break:break-word">${echapper(JSON.stringify(e, null, 2).slice(0, 4_000))}</pre>`).join('')}
  </details>` : ''}

  <p style="margin:0 0 6px"><strong>À coller directement dans Claude Code</strong></p>
  <pre style="margin:0 0 16px;padding:14px 16px;background:#1a1815;color:#f0ede6;border-radius:8px;font-size:12px;line-height:1.6;overflow-x:auto;white-space:pre-wrap">${echapper(promptIncident(i))}</pre>`;
}

export function enveloppeEmail(contenu: string, piedDePage: string): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;line-height:1.55;color:#1a1815;max-width:680px">
  ${contenu}
  <p style="margin:0;padding-top:14px;border-top:1px solid #eeeae0;color:#797569;font-size:11px">
    ${piedDePage}<br>
    Fonctionnement complet de la surveillance : <code>orbit/docs/surveillance-et-incidents.md</code>.
    Base Supabase : <code>${referenceProjet()}</code>.
  </p>
</div>`;
}
