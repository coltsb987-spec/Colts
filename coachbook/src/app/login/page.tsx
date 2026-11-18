import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, Logo } from "@/components/ui";
import { sendMagicLink } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ as?: string; next?: string }> }) {
  const sp = await searchParams;
  const as = sp.as === "parent" ? "parent" : "coach";
  const other = as === "coach" ? "parent" : "coach";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8">
      <Logo />
      <div className="my-auto py-10">
        <h1 className="text-2xl font-semibold tracking-tight">
          {as === "coach" ? "Coach sign in" : "Parent & player sign in"}
        </h1>
        <p className="mt-1 text-ink-soft">
          {as === "coach"
            ? "New or returning – enter your email and we'll send you a secure sign-in link. No password needed."
            : "Sign in to manage your players and bookings. We'll email you a secure link – no password needed."}
        </p>
        <Card className="mt-6">
          <ActionForm action={sendMagicLink} submitLabel="Email me a sign-in link" pendingLabel="Sending…">
            <input type="hidden" name="as" value={as} />
            {sp.next && <input type="hidden" name="next" value={sp.next} />}
            <Field label="Email">
              <Input type="email" name="email" required autoComplete="email" placeholder="you@example.co.uk" />
            </Field>
            <Field label="Your name" hint="Only needed the first time you sign in.">
              <Input name="full_name" autoComplete="name" maxLength={120} />
            </Field>
          </ActionForm>
        </Card>
        <p className="mt-6 text-sm text-ink-soft">
          {as === "coach" ? "Booking for your child or yourself?" : "Are you a coach?"}{" "}
          <Link className="font-medium text-ink underline underline-offset-4" href={`/login?as=${other}`}>
            {as === "coach" ? "Parent sign in" : "Coach sign in"}
          </Link>
        </p>
      </div>
    </main>
  );
}
