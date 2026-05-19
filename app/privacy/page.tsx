export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 24px', fontFamily: 'sans-serif', color: '#111', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ color: '#666', marginBottom: 40 }}>Last updated: May 2026</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>1. Introduction</h2>
      <p>Momentum ("we", "our", "us") is a coaching platform that connects coaches with their clients. This Privacy Policy explains how we collect, use, and protect your personal data when you use our platform at <strong>momentum-plateforme.vercel.app</strong>.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>2. Data We Collect</h2>
      <p>We collect the following data:</p>
      <ul>
        <li><strong>Account information:</strong> name, email address</li>
        <li><strong>Instagram Business data</strong> (via Instagram Graph API / Meta): username, follower count, media, reach, impressions, profile views, direct messages — only when you explicitly connect your Instagram account</li>
        <li><strong>YouTube data</strong> (via YouTube Data API): channel name, subscriber count, video statistics — only when you explicitly connect your YouTube channel</li>
        <li><strong>Stripe data</strong>: revenue, subscriptions, payments — only when you explicitly connect your Stripe account</li>
      </ul>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>3. How We Use Your Data</h2>
      <p>Data collected through Meta/Instagram APIs is used exclusively to:</p>
      <ul>
        <li>Display your Instagram statistics on your personal dashboard</li>
        <li>Allow your coach to monitor your account growth and engagement</li>
        <li>Generate performance reports within the platform</li>
      </ul>
      <p>We do not use your Instagram data for advertising, profiling, or any purpose other than those stated above.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>4. Data Sharing</h2>
      <p>We do not sell, rent, or share your personal data with third parties. Your data is only shared with your designated coach within the platform. We do not transfer Meta/Instagram data to any third-party analytics or advertising services.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>5. Data Retention</h2>
      <p>Access tokens from Instagram (Meta) are stored securely in our database and are used solely to fetch your statistics. Long-lived tokens are refreshed automatically and expire after 60 days if not renewed. You can revoke access at any time.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>6. Revoking Access & Data Deletion</h2>
      <p>You can disconnect your Instagram account at any time from your <strong>Settings</strong> page on the platform. This immediately removes your access token from our system.</p>
      <p>To request complete deletion of all your data, visit: <a href="https://momentum-plateforme.vercel.app/data-deletion" style={{ color: '#111' }}>momentum-plateforme.vercel.app/data-deletion</a> or contact us at <a href="mailto:christianpenkov06@gmail.com" style={{ color: '#111' }}>christianpenkov06@gmail.com</a>.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>7. Meta Platform Policy Compliance</h2>
      <p>Our use of Instagram and Facebook APIs complies with the <a href="https://developers.facebook.com/policy/" target="_blank" rel="noopener noreferrer" style={{ color: '#111' }}>Meta Platform Policy</a>. We only request permissions necessary for the core functionality of the platform and do not store data beyond what is required.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>8. Security</h2>
      <p>All data is stored securely using Supabase with row-level security policies. Access tokens are encrypted at rest. We use HTTPS for all communications.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 8px' }}>9. Contact</h2>
      <p>For any questions regarding your data or this policy: <a href="mailto:christianpenkov06@gmail.com" style={{ color: '#111' }}>christianpenkov06@gmail.com</a></p>
    </div>
  );
}
