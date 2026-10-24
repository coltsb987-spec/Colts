import { Settings } from "lucide-react";

export function SetupNeeded() {
  return (
    <main className="centre-screen">
      <Settings size={28} />
      <h1>Setup needed</h1>
      <p>
        CallPilot UK isn&apos;t connected to its database yet. Copy <code>.env.example</code> to <code>.env.local</code>,
        add your Supabase project URL and publishable key, then restart the app. See the README for step-by-step instructions.
      </p>
    </main>
  );
}
