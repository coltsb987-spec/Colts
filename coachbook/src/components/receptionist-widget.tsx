"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Msg = { id?: string; sender: "customer" | "ai" | "coach"; content: string };
type Action = { type: "pay" | "link"; label: string; url: string };
type Stored = { id: string; token: string };

const storeKey = (slug: string) => `coachbook-chat-${slug}`;
function load(slug: string): Stored | null {
  try {
    const raw = localStorage.getItem(storeKey(slug));
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}
function save(slug: string, v: Stored | null) {
  try {
    if (v) localStorage.setItem(storeKey(slug), JSON.stringify(v));
    else localStorage.removeItem(storeKey(slug));
  } catch {
    // private mode etc. – the chat just won't be remembered
  }
}

function linkLabel(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname === "checkout.stripe.com") return "secure payment link";
    if (u.pathname.includes("/book/")) return "booking page";
    if (u.pathname.startsWith("/parent/bookings")) return "your booking";
    return u.pathname;
  } catch {
    return url;
  }
}

// Turns URLs on our own site or Stripe Checkout into links, and **bold** into bold;
// everything else stays plain text (no HTML is ever injected).
function Linkified({ text }: { text: string }) {
  const parts = text.replace(/^#{1,6}\s+/gm, "").replace(/^\s*\*\s+/gm, "• ").split(/(https?:\/\/[^\s)]+|\*\*[^*\n]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*\n]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (!/^https?:\/\//.test(p)) return <span key={i}>{p}</span>;
        let safe = false;
        try {
          const u = new URL(p);
          safe = u.origin === window.location.origin || u.hostname === "checkout.stripe.com";
        } catch {}
        return safe ? (
          <a key={i} href={p} className="break-all font-medium underline underline-offset-2" target={p.includes("stripe.com") ? "_blank" : undefined} rel="noreferrer">
            {linkLabel(p)}
          </a>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </>
  );
}

export function ReceptionistWidget({ slug, coachName, greeting }: { slug: string; coachName: string; greeting: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const convo = useRef<Stored | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Restore an earlier chat (and pick up any replies from the coach) when opened.
  useEffect(() => {
    if (!open) return;
    convo.current = load(slug);
    if (!convo.current) return;
    fetch(`/api/receptionist/${slug}?conversation_id=${convo.current.id}`, { headers: { "x-chat-token": convo.current.token } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setMsgs(d.messages))
      .catch(() => {
        save(slug, null);
        convo.current = null;
      });
  }, [open, slug]);

  // Braces matter: newer browsers make scrollIntoView return a Promise, which React would treat as a cleanup function.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy, open]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setActions([]);
    setMsgs((m) => [...m, { sender: "customer", content: text }]);
    setBusy(true);
    try {
      const res = await fetch(`/api/receptionist/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, ...(convo.current ? { conversation_id: convo.current.id, token: convo.current.token } : {}) }),
      });
      const d = await res.json();
      if (!res.ok) {
        if (d.error === "conversation_not_found") {
          save(slug, null);
          convo.current = null;
        }
        setError(d.error === "conversation_not_found" ? "That chat has expired – please send your message again." : d.error ?? "Something went wrong.");
        return;
      }
      if (d.token) {
        convo.current = { id: d.conversation_id, token: d.token };
        save(slug, convo.current);
      }
      setMsgs(d.messages);
      setActions(d.actions ?? []);
    } catch {
      setError("Couldn't reach the assistant. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-lime px-5 py-3 font-semibold text-ink shadow-lg shadow-ink/15 transition-colors hover:bg-lime-deep"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
          Ask a question
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label={`Chat with ${coachName}'s assistant`}
          className="fixed inset-x-2 bottom-2 z-40 flex max-h-[85vh] flex-col overflow-hidden rounded-3xl border border-sage-line bg-canvas shadow-2xl shadow-ink/20 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[24rem]"
        >
          <header className="flex items-start justify-between gap-3 bg-ink px-4 py-3 text-canvas">
            <div>
              <p className="font-semibold">{coachName}</p>
              <p className="text-xs text-canvas/70">AI assistant · the coach can see this chat</p>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-full px-2 py-1 text-sm hover:bg-canvas/10" aria-label="Close chat">✕</button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            <Bubble sender="ai">{greeting}</Bubble>
            {msgs.map((m, i) => (
              <Bubble key={m.id ?? i} sender={m.sender}>
                <Linkified text={m.content} />
              </Bubble>
            ))}
            {busy && <Bubble sender="ai"><span className="inline-flex gap-1" aria-label="Typing"><Dot /><Dot d="150ms" /><Dot d="300ms" /></span></Bubble>}
            {actions.length > 0 && !busy && (
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <a
                    key={a.url}
                    href={a.url}
                    target={a.type === "pay" ? "_blank" : undefined}
                    rel="noreferrer"
                    className={a.type === "pay" ? "rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink hover:bg-lime-deep" : "rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-medium hover:border-ink/40"}
                  >
                    {a.label}
                  </a>
                ))}
              </div>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            <div ref={endRef} />
          </div>

          <form onSubmit={send} className="flex items-end gap-2 border-t border-sage-line bg-white/70 p-3">
            <label className="sr-only" htmlFor="chat-input">Your message</label>
            <textarea
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) send(e);
              }}
              rows={1}
              maxLength={1000}
              placeholder="e.g. Any 1-to-1s free on Saturday?"
              className="max-h-28 min-h-10 flex-1 resize-none rounded-2xl border border-sage-line bg-white px-3 py-2 text-sm focus:border-ink focus:outline-none"
            />
            <button disabled={busy || !input.trim()} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-canvas disabled:opacity-40">Send</button>
          </form>
          <p className="bg-white/70 px-4 pb-2 text-[11px] text-ink-soft">Don&apos;t share medical details or card numbers here. Payments use Stripe&apos;s secure page.</p>
        </section>
      )}
    </>
  );
}

function Bubble({ sender, children }: { sender: Msg["sender"]; children: React.ReactNode }) {
  const mine = sender === "customer";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm [overflow-wrap:anywhere] ${mine ? "bg-ink text-canvas" : "border border-sage-line bg-sage"}`}>
        {sender === "coach" && <p className="mb-0.5 text-xs font-semibold">From the coach</p>}
        {children}
      </div>
    </div>
  );
}

function Dot({ d = "0ms" }: { d?: string }) {
  return <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/50" style={{ animationDelay: d }} />;
}
