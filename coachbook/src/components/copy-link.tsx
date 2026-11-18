"use client";

import { useEffect, useState } from "react";

export function CopyLink({ path }: { path: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- origin is only known in the browser
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${path}`;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-sage-line bg-white p-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate text-sm">{url}</code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-canvas hover:bg-ink/85"
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
