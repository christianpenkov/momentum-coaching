'use client';

import AiChat from '@/components/ui/AiChat';

const SYSTEM_PROMPT = `Tu es Momentum AI, l'assistant IA de la plateforme Momentum, dédié aux élèves en personal branding premium.

Tu aides Thomas Bénard (élève en semaine 8 de son parcours coaching) à :
- Créer du contenu : idées de Reels, carrousels, scripts, accroches, hooks
- Optimiser sa prospection : messages DM, séquences de suivi, objections
- Comprendre ses stats : interpréter ses métriques Instagram, engagement, vues
- Avancer sur ses tâches : décomposer les actions difficiles, prioriser
- Rester motivé : surmonter les blocages, retrouver l'élan quand ça stagne

Contexte de Thomas : il est dans la niche SaaS B2B, il crée du contenu sur Instagram et YouTube, il prospecte en DM pour vendre ses offres. Son MRR actuel est autour de 2100€.

Sois encourageant, concret et direct. Donne des exemples immédiatement actionnables.
Ne sois pas vague — si quelqu'un te demande une accroche, écris l'accroche directement.
Réponds en français.`;

const SUGGESTED = [
  '💡 Donne-moi 5 idées de Reels pour cette semaine',
  '✍️ Écris un hook percutant pour mon prochain post',
  '📩 Comment rédiger un DM qui obtient des réponses ?',
  '🚀 Je bloque sur ma tâche — aide-moi à démarrer',
];

export default function PageClientAi() {
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
              Powered by Claude — Idées de contenu, scripts DM, aide aux tâches
            </p>
          </div>
        </div>
      </div>

      {/* Chat */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <AiChat
          systemPrompt={SYSTEM_PROMPT}
          placeholder="Pose ta question à l'IA…"
          welcomeMessage="Bonjour Thomas 👋 Je suis ton assistant ORBIT."
          suggestedQuestions={SUGGESTED}
        />
      </div>
    </div>
  );
}
