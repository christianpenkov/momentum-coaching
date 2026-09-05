import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { retirerConversationsIg } from '@/lib/igConversationsRetrait';

/**
 * L'élève retire une conversation depuis sa page Conversations DM.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI CE GESTE EXISTE ICI AUSSI                                        │
 * │                                                                           │
 * │ Il existait déjà, mais uniquement dans Pipeline Leads, sous le nom « ce   │
 * │ n'est pas un lead » — c'est-à-dire au seul endroit où l'élève ne regarde  │
 * │ PAS quand il veut soustraire une conversation à son coach. Demander de    │
 * │ traverser un autre écran, et d'y reconnaître un libellé qui parle de      │
 * │ qualification commerciale, pour exercer ce qui est un droit de retrait :  │
 * │ c'est la même action, elle devait être là où la conversation se lit.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Le retrait fait DEUX choses, et les deux sont nécessaires :
 *   1. il écarte le lead (`not_a_lead = true`) — sans quoi le prochain message
 *      recrée le fil et la reprise d'historique le réimporte, donc le retrait
 *      ne tiendrait que quelques heures ;
 *   2. il efface la conversation, les messages et les fichiers vocaux.
 *
 * C'est exactement l'effet du geste de Pipeline Leads, et l'écran le DIT avant
 * de le faire. Une action qui retire discrètement quelqu'un du pipeline en
 * prétendant ne masquer qu'une conversation serait un piège.
 *
 * ⚠️ Réservé à l'ÉLÈVE. Le coach lit, il n'efface pas : ces messages sont ceux
 * de l'élève, et le partage est révocable par celui qui l'a accordé, pas par
 * celui qui en bénéficie.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const conversationId = body?.conversation_id;
  if (typeof conversationId !== 'string' || !conversationId) {
    return NextResponse.json({ error: 'conversation_id requis' }, { status: 400 });
  }

  // ⚠️ Le filtre porte sur l'identité AUTHENTIFIÉE. Un `profile_id` est public
  // depuis le 2026-08-31 : on ne prend jamais celui du corps de la requête, et
  // on vérifie que ce fil appartient bien à l'appelant avant de l'effacer.
  const { data: fil } = await supa
    .from('ig_conversations')
    .select('peer_id, peer_username')
    .eq('id', conversationId)
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!fil) return NextResponse.json({ error: 'Conversation introuvable' }, { status: 404 });

  // 1. Écarter le lead. D'abord, parce que c'est ce qui rend le retrait durable :
  //    si l'effacement réussissait et que cette écriture échouait, le fil
  //    reviendrait au prochain message et l'élève croirait l'avoir retiré.
  const { error: errLead } = await supa
    .from('instagram_leads')
    .update({ not_a_lead: true })
    .eq('profile_id', user.id)
    .eq('ig_user_id', fil.peer_id);

  if (errLead) {
    return NextResponse.json({ error: `retrait impossible: ${errLead.message}` }, { status: 500 });
  }

  // 2. Effacer la conversation, ses messages et ses vocaux.
  try {
    const bilan = await retirerConversationsIg(supa, user.id, [fil.peer_id]);
    return NextResponse.json({ ok: true, ...bilan, regle: 'retrait_eleve' });
  } catch (e: any) {
    // Le lead est écarté, donc le fil est déjà hors de portée du coach. On le
    // dit sans mentir : la promesse principale est tenue, le ménage suivra.
    console.error('[retrait conversation] effacement échoué:', e?.message || e);
    return NextResponse.json({ ok: true, fils: 0, vocaux: 0, menage_differe: true, regle: 'retrait_eleve' });
  }
}
