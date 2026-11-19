"use client";

import { useState } from "react";
import type { DaySlots } from "@/lib/slots";

const TZ = "Europe/London";
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" });
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });
const longFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const noon = (date: string) => new Date(`${date}T12:00:00Z`);

/** Choose a day, then a time. Submits the chosen start as a hidden "start" field. */
export function SlotPicker({ days, showSpots, name = "start", initialStart }: { days: DaySlots[]; showSpots?: boolean; name?: string; initialStart?: string }) {
  // A link from the AI receptionist can pre-select a time (if it's still free).
  const initialDay = initialStart ? days.find((d) => d.slots.some((s) => s.start === initialStart))?.date : undefined;
  const [day, setDay] = useState(initialDay ?? days[0]?.date ?? "");
  const [start, setStart] = useState(initialDay ? initialStart! : "");
  const current = days.find((d) => d.date === day);

  if (days.length === 0) {
    return <p className="rounded-xl bg-white/70 p-4 text-ink-soft">No times are free in the next four weeks. Please check back soon.</p>;
  }

  return (
    <div>
      <input type="hidden" name={name} value={start} required />
      <div role="radiogroup" aria-label="Day" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {days.map((d) => {
          const selected = d.date === day;
          return (
            <button
              key={d.date}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setDay(d.date);
                setStart("");
              }}
              className={`flex min-w-16 shrink-0 flex-col items-center rounded-2xl border px-3 py-2 text-sm transition-colors ${
                selected ? "border-ink bg-ink text-canvas" : "border-sage-line bg-white hover:border-ink/40"
              }`}
            >
              <span className="font-medium">{dayFmt.format(noon(d.date))}</span>
              <span className={selected ? "text-canvas/80" : "text-ink-soft"}>{dateFmt.format(noon(d.date))}</span>
            </button>
          );
        })}
      </div>

      {current && (
        <fieldset className="mt-3">
          <legend className="mb-2 text-sm font-medium">{longFmt.format(noon(current.date))}</legend>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {current.slots.map((s) => {
              const selected = s.start === start;
              return (
                <button
                  key={s.start}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setStart(s.start)}
                  className={`rounded-xl border px-2 py-2 text-sm font-medium transition-colors ${
                    selected ? "border-ink bg-lime text-ink" : "border-sage-line bg-white hover:border-ink/40"
                  }`}
                >
                  {timeFmt.format(new Date(s.start))}
                  {showSpots && <span className="block text-xs font-normal text-ink-soft">{s.spotsLeft} left</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}
