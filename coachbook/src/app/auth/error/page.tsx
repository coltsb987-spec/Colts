import { ButtonLink, Logo } from "@/components/ui";

export default function AuthError() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8">
      <Logo />
      <div className="my-auto py-10">
        <h1 className="text-2xl font-semibold tracking-tight">That link didn&apos;t work</h1>
        <p className="mt-2 text-ink-soft">
          Sign-in links expire after a short time and can only be used once. Please ask for a new one.
        </p>
        <ButtonLink href="/login" className="mt-6">Get a new link</ButtonLink>
      </div>
    </main>
  );
}
