import type { Metadata } from "next";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { getMyCoach } from "@/lib/auth";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { coach, profile } = await getMyCoach();
  return (
    <>
      <PageHeader
        title={coach ? "Your profile" : "Set up your profile"}
        description="This is what parents and players see on your booking page."
        action={<ButtonLink href="/coach/setup" variant="secondary">Fill my profile for me</ButtonLink>}
      />
      <Card>
        <ProfileForm coach={coach} profile={profile} />
      </Card>
    </>
  );
}
