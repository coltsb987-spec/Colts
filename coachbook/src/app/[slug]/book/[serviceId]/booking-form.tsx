"use client";

import { useActionState, useState } from "react";
import { keepFields } from "@/components/action-form";
import { SlotPicker } from "@/components/slot-picker";
import { Button, Field, Input, Select } from "@/components/ui";
import type { DaySlots } from "@/lib/slots";
import type { ActionState } from "@/lib/types";

const AGE_GROUPS = ["U6", "U7", "U8", "U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17", "U18", "Adult"];

export function BookingForm({
  action,
  days,
  players,
  isGroup,
  payLabel,
  initialStart,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  days: DaySlots[];
  players: { id: string; first_name: string; age_group: string }[];
  isGroup: boolean;
  payLabel: string;
  initialStart?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "new");

  return (
    <form action={formAction} onSubmit={keepFields(formAction)} className="space-y-6">
      <section>
        <h2 className="mb-3 text-lg font-semibold">1. Choose a time</h2>
        <SlotPicker days={days} showSpots={isGroup} initialStart={initialStart} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">2. Who&apos;s playing?</h2>
        <div className="space-y-2">
          {players.map((p) => (
            <label key={p.id} className="flex items-center gap-3 rounded-xl border border-sage-line bg-white px-4 py-3 has-[:checked]:border-ink">
              <input type="radio" name="player_id" value={p.id} checked={playerId === p.id} onChange={() => setPlayerId(p.id)} className="h-4 w-4 accent-ink" />
              <span className="font-medium">{p.first_name}</span>
              <span className="text-sm text-ink-soft">{p.age_group}</span>
            </label>
          ))}
          <label className="flex items-center gap-3 rounded-xl border border-sage-line bg-white px-4 py-3 has-[:checked]:border-ink">
            <input type="radio" name="player_id" value="new" checked={playerId === "new"} onChange={() => setPlayerId("new")} className="h-4 w-4 accent-ink" />
            <span className="font-medium">{players.length ? "Someone else" : "Add a player"}</span>
          </label>
        </div>
        {playerId === "new" && (
          <div className="mt-3 space-y-3 rounded-xl bg-white/60 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="First name" hint="First name only.">
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
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-ink" />
              <span>
                I&apos;m this player&apos;s parent or guardian (or the player, if 18 or over), and I consent to CoachBook UK storing these details and
                sharing them with this coach.
              </span>
            </label>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-sage-line pt-5">
        <Button type="submit" disabled={pending || days.length === 0}>{pending ? "Please wait…" : payLabel}</Button>
        <p aria-live="polite" className="text-sm text-danger">{state?.error}</p>
      </div>
    </form>
  );
}
