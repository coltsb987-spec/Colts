import "server-only";

// Sends email through Resend (https://resend.com). If RESEND_API_KEY is not set,
// emails are logged and skipped so the rest of the app still works.
export async function sendEmail(msg: { to: string | null; subject: string; html: string; text: string }) {
  if (!msg.to) return { skipped: true };
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[email not sent – RESEND_API_KEY missing] to=${msg.to.replace(/(.).*@/, "$1***@")} subject="${msg.subject}"`);
    return { skipped: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "CoachBook UK <onboarding@resend.dev>",
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) console.error("email failed", res.status, await res.text());
    return { skipped: false, ok: res.ok };
  } catch (e) {
    console.error("email failed", e);
    return { skipped: false, ok: false };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Simple branded email. `lines` are plain text (escaped); `cta` adds a lime button. */
export function emailLayout(opts: { heading: string; lines: string[]; cta?: { label: string; url: string }; footer?: string }) {
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#F7F8F4;padding:32px;color:#222622">
<div style="max-width:520px;margin:0 auto;background:#E6EDE4;border-radius:16px;padding:28px">
<h2 style="margin:0 0 14px">${esc(opts.heading)}</h2>
${opts.lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5">${esc(l)}</p>`).join("\n")}
${opts.cta ? `<p style="margin:20px 0 0"><a href="${esc(opts.cta.url)}" style="display:inline-block;background:#D4FF3A;color:#222622;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:999px">${esc(opts.cta.label)}</a></p>` : ""}
<p style="margin:22px 0 0;font-size:13px;color:#545b54">${esc(opts.footer ?? "Sent by CoachBook UK. Coaches on CoachBook UK are independent.")}</p>
</div></div>`;
  const text = [opts.heading, "", ...opts.lines, ...(opts.cta ? ["", `${opts.cta.label}: ${opts.cta.url}`] : [])].join("\n");
  return { html, text };
}
