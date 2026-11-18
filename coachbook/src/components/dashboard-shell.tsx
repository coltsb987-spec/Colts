import type { ReactNode } from "react";
import { Logo } from "./ui";
import { NavLinks } from "./nav-links";

export function DashboardShell({
  home,
  links,
  name,
  children,
}: {
  home: string;
  links: { href: string; label: string }[];
  name?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-sage-line/70 bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Logo href={home} />
          <div className="flex items-center gap-3 text-sm">
            {name && <span className="hidden text-ink-soft sm:inline">{name}</span>}
            <form action="/auth/signout" method="post">
              <button className="rounded-full px-3 py-1.5 font-medium text-ink-soft hover:bg-sage hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
        <NavLinks links={links} />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
