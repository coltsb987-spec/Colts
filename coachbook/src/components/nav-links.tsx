"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
      {links.map((l) => {
        const active = l.href === path || (l.href.split("/").length > 2 && path.startsWith(l.href));
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-ink text-canvas" : "text-ink-soft hover:bg-sage hover:text-ink"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
