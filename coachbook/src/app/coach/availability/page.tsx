import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, InlineAction } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { getMyCoach } from "@/lib/auth";
import { formatDate, formatTime, WEEKDAY_ORDER, WEEKDAYS } from "@/lib/format";
import type { AvailabilityException, AvailabilityRule } from "@/lib/types";
import { addAvailabilityException, addAvailabilityRule, deleteAvailabilityException, deleteAvailabilityRule } from "../actions";

export const metadata: Metadata = { title: "Availability" };

export default async function AvailabilityPage() {
  const { supabase, coach } = await getMyCoach();
  if (!coach) redirect("/coach/profile");
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: ruleData }, { data: excData }] = await Promise.all([
    supabase.from("availability_rules").select("*").eq("coach_id", coach.id).order("start_time"),
    supabase.from("availability_exceptions").select("*").eq("coach_id", coach.id).gte("date", today).order("date").order("start_time"),
  ]);
  const rules = (ruleData ?? []) as AvailabilityRule[];
  const exceptions = (excData ?? []) as AvailabilityException[];

  return (
    <>
      <PageHeader
        title="Availability"
        description="Your usual weekly coaching hours. Parents will only be able to book inside these times (UK time)."
      />

      <Card>
        <h2 className="text-lg font-semibold">Weekly hours</h2>
        <ul className="mt-4 divide-y divide-sage-line/80 rounded-xl border border-sage-line/80 bg-white/70">
          {WEEKDAY_ORDER.map((d) => {
            const dayRules = rules.filter((r) => r.weekday === d);
            return (
              <li key={d} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <span className="w-28 shrink-0 font-medium">{WEEKDAYS[d]}</span>
                {dayRules.length === 0 ? (
                  <span className="text-sm text-ink-soft">Not available</span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {dayRules.map((r) => (
                      <span key={r.id} className="inline-flex items-center gap-1 rounded-full border border-sage-line bg-sage py-0.5 pl-3 pr-1 text-sm">
                        {formatTime(r.start_time)}–{formatTime(r.end_time)}
                        {r.location && <span className="text-ink-soft"> · {r.location}</span>}
                        <InlineAction action={deleteAvailabilityRule.bind(null, r.id)} label="✕" />
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <h3 className="mb-3 mt-6 font-semibold">Add hours</h3>
        <ActionForm action={addAvailabilityRule} submitLabel="Add hours">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Day">
              <Select name="weekday" defaultValue="1">
                {WEEKDAY_ORDER.map((d) => (
                  <option key={d} value={d}>{WEEKDAYS[d]}</option>
                ))}
              </Select>
            </Field>
            <Field label="From">
              <Input type="time" name="start_time" required defaultValue="16:00" step={900} />
            </Field>
            <Field label="Until">
              <Input type="time" name="end_time" required defaultValue="19:00" step={900} />
            </Field>
            <Field label="Location (optional)">
              <Input name="location" maxLength={200} placeholder="e.g. Hough End Fields" />
            </Field>
          </div>
        </ActionForm>
      </Card>

      <Card className="mt-6">
        <h2 className="text-lg font-semibold">Holidays and one-off changes</h2>
        <p className="mt-1 text-sm text-ink-soft">Block off days you can&apos;t coach, or add extra hours for a specific date.</p>

        {exceptions.length > 0 && (
          <ul className="mt-4 space-y-2">
            {exceptions.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sage-line/80 bg-white/70 px-4 py-2">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{formatDate(e.date)}</span>
                  <Badge tone={e.kind === "blocked" ? "muted" : "neutral"}>{e.kind === "blocked" ? "Blocked" : "Extra hours"}</Badge>
                  <span className="text-ink-soft">
                    {e.start_time ? `${formatTime(e.start_time)}–${formatTime(e.end_time!)}` : "All day"}
                    {e.note && ` · ${e.note}`}
                  </span>
                </span>
                <InlineAction action={deleteAvailabilityException.bind(null, e.id)} label="Remove" />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6">
          <ActionForm action={addAvailabilityException} submitLabel="Save change" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-5">
              <Field label="Date">
                <Input type="date" name="date" required min={today} />
              </Field>
              <Field label="Change">
                <Select name="kind" defaultValue="blocked">
                  <option value="blocked">Not available</option>
                  <option value="extra">Extra hours</option>
                </Select>
              </Field>
              <Field label="From" hint="Blank = all day">
                <Input type="time" name="start_time" step={900} />
              </Field>
              <Field label="Until">
                <Input type="time" name="end_time" step={900} />
              </Field>
              <Field label="Note (optional)">
                <Input name="note" maxLength={200} placeholder="e.g. Half-term camp" />
              </Field>
            </div>
          </ActionForm>
        </div>
      </Card>
    </>
  );
}
