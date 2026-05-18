import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';

async function getAnthropicKey(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return process.env.ANTHROPIC_API_KEY || null;

    // Find the coach: if the user is a client, find their coach; if coach, use their own integration
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();

    let coachId = user.id;
    if (profile?.role === 'client') {
      const { data: clientRow } = await supabase.from('clients').select('coach_id').eq('profile_id', user.id).single();
      if (clientRow) coachId = clientRow.coach_id;
    }

    const { data: integration } = await supabase
      .from('integrations')
      .select('api_key')
      .eq('profile_id', coachId)
      .eq('provider', 'anthropic')
      .single();

    return integration?.api_key || process.env.ANTHROPIC_API_KEY || null;
  } catch {
    return process.env.ANTHROPIC_API_KEY || null;
  }
}

export async function POST(req: Request) {
  const { messages, systemPrompt } = await req.json();

  const apiKey = await getAnthropicKey();
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Clé API Anthropic non configurée. Ajoutez-la dans Réglages → Intégrations.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const client = new Anthropic({ apiKey });

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt || 'Tu es un assistant coaching utile et bienveillant.',
    messages,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (
          chunk.type === 'content_block_delta' &&
          chunk.delta.type === 'text_delta'
        ) {
          controller.enqueue(encoder.encode(chunk.delta.text));
        }
      }
      controller.close();
    },
    cancel() {
      stream.controller.abort();
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
