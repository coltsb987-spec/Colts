"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionState } from "@/lib/types";
import { Button } from "./ui";

type Props = {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  resetOnSuccess?: boolean;
  className?: string;
};

// A form wired to a Server Action that shows errors / success messages inline.
export function ActionForm({ action, children, submitLabel, pendingLabel = "Saving…", resetOnSuccess, className }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.success) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className ?? "space-y-4"}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? pendingLabel : submitLabel}</Button>
        <p aria-live="polite" className="text-sm">
          {state?.error && <span className="text-danger">{state.error}</span>}
          {state?.success && <span className="text-ink-soft">{state.success}</span>}
        </p>
      </div>
    </form>
  );
}

// A small one-button form (e.g. Delete) that runs a Server Action.
export function InlineAction({
  action,
  label,
  confirm,
  variant = "quiet",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "quiet";
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex items-center gap-2"
    >
      <Button type="submit" variant={variant} disabled={pending}>{pending ? "…" : label}</Button>
      {state?.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
