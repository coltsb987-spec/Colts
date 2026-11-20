import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AuthFrame } from "@/components/auth-frame";
import { Card, Field, Input } from "@/components/ui";
import { requestPasswordReset } from "../login/actions";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const as = (await searchParams).as === "parent" ? "parent" : "coach";
  return (
    <AuthFrame title="Forgot your password?" intro="Enter your email and we'll send you a link to choose a new one.">
      <Card className="mt-6">
        <ActionForm action={requestPasswordReset} submitLabel="Email me a reset link" pendingLabel="Sending…">
          <Field label="Email">
            <Input type="email" name="email" required autoComplete="email" placeholder="you@example.co.uk" />
          </Field>
        </ActionForm>
      </Card>
      <p className="mt-4 text-sm text-ink-soft">
        Remembered it? <Link className="font-medium text-ink underline underline-offset-4" href={`/login?as=${as}&method=password`}>Sign in</Link> · or{" "}
        <Link className="font-medium text-ink underline underline-offset-4" href={`/login?as=${as}`}>get a sign-in link instead</Link>
      </p>
    </AuthFrame>
  );
}
