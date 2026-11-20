import type { ReactNode } from "react";
import { Logo } from "./ui";

export function AuthFrame({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8">
      <Logo />
      <div className="my-auto py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {intro && <p className="mt-1 text-ink-soft">{intro}</p>}
        {children}
      </div>
    </main>
  );
}
