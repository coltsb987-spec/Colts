import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AuthFrame } from "@/components/auth-frame";
import { ButtonLink, Card, Field, Input } from "@/components/ui";
import { getCurrentProfile } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { updatePassword } from "../login/actions";

export const metadata: Metadata = { title: "Choose a new password" };

// Reached from a reset email (which signs you in for this) or from the dashboard to set/change a password.
export default async function ResetPasswordPage() {
  const { user, profile } = await getCurrentProfile();
  if (!user) {
    return (
      <AuthFrame title="That link has expired" intro="Reset links work once and only for a short time. Please ask for a new one.">
        <ButtonLink href="/forgot-password" className="mt-6">Get a new link</ButtonLink>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Choose a new password" intro={`For ${user.email}. You can still sign in with an email link whenever you like.`}>
      <Card className="mt-6">
        <ActionForm action={updatePassword} submitLabel="Save password" pendingLabel="Saving…">
          <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters. Three random words work well.`}>
            <Input type="password" name="password" required minLength={MIN_PASSWORD_LENGTH} maxLength={72} autoComplete="new-password" />
          </Field>
          <Field label="Type it again">
            <Input type="password" name="confirm" required minLength={MIN_PASSWORD_LENGTH} maxLength={72} autoComplete="new-password" />
          </Field>
        </ActionForm>
      </Card>
      <p className="mt-4 text-sm text-ink-soft">
        <Link className="underline" href={profile?.role === "coach" ? "/coach" : "/parent"}>Back to my dashboard</Link>
      </p>
    </AuthFrame>
  );
}
