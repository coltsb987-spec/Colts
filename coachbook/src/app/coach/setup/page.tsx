import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getMyCoach } from "@/lib/auth";
import { isSetupAssistantConfigured } from "@/lib/setup-assistant/draft";
import { SetupFlow } from "./setup-flow";

export const metadata: Metadata = { title: "Fill my profile for me" };

export default async function SetupPage() {
  const { coach } = await getMyCoach();
  return (
    <>
      <PageHeader
        title="Fill my profile for me"
        description="Paste a few lines about your coaching or a link to your website. Our AI drafts your profile, sessions, hours and answers for parents – you check it before anything is saved."
      />
      {isSetupAssistantConfigured() ? (
        <SetupFlow hasProfile={Boolean(coach)} />
      ) : (
        <p className="rounded-xl border border-sage-line bg-white px-4 py-3">The AI assistant isn&apos;t available right now. Please set up your profile by hand.</p>
      )}
    </>
  );
}
