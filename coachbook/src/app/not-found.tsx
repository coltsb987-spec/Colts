import { ButtonLink, Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8">
      <Logo />
      <div className="my-auto py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-ink-soft">We couldn&apos;t find that page. If you followed a coach&apos;s link, check it with them – it may have changed.</p>
        <ButtonLink href="/" className="mt-6">Go to CoachBook UK</ButtonLink>
      </div>
    </main>
  );
}
