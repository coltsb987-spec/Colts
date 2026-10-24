const PUBLIC_PATHS = ["/login"];
const PUBLIC_PREFIXES = ["/auth/"];

export function isPublicPath(path: string) {
  return PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// Only allow redirects to a path on this site, never to another domain.
export function safeRedirectPath(next: unknown, fallback = "/") {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  try {
    const parsed = new URL(next, "http://localhost");
    if (parsed.origin !== "http://localhost") return fallback;
    return parsed.pathname + parsed.search;
  } catch {
    return fallback;
  }
}
