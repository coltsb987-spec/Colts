import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AuthFrame } from "@/components/auth-frame";
import { Card, Field, Input } from "@/components/ui";
import { sendMagicLink, signInWithPassword } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

type SP = { as?: string; next?: string; method?: string };

export default async function LoginPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const as = sp.as === "parent" ? "parent" : "coach";
  const other = as === "coach" ? "parent" : "coach";
  const method = sp.method === "password" ? "password" : "link";
  const q = (extra: Record<string, string>) => new URLSearchParams({ as, ...(sp.next ? { next: sp.next } : {}), ...extra }).toString();

  return (
    <AuthFrame
      title={as === "coach" ? "Coach sign in" : "Parent & player sign in"}
      intro={as === "coach" ? "New or returning – choose how you'd like to sign in." : "Sign in to manage your players and bookings."}
    >
      <div role="tablist" aria-label="How to sign in" className="mt-6 grid grid-cols-2 gap-1 rounded-full bg-sage p-1 text-sm font-medium">
        {[
          ["link", "Email me a link"],
          ["password", "Sign in with password"],
        ].map(([m, label]) => (
          <Link
            key={m}
            role="tab"
            aria-selected={method === m}
            href={`/login?${q({ method: m })}`}
            replace
            className={`rounded-full px-3 py-2 text-center transition-colors ${method === m ? "bg-ink text-canvas" : "text-ink-soft hover:text-ink"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <Card className="mt-4">
        {method === "link" ? (
          <ActionForm action={sendMagicLink} submitLabel="Email me a sign-in link" pendingLabel="Sending…">
            <input type="hidden" name="as" value={as} />
            {sp.next && <input type="hidden" name="next" value={sp.next} />}
            <p className="text-sm text-ink-soft">We&apos;ll email you a secure link – no password needed. New here? This creates your account.</p>
            <Field label="Email">
              <Input type="email" name="email" required autoComplete="email" placeholder="you@example.co.uk" />
            </Field>
            <Field label="Your name" hint="Only needed the first time you sign in.">
              <Input name="full_name" autoComplete="name" maxLength={120} />
            </Field>
          </ActionForm>
        ) : (
          <ActionForm action={signInWithPassword} submitLabel="Sign in" pendingLabel="Signing in…">
            <input type="hidden" name="as" value={as} />
            {sp.next && <input type="hidden" name="next" value={sp.next} />}
            <Field label="Email">
              <Input type="email" name="email" required autoComplete="email" placeholder="you@example.co.uk" />
            </Field>
            <Field label="Password">
              <Input type="password" name="password" required autoComplete="current-password" />
            </Field>
            <p className="text-sm">
              <Link className="font-medium underline underline-offset-4" href={`/forgot-password?${q({})}`}>Forgot password?</Link>
            </p>
          </ActionForm>
        )}
      </Card>

      {method === "password" && (
        <p className="mt-4 text-sm text-ink-soft">
          New to CoachBook?{" "}
          <Link className="font-medium text-ink underline underline-offset-4" href={`/signup?${q({})}`}>Create an account with a password</Link>
        </p>
      )}
      <p className="mt-6 text-sm text-ink-soft">
        {as === "coach" ? "Booking for your child or yourself?" : "Are you a coach?"}{" "}
        <Link className="font-medium text-ink underline underline-offset-4" href={`/login?as=${other}${method === "password" ? "&method=password" : ""}`}>
          {as === "coach" ? "Parent sign in" : "Coach sign in"}
        </Link>
      </p>
    </AuthFrame>
  );
}
