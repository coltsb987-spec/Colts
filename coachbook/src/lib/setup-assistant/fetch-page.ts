import "server-only";
import dns from "node:dns/promises";
import net from "node:net";
import { htmlToText, isPrivateAddress, looksBlocked, type PageResult } from "./page-text";

// Fetches a coach's link on our server, safely:
//  - only http/https on the normal ports
//  - every hostname (including after each redirect) must resolve to a public address,
//    so links can't be used to reach private or internal systems
//  - short timeout and a size cap

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 4;

async function checkUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad_protocol");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("bad_port");
  if (url.username || url.password) throw new Error("credentials_in_url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error("private_address");
  return url;
}

export async function fetchPage(link: string): Promise<PageResult> {
  let url: URL;
  try {
    url = await checkUrl(link);
  } catch {
    let known: string | null = null;
    try {
      known = blockedReason(new URL(link));
    } catch {}
    return { url: link, ok: false, reason: known ?? "We couldn't open that link. Check it's a normal public web address, or paste the text or upload a screenshot instead." };
  }

  try {
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "Mozilla/5.0 (compatible; CoachBook profile setup)", accept: "text/html,text/plain;q=0.9" },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        url = await checkUrl(new URL(location, url).toString());
        continue;
      }
      break;
    }
    if (!res) throw new Error("no_response");
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/text\/(html|plain)|xhtml/.test(type)) {
      return { url: link, ok: false, reason: blockedReason(url) ?? "We couldn't read that page (it may be private, offline or not a normal web page). Paste the text or upload a screenshot instead." };
    }

    // Read at most MAX_BYTES.
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => undefined);
    const body = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    const page = type.includes("html") ? htmlToText(body) : { title: "", description: "", text: body.slice(0, 15000) };
    const blocked = looksBlocked(url, page);
    if (blocked) return { url: link, ok: false, reason: blocked };
    return { url: link, ok: true, text: [page.title && `Title: ${page.title}`, page.description && `Description: ${page.description}`, page.text].filter(Boolean).join("\n").slice(0, 15000) };
  } catch {
    return { url: link, ok: false, reason: blockedReason(url) ?? "That page took too long or couldn't be opened. Paste the text or upload a screenshot instead." };
  }
}

function blockedReason(url: URL): string | null {
  const h = url.hostname;
  if (/(^|\.)instagram\.com$/.test(h)) return "Instagram didn't let us read that page – it usually needs you to be logged in. Paste your bio text or upload a screenshot of your profile instead.";
  if (/(^|\.)(facebook|fb)\.com$/.test(h)) return "Facebook didn't let us read that page – it usually needs you to be logged in. Paste your page's text or upload a screenshot instead.";
  return null;
}
