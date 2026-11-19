"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { TONES, type ReceptionistSettings } from "@/lib/receptionist/settings";
import { saveReceptionistSettings } from "./actions";

const STARTER_FAQS = [
  { q: "What should my child bring?", a: "" },
  { q: "What happens if it rains?", a: "" },
  { q: "Where do I park?", a: "" },
];

export function ReceptionistSettingsForm({ settings, defaultGreeting }: { settings: ReceptionistSettings; defaultGreeting: string }) {
  const [faqs, setFaqs] = useState(settings.faqs.length ? settings.faqs : STARTER_FAQS);
  const [enabled, setEnabled] = useState(settings.enabled);

  return (
    <ActionForm action={saveReceptionistSettings} submitLabel="Save settings" className="space-y-6">
      <input type="hidden" name="faqs" value={JSON.stringify(faqs)} />

      <label className="flex items-start gap-3 rounded-2xl border border-sage-line bg-white/70 p-4">
        <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-1 h-5 w-5 accent-ink" />
        <span>
          <span className="block font-semibold">Show the AI receptionist on my booking page</span>
          <span className="block text-sm text-ink-soft">
            A chat button appears on your page. It answers questions from your details below, checks your free times, takes bookings
            with payment links, and lets parents cancel or move within your rules. Anything else comes to you.
          </span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tone of voice">
          <Select name="tone" defaultValue={settings.tone}>
            {Object.entries(TONES).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </Field>
        <Field label="Parents can cancel or move online up to" hint="Closer to the session, the receptionist passes requests to you.">
          <Select name="cancellation_notice_hours" defaultValue={String(settings.cancellation_notice_hours)}>
            {[[0, "Any time before"], [12, "12 hours before"], [24, "24 hours before"], [48, "48 hours before"], [72, "3 days before"], [168, "1 week before"]].map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </Field>
        <Field label="Greeting" className="sm:col-span-2" hint="The first message people see. Leave blank for the default.">
          <Input name="greeting" maxLength={300} defaultValue={settings.greeting} placeholder={defaultGreeting} />
        </Field>
      </div>

      <section>
        <h2 className="font-semibold">Your answers to common questions</h2>
        <p className="mb-3 text-sm text-ink-soft">The receptionist only answers from these, your profile and your sessions. It never makes things up – if it doesn&apos;t know, it asks you.</p>
        <ul className="space-y-3">
          {faqs.map((f, i) => (
            <li key={i} className="rounded-2xl border border-sage-line bg-white/70 p-3">
              <div className="grid gap-2">
                <Input
                  aria-label={`Question ${i + 1}`}
                  value={f.q}
                  maxLength={200}
                  placeholder="Question"
                  onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))}
                  className="font-medium"
                />
                <Textarea
                  aria-label={`Answer ${i + 1}`}
                  value={f.a}
                  maxLength={1000}
                  rows={2}
                  placeholder="Your answer"
                  onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))}
                  className="min-h-16"
                />
              </div>
              <button type="button" onClick={() => setFaqs(faqs.filter((_, j) => j !== i))} className="mt-1 text-sm text-ink-soft hover:text-ink">Remove</button>
            </li>
          ))}
        </ul>
        {faqs.length < 30 && (
          <button type="button" onClick={() => setFaqs([...faqs, { q: "", a: "" }])} className="mt-3 rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-medium hover:border-ink/40">
            + Add a question
          </button>
        )}
      </section>

      <Field label="Anything else it should know? (optional)" hint="e.g. 'Sessions for under-8s must have a parent present.' or 'Always mention our summer camp.'">
        <Textarea name="extra_instructions" maxLength={1000} rows={3} defaultValue={settings.extra_instructions} />
      </Field>
    </ActionForm>
  );
}
