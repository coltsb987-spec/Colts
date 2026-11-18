"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState, Service, ServiceType } from "@/lib/types";

const DURATIONS = [30, 45, 60, 75, 90, 120, 180, 240, 360, 480];

export function ServiceForm({
  action,
  service,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  service?: Service;
  submitLabel: string;
}) {
  const [type, setType] = useState<ServiceType>(service?.type ?? "one_to_one");
  const durations = service && !DURATIONS.includes(service.duration_minutes) ? [...DURATIONS, service.duration_minutes].sort((a, b) => a - b) : DURATIONS;

  return (
    <ActionForm action={action} submitLabel={submitLabel} resetOnSuccess={!service}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Session name" className="sm:col-span-2">
          <Input name="name" required minLength={2} maxLength={100} defaultValue={service?.name} placeholder="e.g. 1-to-1 technical session" />
        </Field>
        <Field label="Type">
          <Select name="type" value={type} onChange={(e) => setType(e.target.value as ServiceType)}>
            <option value="one_to_one">1-to-1</option>
            <option value="group">Small group</option>
            <option value="camp">Camp</option>
          </Select>
        </Field>
        <Field label="Length">
          <Select name="duration_minutes" defaultValue={service?.duration_minutes ?? 60}>
            {durations.map((d) => (
              <option key={d} value={d}>
                {d < 60 ? `${d} minutes` : `${d / 60} hour${d === 60 ? "" : "s"}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={type === "one_to_one" ? "Price" : "Price per player"}>
          <div className="flex items-center rounded-xl border border-sage-line bg-white focus-within:border-ink">
            <span className="pl-3 text-ink-soft">£</span>
            <input
              name="price"
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              defaultValue={service ? (service.price_pence / 100).toFixed(service.price_pence % 100 ? 2 : 0) : ""}
              placeholder="35"
              className="w-full rounded-r-xl bg-transparent px-1 py-2 focus:outline-none"
            />
          </div>
        </Field>
        {type !== "one_to_one" ? (
          <Field label="Maximum players">
            <Input type="number" name="max_participants" min={1} max={200} required defaultValue={service?.max_participants ?? (type === "camp" ? 20 : 6)} />
          </Field>
        ) : (
          <input type="hidden" name="max_participants" value={1} />
        )}
        <Field label="Location" className="sm:col-span-2" hint="Pitch or venue name and town. Leave blank to use the location from your availability.">
          <Input name="location" maxLength={200} defaultValue={service?.location ?? ""} placeholder="e.g. Platt Fields 3G, Manchester" />
        </Field>
        <Field label="Description (optional)" className="sm:col-span-2">
          <Textarea name="description" maxLength={1000} rows={3} defaultValue={service?.description ?? ""} placeholder="What players will work on, what to bring, ages." />
        </Field>
      </div>
    </ActionForm>
  );
}
