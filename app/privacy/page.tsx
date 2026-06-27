export const metadata = {
  title: 'Politique de Confidentialité — Momentum',
  description: 'Privacy Policy for Momentum coaching platform by UbizenAI (Penkov Christian)',
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#111', lineHeight: 1.7 }}>

      {/* ——— VERSION FRANÇAISE ——— */}
      <section lang="fr">
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Politique de Confidentialité</h1>
        <p style={{ color: '#666', marginBottom: 32 }}>Dernière mise à jour : juin 2026</p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>1. Éditeur</h2>
        <p>
          Momentum est une plateforme éditée par l'Entreprise Individuelle <strong>Penkov Christian (UbizenAI)</strong>,
          SIREN 924 627 988, dont le siège est à Saint-Martin-d'Hères, France.<br />
          Contact : <a href="mailto:christianpenkov@ubizenai.com" style={{ color: '#2563eb' }}>christianpenkov@ubizenai.com</a>
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>2. Données collectées</h2>
        <p>Dans le cadre de l'utilisation de Momentum, nous collectons les données suivantes :</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>Informations de compte Instagram (nom d'utilisateur, identifiant, statistiques de compte)</li>
          <li>Statistiques de contenus Instagram et YouTube (vues, reach, engagement, démographie d'audience)</li>
          <li>Données de messagerie Instagram (commentaires publics, messages directs) nécessaires à l'automatisation des envois de ressources pédagogiques</li>
          <li>Informations de prise de rendez-vous via Calendly (nom, e-mail, créneau choisi)</li>
          <li>Données de paiement gérées par Stripe (Momentum n'accède pas aux données bancaires brutes)</li>
        </ul>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>3. Utilisation des APIs Meta (Instagram)</h2>
        <p>
          Momentum utilise les APIs Meta Instagram (<code>instagram_business_basic</code>, <code>instagram_business_manage_messages</code>,{' '}
          <code>instagram_business_manage_comments</code>, <code>instagram_business_manage_insights</code>) uniquement aux fins suivantes :
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>
            <strong>Automatisation pédagogique (Lead Magnets) :</strong> envoi automatique de ressources pédagogiques en réponse aux commentaires des abonnés.
            Lorsqu'un abonné commente une publication avec un mot-clé spécifique, Momentum envoie automatiquement un message privé (DM) contenant un lien vers une ressource (PDF, vidéo, lien de réservation), dans le cadre de l'accompagnement coaching.
          </li>
          <li>
            <strong>Statistiques coach :</strong> affichage au coach des métriques de performance (reach, vues, engagement, impressions, démographie) pour suivre la progression de ses élèves sur Instagram et YouTube.
          </li>
          <li>
            <strong>Suivi des prospects :</strong> lecture des conversations Instagram pour détecter les réponses des prospects au DM automatique et déclencher les étapes de suivi (envoi de lien Calendly, passage dans le pipeline commercial du coach).
          </li>
        </ul>
        <p style={{ marginTop: 12, fontWeight: 600 }}>
          Aucune donnée collectée via les APIs Meta n'est revendue, partagée avec des tiers à des fins commerciales, ni utilisée à des fins publicitaires.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>4. Sécurité et stockage des données</h2>
        <p>
          Les données sont stockées dans Supabase (hébergement UE), protégées par Row-Level Security (RLS) : chaque utilisateur n'accède qu'à ses propres données.
          Les tokens d'accès Instagram et YouTube sont stockés de manière chiffrée et renouvelés automatiquement avant expiration.
          Aucune donnée brute n'est exposée au navigateur client sans authentification préalable.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>5. Conservation des données</h2>
        <p>
          Les données sont conservées pour la durée de la relation contractuelle entre le coach et ses élèves.
          Toute suppression de compte entraîne la suppression des données associées sur demande explicite adressée à{' '}
          <a href="mailto:christianpenkov@ubizenai.com" style={{ color: '#2563eb' }}>christianpenkov@ubizenai.com</a>.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>6. Partage des données</h2>
        <p>Nous ne revendons aucune donnée personnelle. Les données peuvent être traitées par les sous-traitants techniques suivants, dans le strict cadre du service :</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li><strong>Supabase</strong> — hébergement base de données (UE)</li>
          <li><strong>Vercel</strong> — hébergement application</li>
          <li><strong>Stripe</strong> — traitement des paiements</li>
          <li><strong>Calendly</strong> — gestion des rendez-vous</li>
          <li><strong>Short.io</strong> — raccourcissement de liens pour le tracking des clics</li>
          <li><strong>Meta Platforms</strong> — APIs Instagram (conformément aux Conditions d'utilisation Meta for Developers)</li>
          <li><strong>Google</strong> — API YouTube Analytics</li>
        </ul>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>7. Droits des utilisateurs (RGPD)</h2>
        <p>
          Conformément au Règlement Général sur la Protection des Données (RGPD — UE 2016/679), vous disposez d'un droit d'accès, de rectification, de suppression, de limitation et de portabilité de vos données personnelles.
          Pour exercer ces droits, contactez-nous à : <a href="mailto:christianpenkov@ubizenai.com" style={{ color: '#2563eb' }}>christianpenkov@ubizenai.com</a>.
          Vous disposez également du droit d'introduire une réclamation auprès de la CNIL (Commission Nationale de l'Informatique et des Libertés).
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>8. Cookies</h2>
        <p>
          Momentum utilise uniquement des cookies techniques nécessaires au fonctionnement de l'authentification (session utilisateur Supabase).
          Aucun cookie publicitaire, analytique tiers, ou de tracking cross-site n'est utilisé.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>9. Révocation et suppression des données Instagram</h2>
        <p>
          Vous pouvez révoquer l'accès de Momentum à votre compte Instagram à tout moment depuis les paramètres de votre compte Meta
          (<a href="https://www.instagram.com/accounts/manage_access/" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>instagram.com/accounts/manage_access</a>).
          Pour demander la suppression complète de vos données, contactez-nous à{' '}
          <a href="mailto:christianpenkov@ubizenai.com" style={{ color: '#2563eb' }}>christianpenkov@ubizenai.com</a>.
        </p>
      </section>

      <hr style={{ margin: '48px 0', borderColor: '#e5e7eb' }} />

      {/* ——— ENGLISH VERSION ——— */}
      <section lang="en">
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Privacy Policy</h1>
        <p style={{ color: '#666', marginBottom: 32 }}>Last updated: June 2026</p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>1. Publisher</h2>
        <p>
          Momentum is a platform published by the sole proprietorship <strong>Penkov Christian (UbizenAI)</strong>,
          SIREN 924 627 988, headquartered in Saint-Martin-d'Hères, France.<br />
          Contact: <a href="mailto:christianpenkov@ubizenai.com" style={{ color: '#2563eb' }}>christianpenkov@ubizenai.com</a>
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>2. Data collected</h2>
        <p>In the context of using Momentum, we collect the following data:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>Instagram account information (username, identifier, account statistics)</li>
          <li>Instagram and YouTube content statistics (views, reach, engagement, audience demographics)</li>
          <li>Instagram messaging data (public comments, direct messages) required for automated educational resource delivery</li>
          <li>Appointment booking information via Calendly (name, email, time slot)</li>
          <li>Payment data managed by Stripe (Momentum does not access raw banking data)</li>
        </ul>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>3. Use of Meta APIs (Instagram)</h2>
        <p>
          Momentum uses Meta Instagram APIs (<code>instagram_business_basic</code>, <code>instagram_business_manage_messages</code>,{' '}
          <code>instagram_business_manage_comments</code>, <code>instagram_business_manage_insights</code>) solely for the following purposes:
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>
            <strong>Educational automation (Lead Magnets):</strong> automatic delivery of educational resources in response to follower comments.
            When a follower comments on a post with a specific keyword, Momentum automatically sends a direct message (DM) containing a link to a resource (PDF, video, booking link), as part of coaching support.
          </li>
          <li>
            <strong>Coach statistics:</strong> displaying performance metrics (reach, views, engagement, impressions, demographics) to the coach to track student progress on Instagram and YouTube.
          </li>
          <li>
            <strong>Prospect tracking:</strong> reading Instagram conversations to detect prospect responses to the automatic DM and trigger follow-up steps (sending a Calendly link, moving through the coach's sales pipeline).
          </li>
        </ul>
        <p style={{ marginTop: 12, fontWeight: 600 }}>
          No data collected through Meta APIs is sold, shared with third parties for commercial purposes, or used for advertising.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>4. Security and data storage</h2>
        <p>
          Data is stored in Supabase (EU hosting), protected by Row-Level Security (RLS): each user only accesses their own data.
          Instagram and YouTube access tokens are stored in encrypted form and automatically renewed before expiration.
          No raw data is exposed to the client browser without prior authentication.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>5. Data retention</h2>
        <p>
          Data is retained for the duration of the contractual relationship between the coach and their students.
          Account deletion results in the deletion of associated data upon explicit request to{' '}
          <a href="mailto:christianpenkov@ubizenai.com" style={{ color: '#2563eb' }}>christianpenkov@ubizenai.com</a>.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>6. Data sharing</h2>
        <p>We do not sell any personal data. Data may be processed by the following technical subcontractors, strictly within the scope of the service:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li><strong>Supabase</strong> — database hosting (EU)</li>
          <li><strong>Vercel</strong> — application hosting</li>
          <li><strong>Stripe</strong> — payment processing</li>
          <li><strong>Calendly</strong> — appointment management</li>
          <li><strong>Short.io</strong> — link shortening for click tracking</li>
          <li><strong>Meta Platforms</strong> — Instagram APIs (in accordance with Meta for Developers Terms of Service)</li>
          <li><strong>Google</strong> — YouTube Analytics API</li>
        </ul>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>7. User rights (GDPR)</h2>
        <p>
          In accordance with the General Data Protection Regulation (GDPR — EU 2016/679), you have the right to access, rectify, delete, restrict, and port your personal data.
          To exercise these rights, contact us at: <a href="mailto:christianpenkov@ubizenai.com" style={{ color: '#2563eb' }}>christianpenkov@ubizenai.com</a>.
          You also have the right to lodge a complaint with your national data protection authority (e.g., CNIL in France).
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>8. Cookies</h2>
        <p>
          Momentum uses only technical cookies required for authentication (Supabase user session).
          No advertising, third-party analytics, or cross-site tracking cookies are used.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>9. Revoking access & data deletion</h2>
        <p>
          You can revoke Momentum's access to your Instagram account at any time from your Meta account settings
          (<a href="https://www.instagram.com/accounts/manage_access/" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>instagram.com/accounts/manage_access</a>).
          To request complete deletion of your data, contact us at{' '}
          <a href="mailto:christianpenkov@ubizenai.com" style={{ color: '#2563eb' }}>christianpenkov@ubizenai.com</a>.
        </p>
      </section>

      <hr style={{ margin: '48px 0', borderColor: '#e5e7eb' }} />
      <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
        Momentum — Entreprise Individuelle Penkov Christian (UbizenAI) — SIREN 924 627 988 — Saint-Martin-d'Hères, France
      </p>
    </main>
  );
}
