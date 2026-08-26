export function LoadingScreen({ label = "Loading your account…" }: { label?: string }) {
  return <main className="account-loading" role="status" aria-live="polite">
    <div className="account-loading__brand">
      <img src="/map/brand/hero.jpg" alt="" />
      <span><strong>The Lake District</strong><small>Business listings</small></span>
    </div>
    <div className="account-loading__progress"><i /></div>
    <p>{label}</p>
  </main>;
}
