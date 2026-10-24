import { Headphones } from "lucide-react";
import { LoginForm } from "@/components/LoginForm";
import { SetupNeeded } from "@/components/SetupNeeded";
import { hasSupabaseEnv } from "@/lib/env";
import { safeRedirectPath } from "@/lib/routes";

export const metadata = { title: "Sign in | CallPilot UK" };

export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  if (!hasSupabaseEnv()) return <SetupNeeded />;
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark"><Headphones size={22} strokeWidth={2.5} /></div>
          <div className="auth-brand-name">CallPilot<span>UK</span></div>
        </div>
        <LoginForm
          next={safeRedirectPath(searchParams.next)}
          linkError={searchParams.error === "link"}
        />
      </div>
    </main>
  );
}
