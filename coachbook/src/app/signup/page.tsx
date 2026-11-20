import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AuthFrame } from "@/components/auth-frame";
import { Card, Field, Input } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { signUpWithPassword } from "../login/actions";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ as?: string; next?: string }> }) {
  const sp = await searchParams;
  const as = sp.as === "parent" ? "parent" : "coach";
  const back = new URLSearchParams({ as, method: "password", ...(sp.next ? { next: sp.next } : {}) }).toString();
  return (
    <AuthFrame
      title={as === "coach" ? "Create your coach account" : "Create your parent account"}
      intro="Choose a password, then confirm your email address."
    >
      <Card className="mt-6">
        <ActionForm action={signUpWithPassword} submitLabel="Create account" pendingLabel="Creating…">
          <input type="hidden" name="as" value={as} />
          {sp.next && <input type="hidden" name="next" value={sp.next} />}
          <Field label="Your name">
            <Input name="full_name" required autoComplete="name" maxLength={120} />
          </Field>
          <Field label="Email">
            <Input type="email" name="email" required autoComplete="email" placeholder="you@example.co.uk" />
          </Field>
          <Field label="Password" hint={`At least ${MIN_PASSWORD_LENGTH} characters. Three random words work well, e.g. “kettle-goalpost-orbit”.`}>
            <Input type="password" name="password" required minLength={MIN_PASSWORD_LENGTH} maxLength={72} autoComplete="new-password" />
          </Field>
          <Field label="Type it again">
            <Input type="password" name="confirm" required minLength={MIN_PASSWORD_LENGTH} maxLength={72} autoComplete="new-password" />
          </Field>
        </ActionForm>
      </Card>
      <p className="mt-4 text-sm text-ink-soft">
        Already have an account? <Link className="font-medium text-ink underline underline-offset-4" href={`/login?${back}`}>Sign in</Link>
      </p>
    </AuthFrame>
  );
}
