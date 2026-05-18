import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export async function POST(request: NextRequest) {
  const { provider, key } = await request.json();

  if (!provider || !key) {
    return NextResponse.json({ valid: false, error: 'Paramètres manquants' }, { status: 400 });
  }

  try {
    switch (provider) {
      case 'stripe':
      case 'stripe_webhook': {
        if (provider === 'stripe_webhook') {
          // Le webhook secret ne peut pas être validé via API — on vérifie juste le format
          if (!key.startsWith('whsec_')) {
            return NextResponse.json({ valid: false, error: 'Format invalide — doit commencer par whsec_' });
          }
          return NextResponse.json({ valid: true, label: 'Format webhook valide' });
        }
        // Valide la clé secrète Stripe en appelant l'API
        const stripe = new Stripe(key, { apiVersion: '2026-04-22.dahlia' });
        const account = await stripe.accounts.retrieve('') as { email?: string; id: string };
        const label = account.email || account.id || 'Compte Stripe';
        return NextResponse.json({ valid: true, label });
      }

      case 'anthropic': {
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return NextResponse.json({ valid: false, error: err.error?.message || 'Clé invalide' });
        }
        return NextResponse.json({ valid: true, label: 'Clé Anthropic valide' });
      }

      case 'instagram': {
        const res = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${key}`);
        if (!res.ok) {
          return NextResponse.json({ valid: false, error: 'Token Instagram invalide ou expiré' });
        }
        const data = await res.json();
        return NextResponse.json({ valid: true, label: `@${data.username || data.id}` });
      }

      case 'youtube': {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&key=${key}`);
        if (!res.ok) {
          return NextResponse.json({ valid: false, error: 'Clé YouTube invalide' });
        }
        return NextResponse.json({ valid: true, label: 'Clé YouTube valide' });
      }

      case 'calendly': {
        const res = await fetch('https://api.calendly.com/users/me', {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!res.ok) {
          return NextResponse.json({ valid: false, error: 'Token Calendly invalide' });
        }
        const data = await res.json();
        const email = data.resource?.email || '';
        return NextResponse.json({ valid: true, label: email });
      }

      default:
        return NextResponse.json({ valid: true, label: 'Clé enregistrée' });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur de validation';
    return NextResponse.json({ valid: false, error: message });
  }
}
