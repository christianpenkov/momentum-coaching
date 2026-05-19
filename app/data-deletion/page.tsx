export default function DataDeletionPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 24px', fontFamily: 'sans-serif', color: '#111', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Data Deletion Request</h1>
      <p style={{ color: '#666', marginBottom: 40 }}>Request removal of your data from Momentum</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>How to delete your data</h2>
      <p>To request deletion of all your personal data from Momentum, including any data obtained via Instagram (Meta) APIs, you have two options:</p>

      <h3 style={{ fontSize: 15, fontWeight: 700, margin: '24px 0 8px' }}>Option 1 — From the platform</h3>
      <ol>
        <li>Log in to your account at <a href="https://momentum-plateforme.vercel.app" style={{ color: '#111' }}>momentum-plateforme.vercel.app</a></li>
        <li>Go to <strong>Settings</strong></li>
        <li>Disconnect all integrations (Instagram, YouTube, Stripe)</li>
        <li>Contact us to delete your account</li>
      </ol>

      <h3 style={{ fontSize: 15, fontWeight: 700, margin: '24px 0 8px' }}>Option 2 — Via email</h3>
      <p>Send a deletion request to <a href="mailto:christianpenkov06@gmail.com" style={{ color: '#111' }}>christianpenkov06@gmail.com</a> with the subject line <strong>"Data Deletion Request"</strong> and your account email. We will process your request within 30 days.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>What gets deleted</h2>
      <ul>
        <li>Your profile and account information</li>
        <li>All Instagram access tokens and cached data</li>
        <li>All YouTube access tokens and cached data</li>
        <li>All Stripe connection data</li>
        <li>All messages and coaching history</li>
      </ul>

      <p style={{ marginTop: 40, color: '#666', fontSize: 13 }}>
        For questions: <a href="mailto:christianpenkov06@gmail.com" style={{ color: '#666' }}>christianpenkov06@gmail.com</a>
      </p>
    </div>
  );
}
