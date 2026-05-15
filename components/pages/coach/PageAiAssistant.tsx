'use client';

import AiChat from '@/components/ui/AiChat';

const SYSTEM_PROMPT = `Tu es ORBIT AI, l'assistant IA intégré à la plateforme ORBIT dédiée aux coachs en personal branding premium.

Tu aides le coach (Marc Laurent) à :
- Préparer ses calls : analyser les métriques d'un élève, identifier les points faibles, préparer les bonnes questions
- Rédiger du contenu : messages de suivi, plans de contenu, scripts de prospection pour ses élèves
- Analyser la progression : interpréter les données Instagram, TikTok, LinkedIn, Stripe
- Gérer son activité : optimiser son offre, ses prix, sa communication avec les clients
- Diagnostiquer des blocages : quand un élève stagne, pourquoi les DM ne convertissent pas

Tu connais le contexte coaching 1:1 high ticket : personal branding, création de contenu, prospection DM, closing, MRR Stripe.
Sois direct, concret, orienté action. Donne des exemples réels. Évite le jargon vide.
Réponds en français.`;

const SUGGESTED = [
  '📋 Prépare-moi un brief pour mon call avec Thomas Bénard',
  '📈 Comment améliorer le taux de réponse aux DM de mes élèves ?',
  '💬 Écris un message de relance pour un élève qui stagne',
  '🎯 Quels KPIs surveiller en priorité cette semaine ?',
];

export default function PageAiAssistant() {
  return (
    <div className="page-content ai-shell" style={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '24px 32px 0', flexShrink: 0 }}>
        <div className="page-header" style={{ marginBottom: 0, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #C8A97E22 0%, var(--surface-2) 100%)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 18 }}>✦</span>
              </div>
              <h1 className="page-title" style={{ marginBottom: 0 }}>Assistant IA</h1>
              <span className="pill pill-green" style={{ fontSize: 11 }}>En ligne</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
              Powered by Claude — Préparation de calls, analyse d'élèves, rédaction de contenu
            </p>
          </div>
        </div>
      </div>

      {/* Chat */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <AiChat
          systemPrompt={SYSTEM_PROMPT}
          placeholder="Pose ta question au coach IA…"
          welcomeMessage="Bonjour Marc 👋 Je suis ton assistant ORBIT."
          suggestedQuestions={SUGGESTED}
        />
      </div>
    </div>
  );
}
