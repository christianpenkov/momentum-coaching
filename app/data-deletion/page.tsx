export default function DataDeletionPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 24px', fontFamily: 'sans-serif', color: '#111', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Data Deletion Request</h1>
      <p style={{ color: '#666', marginBottom: 40 }}>Last updated: May 2026</p>

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
        <a href="mailto:christianpenkov06@gmail.com" style={{ color: '#111' }}>
          christianpenkov06@gmail.com
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
        <a href="mailto:christianpenkov06@gmail.com" style={{ color: '#111' }}>
          christianpenkov06@gmail.com
        </a>
      </p>
    </div>
  );
}
