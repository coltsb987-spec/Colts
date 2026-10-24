import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <main className="centre-screen" aria-busy="true">
      <Loader2 size={26} className="spin" />
      <p>Loading your workspace…</p>
    </main>
  );
}
