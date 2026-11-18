import type { Metadata } from "next";
import { ActionForm, InlineAction } from "@/components/action-form";
import { Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import type { Player } from "@/lib/types";
import { addPlayer, deletePlayer } from "./actions";

export const metadata: Metadata = { title: "My players" };

const AGE_GROUPS = ["U6", "U7", "U8", "U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17", "U18", "Adult"];

export default async function ParentHome({ searchParams }: { searchParams: Promise<{ wrong_area?: string }> }) {
  const { supabase, user } = await requireRole("parent");
  const { wrong_area } = await searchParams;
  const { data } = await supabase.from("players").select("*").eq("parent_profile_id", user.id).order("created_at");
  const players = (data ?? []) as Player[];

  return (
    <>
      {wrong_area === "coach" && (
        <p className="mb-4 rounded-xl border border-sage-line bg-white px-4 py-3 text-sm">
          This email is registered as a parent account, so it can&apos;t open the coach area. To coach, sign in with a different email.
        </p>
      )}
      <PageHeader
        title="My players"
        description="Add the children (or yourself) you book sessions for. We only ask for what a coach needs to run a safe session."
      />

      {players.length > 0 && (
        <ul className="mb-6 grid gap-3 sm:grid-cols-2">
          {players.map((p) => (
            <li key={p.id}>
              <Card className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{p.first_name}</p>
                  <p className="text-sm text-ink-soft">{p.age_group}</p>
                  {p.notes && <p className="mt-2 text-sm">{p.notes}</p>}
                </div>
                <InlineAction action={deletePlayer.bind(null, p.id)} label="Remove" confirm={`Remove ${p.first_name}?`} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Add a player</h2>
        <ActionForm action={addPlayer} submitLabel="Add player" resetOnSuccess>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" hint="First name only – no surname needed.">
              <Input name="first_name" required maxLength={50} autoComplete="off" />
            </Field>
            <Field label="Age group">
              <Select name="age_group" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {AGE_GROUPS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </Select>
            </Field>
            <Field label="Anything the coach should know? (optional)" className="sm:col-span-2" hint="e.g. position, experience, or anything that helps them coach safely. Don't include medical details you're not comfortable sharing.">
              <Textarea name="notes" maxLength={500} rows={2} />
            </Field>
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-sage-line bg-white/60 p-3 text-sm">
            <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-ink" />
            <span>
              I&apos;m this player&apos;s parent or guardian (or the player, if 18 or over), and I consent to CoachBook UK storing these details
              and sharing them with coaches I book.
            </span>
          </label>
        </ActionForm>
      </Card>

      <Card className="mt-6 bg-white/50">
        <h2 className="font-semibold">Booking sessions</h2>
        <p className="mt-1 text-sm text-ink-soft">Open your coach&apos;s CoachBook link, choose a session and a time, and pay securely online.</p>
      </Card>
    </>
  );
}
