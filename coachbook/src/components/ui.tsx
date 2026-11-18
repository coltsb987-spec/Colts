import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// Main call-to-action: lime with charcoal text.
export const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-lime-deep disabled:cursor-not-allowed disabled:opacity-60";
// Everything else stays calm.
export const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-full border border-ink/20 bg-white/60 px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-ink/40 hover:bg-white disabled:opacity-60";
export const quietButton =
  "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sage hover:text-ink";

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "quiet" }) {
  const base = variant === "primary" ? primaryButton : variant === "secondary" ? secondaryButton : quietButton;
  return <button className={cx(base, className)} {...props} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: "primary" | "secondary" | "quiet" }) {
  const base = variant === "primary" ? primaryButton : variant === "secondary" ? secondaryButton : quietButton;
  return <Link className={cx(base, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-2xl border border-sage-line/70 bg-sage p-5 sm:p-6", className)} {...props} />;
}

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-ink-soft">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const inputBase =
  "w-full rounded-xl border border-sage-line bg-white px-3 py-2 text-ink placeholder:text-ink-soft/60 focus:border-ink focus:outline-none";

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(inputBase, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(inputBase, "min-h-24", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(inputBase, "pr-8", className)} {...props} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "muted"; children: ReactNode }) {
  const tones = {
    neutral: "bg-white text-ink border border-sage-line",
    accent: "bg-lime text-ink",
    muted: "bg-ink/5 text-ink-soft",
  };
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight">
      <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-lime text-ink">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5l3.5 2.5-1.3 4h-4.4l-1.3-4z M12 3v4.5 M15.5 10l4.8-1.5 M14.2 14l2.6 4.5 M9.8 14l-2.6 4.5 M8.5 10L3.7 8.5" />
        </svg>
      </span>
      <span>CoachBook <span className="text-ink-soft">UK</span></span>
    </Link>
  );
}
