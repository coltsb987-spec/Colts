"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { signIn, signUp, type AuthState } from "@/app/actions/auth";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="primary-button auth-submit" disabled={pending} aria-busy={pending}>
      {pending && <Loader2 size={16} className="spin" />} {pending ? "Please wait…" : label}
    </button>
  );
}

export function LoginForm({ next, linkError }: { next: string; linkError: boolean }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInState, signInAction] = useFormState<AuthState, FormData>(signIn, {});
  const [signUpState, signUpAction] = useFormState<AuthState, FormData>(signUp, {});
  const state = mode === "signin" ? signInState : signUpState;
  const isSuccess = mode === "signup" && !!signUpState.message && !signUpState.errors && signUpState.message.startsWith("Check");

  return (
    <>
      <h1>{mode === "signin" ? "Sign in to your workspace" : "Create your account"}</h1>
      <p className="auth-sub">
        {mode === "signin" ? "Manage your AI receptionists and client businesses." : "You'll get your own private workspace."}
      </p>
      {linkError && mode === "signin" && !state.message && (
        <div className="form-alert" role="alert"><AlertCircle size={16} /> That link is invalid or has expired. Please sign in or request a new one.</div>
      )}
      {state.message && (
        <div className={isSuccess ? "form-success" : "form-alert"} role={isSuccess ? "status" : "alert"}>
          {isSuccess ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {state.message}
        </div>
      )}
      <form action={mode === "signin" ? signInAction : signUpAction} className="auth-form" noValidate key={mode}>
        <input type="hidden" name="next" value={next} />
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required defaultValue={state.email}
            aria-invalid={!!state.errors?.email} aria-describedby={state.errors?.email ? "email-error" : undefined} />
          {state.errors?.email && <span className="field-error" id="email-error">{state.errors.email}</span>}
        </label>
        <label>
          Password
          <input name="password" type="password" required
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={mode === "signup" ? 10 : undefined} maxLength={72}
            aria-invalid={!!state.errors?.password} aria-describedby={state.errors?.password ? "password-error" : undefined} />
          {state.errors?.password && <span className="field-error" id="password-error">{state.errors.password}</span>}
          {mode === "signup" && !state.errors?.password && <span className="field-hint">At least 10 characters.</span>}
        </label>
        <SubmitButton label={mode === "signin" ? "Sign in" : "Create account"} />
      </form>
      <p className="auth-switch">
        {mode === "signin" ? "New to CallPilot UK?" : "Already have an account?"}{" "}
        <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </>
  );
}
