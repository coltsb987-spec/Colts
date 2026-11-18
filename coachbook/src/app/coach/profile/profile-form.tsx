"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Textarea } from "@/components/ui";
import type { Coach, Profile } from "@/lib/types";
import { slugify } from "@/lib/validation";
import { saveProfile } from "../actions";

export function ProfileForm({ coach, profile }: { coach: Coach | null; profile: Profile }) {
  const [name, setName] = useState(coach?.business_name ?? "");
  const [slug, setSlug] = useState(coach?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(coach));
  const [dbs, setDbs] = useState(coach?.dbs_checked ?? false);
  const [preview, setPreview] = useState<string | null>(coach?.photo_url ?? null);

  return (
    <ActionForm action={saveProfile} submitLabel={coach ? "Save profile" : "Save and continue"} className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name">
          <Input name="full_name" defaultValue={profile.full_name ?? ""} maxLength={120} autoComplete="name" />
        </Field>
        <Field label="Mobile number" hint="Private – only used to contact you about bookings.">
          <Input name="phone" type="tel" defaultValue={profile.phone ?? ""} maxLength={30} autoComplete="tel" />
        </Field>
        <Field label="Business or coaching name" className="sm:col-span-2">
          <Input
            name="business_name"
            required
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            placeholder="e.g. Sam Patel Football Coaching"
          />
        </Field>
        <Field
          label="Your booking link"
          className="sm:col-span-2"
          hint={coach?.slug && slug !== coach.slug ? "Changing this breaks any link you've already shared." : "Lowercase letters, numbers and dashes."}
        >
          <div className="flex items-center rounded-xl border border-sage-line bg-white focus-within:border-ink">
            <span className="pl-3 text-sm text-ink-soft">coachbook.uk/</span>
            <input
              name="slug"
              required
              minLength={3}
              maxLength={50}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
              }}
              className="w-full rounded-r-xl bg-transparent px-1 py-2 focus:outline-none"
            />
          </div>
        </Field>
      </section>

      <section className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
        <div className="h-24 w-24 overflow-hidden rounded-2xl border border-sage-line bg-white">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of an unsaved upload
            <img src={preview} alt="Profile photo preview" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-xs text-ink-soft">No photo</div>
          )}
        </div>
        <Field label="Profile photo" hint="A clear, friendly photo of you. JPG, PNG or WebP, up to 5 MB.">
          <Input
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
            className="file:mr-3 file:rounded-full file:border-0 file:bg-sage file:px-3 file:py-1 file:text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPreview(URL.createObjectURL(f));
            }}
          />
        </Field>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="About you" className="sm:col-span-2" hint="What you coach, who you work with and your style. Parents read this first.">
          <Textarea name="bio" maxLength={2000} rows={5} defaultValue={coach?.bio ?? ""} />
        </Field>
        <Field label="Qualifications" hint="e.g. UEFA C Licence, FA Introduction to Coaching Football, Emergency Aid.">
          <Textarea name="qualifications" maxLength={1000} rows={3} defaultValue={coach?.qualifications ?? ""} />
        </Field>
        <Field label="Postcode" hint="Helps families find you. Only the area is shown publicly.">
          <Input name="postcode" maxLength={10} defaultValue={coach?.postcode ?? ""} autoComplete="postal-code" className="uppercase" />
        </Field>
      </section>

      <section className="rounded-2xl border border-sage-line bg-white/60 p-4">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="dbs_checked" checked={dbs} onChange={(e) => setDbs(e.target.checked)} className="mt-1 h-4 w-4 accent-ink" />
          <span>
            <span className="block font-medium">I hold a current DBS check</span>
            <span className="block text-sm text-ink-soft">
              Shown on your page as &ldquo;DBS checked (coach-declared)&rdquo;. Only tick this if it&apos;s true – you may be asked for proof.
            </span>
          </span>
        </label>
        {dbs && (
          <Field label="Date of DBS certificate" className="mt-3 max-w-xs">
            <Input type="date" name="dbs_date" defaultValue={coach?.dbs_date ?? ""} max={new Date().toISOString().slice(0, 10)} />
          </Field>
        )}
      </section>
    </ActionForm>
  );
}
