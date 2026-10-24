"use client";

import { AlertCircle } from "lucide-react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Next.js hides server error details in production, so keep this message generic.
  return (
    <main className="centre-screen" role="alert">
      <AlertCircle size={28} />
      <h1>Something went wrong</h1>
      <p>We couldn&apos;t load this page. Please try again.{error.digest ? ` (Reference: ${error.digest})` : ""}</p>
      <div className="modal-actions">
        <button className="primary-button" onClick={reset}>Try again</button>
        <a className="secondary-button" href="/login">Go to sign in</a>
      </div>
    </main>
  );
}
