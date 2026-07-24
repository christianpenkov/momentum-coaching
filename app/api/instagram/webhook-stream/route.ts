import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';

// Stockage en mémoire des derniers events reçus par le webhook IG
// (reset à chaque redéploiement — c'est volontaire pour le test)
const events: { ts: string; data: any }[] = [];
let clients: ReadableStreamDefaultController[] = [];

export function pushEvent(data: any) {
  const event = { ts: new Date().toISOString(), data };
  events.push(event);
  if (events.length > 100) events.shift(); // garde les 100 derniers
  // Pousse à tous les clients SSE connectés
  for (const ctrl of clients) {
    try {
      ctrl.enqueue(`data: ${JSON.stringify(event)}\n\n`);
    } catch {}
  }
}

// GET — stream SSE temps réel (consultation, réservée aux utilisateurs connectés)
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Envoie les events déjà en mémoire au moment de la connexion
      for (const ev of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      }
      clients.push(controller as any);

      // Heartbeat toutes les 20s pour garder la connexion ouverte
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 20000);
    },
    cancel() {
      clients = clients.filter(c => c !== this);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
