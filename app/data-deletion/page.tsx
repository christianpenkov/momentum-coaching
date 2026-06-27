export default function DataDeletionPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 24px', fontFamily: 'sans-serif', color: '#111', lineHeight: 1.7 }}>

      {/* ——— ENGLISH ——— */}
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Data Deletion Request</h1>
      <p style={{ color: '#666', marginBottom: 40 }}>Last updated: June 2026</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>How to delete your data</h2>
      <p>
        If you have connected your Instagram account to the Momentum platform and wish to delete all associated data,
        you have two options:
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '24px 0 8px' }}>Option 1 — From the platform (instant)</h3>
      <ol>
        <li>Log in to your account at <a href="https://momentum-plateforme.vercel.app" style={{ color: '#111' }}>momentum-plateforme.vercel.app</a></li>
        <li>Go to <strong>Settings</strong></li>
        <li>Click <strong>Disconnect</strong> next to your Instagram account</li>
      </ol>
      <p>This immediately removes your Instagram access token and all associated data from our systems.</p>

      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '24px 0 8px' }}>Option 2 — Email request</h3>
      <p>
        Send a deletion request to{' '}
        <a href="mailto:christianpenkov@ubizenai.com" style={{ color: '#111' }}>
          christianpenkov@ubizenai.com
        </a>{' '}
        with the subject line <strong>"Data Deletion Request"</strong> and your account email address.
        We will process your request within 30 days and confirm deletion by email.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>What data is deleted</h2>
      <ul>
        <li>Your Instagram access token</li>
        <li>Your Instagram account metadata (username, account ID)</li>
        <li>Any cached Instagram statistics stored in our database</li>
        <li>Your Momentum account and all associated data upon request</li>
      </ul>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>Contact</h2>
      <p>
        For any questions:{' '}
        <a href="mailto:christianpenkov@ubizenai.com" style={{ color: '#111' }}>
          christianpenkov@ubizenai.com
        </a>
      </p>

      <hr style={{ margin: '48px 0', borderColor: '#e5e7eb' }} />

      {/* ——— FRANÇAIS ——— */}
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Demande de suppression des données</h1>
      <p style={{ color: '#666', marginBottom: 40 }}>Dernière mise à jour : juin 2026</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Comment supprimer vos données</h2>
      <p>
        Si vous avez connecté votre compte Instagram à la plateforme Momentum et souhaitez supprimer toutes les données associées,
        deux options s'offrent à vous :
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '24px 0 8px' }}>Option 1 — Depuis la plateforme (instantané)</h3>
      <ol>
        <li>Connectez-vous à votre compte sur <a href="https://momentum-plateforme.vercel.app" style={{ color: '#111' }}>momentum-plateforme.vercel.app</a></li>
        <li>Accédez aux <strong>Paramètres</strong></li>
        <li>Cliquez sur <strong>Déconnecter</strong> à côté de votre compte Instagram</li>
      </ol>
      <p>Cela supprime immédiatement votre token d'accès Instagram et toutes les données associées de nos systèmes.</p>

      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '24px 0 8px' }}>Option 2 — Demande par e-mail</h3>
      <p>
        Envoyez une demande de suppression à{' '}
        <a href="mailto:christianpenkov@ubizenai.com" style={{ color: '#111' }}>
          christianpenkov@ubizenai.com
        </a>{' '}
        avec l'objet <strong>« Data Deletion Request »</strong> et l'adresse e-mail de votre compte.
        Nous traiterons votre demande dans un délai de 30 jours et confirmerons la suppression par e-mail.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>Données supprimées</h2>
      <ul>
        <li>Votre token d'accès Instagram</li>
        <li>Les métadonnées de votre compte Instagram (nom d'utilisateur, identifiant)</li>
        <li>Toutes les statistiques Instagram mises en cache dans notre base de données</li>
        <li>Votre compte Momentum et toutes les données associées sur demande</li>
      </ul>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>Contact</h2>
      <p>
        Pour toute question :{' '}
        <a href="mailto:christianpenkov@ubizenai.com" style={{ color: '#111' }}>
          christianpenkov@ubizenai.com
        </a>
      </p>

      <hr style={{ margin: '48px 0', borderColor: '#e5e7eb' }} />
      <p style={{ fontSize: 12, color: '#9ca3af' }}>
        Momentum is a platform published by the sole proprietorship Penkov Christian (UbizenAI) — SIREN 924 627 988 — Saint-Martin-d'Hères, France.
      </p>
    </div>
  );
}
