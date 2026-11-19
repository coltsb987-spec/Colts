// Turning a fetched web page into plain text, and spotting login walls.
// Pure functions (no network) so they can be unit-tested.
import net from "node:net";

export type PageResult = { url: string; ok: true; text: string } | { url: string; ok: false; reason: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘" };

function decode(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function meta(html: string, name: string): string {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "").trim() : "";
}

export function htmlToText(html: string): { title: string; description: string; text: string } {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim() || meta(html, "og:title");
  const description = meta(html, "og:description") || meta(html, "description");
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\r]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 15000);
  return { title, description, text };
}

/** A plain-words reason if the page is a login wall or too empty to use, else null. */
export function looksBlocked(url: URL, page: { title: string; description: string; text: string }): string | null {
  const h = url.hostname;
  const isInsta = /(^|\.)instagram\.com$/.test(h);
  const isFb = /(^|\.)(facebook|fb)\.com$/.test(h);
  const loginPath = /\/(accounts\/)?login/i.test(url.pathname);
  const loginText = /log ?in|sign ?up|create an account/i.test(page.title) && page.text.length < 1500;
  if ((isInsta || isFb) && (loginPath || loginText || (page.text.length < 300 && !page.description))) {
    return isInsta
      ? "Instagram didn't let us read that page – it usually needs you to be logged in. Paste your bio text or upload a screenshot of your profile instead."
      : "Facebook didn't let us read that page – it usually needs you to be logged in. Paste your page's text or upload a screenshot instead.";
  }
  if (loginPath) return "That link goes to a login page, so we couldn't read it. Paste the text or upload a screenshot instead.";
  if (page.text.length + page.description.length < 80) return "That page didn't have enough text for us to read (it may be mostly pictures). Paste the text or upload a screenshot instead.";
  return null;
}

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

