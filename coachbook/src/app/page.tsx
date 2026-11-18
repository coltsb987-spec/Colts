import Link from "next/link";
import { ButtonLink, Card, Logo } from "@/components/ui";

const features = [
  { title: "Your own booking page", body: "One link for 1-to-1s, small groups and camps – with your prices, hours, qualifications and DBS status." },
  { title: "Paid up front", body: "Parents pay when they book, straight to your account. Fewer no-shows, no chasing bank transfers." },
  { title: "An AI receptionist", body: "Answers parents' questions, checks your availability and takes bookings – even while you're on the pitch." },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Logo />
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/login?as=parent" className="rounded-full px-3 py-1.5 font-medium text-ink-soft hover:bg-sage hover:text-ink">Parents</Link>
          <Link href="/login?as=coach" className="rounded-full px-3 py-1.5 font-medium text-ink-soft hover:bg-sage hover:text-ink">Coach sign in</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-14 sm:py-20">
          <p className="mb-4 inline-flex rounded-full bg-sage px-3 py-1 text-sm font-medium">For UK football coaches</p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
            Spend your time coaching, <span className="relative whitespace-nowrap"><span className="relative z-10">not admin.</span><span aria-hidden className="absolute inset-x-0 bottom-1 -z-0 h-3 rounded bg-lime sm:h-4" /></span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-soft">
            CoachBook UK gives you a booking page, online payments and an AI receptionist that handles enquiries from parents – so
            your evenings aren&apos;t spent replying to WhatsApps.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/login?as=coach">Create your booking page</ButtonLink>
            <ButtonLink href="/login?as=parent" variant="secondary">I&apos;m a parent or player</ButtonLink>
          </div>
          <p className="mt-3 text-sm text-ink-soft">Free during the pilot. No card needed.</p>
        </section>

        <section className="grid gap-4 pb-16 md:grid-cols-3">
          {features.map((f, i) => (
            <Card key={f.title}>
              <span className="mb-4 grid h-9 w-9 place-items-center rounded-full bg-ink text-sm font-semibold text-lime">{i + 1}</span>
              <h2 className="text-lg font-semibold">{f.title}</h2>
              <p className="mt-1 text-ink-soft">{f.body}</p>
            </Card>
          ))}
        </section>
      </main>

      <footer className="border-t border-sage-line/70">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-ink-soft">
          © {new Date().getFullYear()} CoachBook UK. Coaches listed on CoachBook UK are independent and are not employed by us.
        </div>
      </footer>
    </div>
  );
}
