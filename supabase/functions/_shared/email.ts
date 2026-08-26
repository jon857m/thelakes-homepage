export async function sendAdminEmail(subject: string, html: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("ADMIN_NOTIFICATION_EMAIL");
  const from = Deno.env.get("EMAIL_FROM");
  if (!apiKey || !to || !from) return { sent: false, reason: "Email notifications are not configured" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error(`Email delivery failed: ${await response.text()}`);
  return { sent: true };
}

export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}
