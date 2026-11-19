"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, ButtonLink, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { WEEKDAY_ORDER, WEEKDAYS } from "@/lib/format";
import type { ProfileDraft } from "@/lib/setup-assistant/schema";
import { MAX_LINKS, MAX_SOURCE_CHARS } from "@/lib/setup-assistant/schema";
import { applyDraft, requestDraft, type ApplyState } from "./actions";

type Svc = ProfileDraft["services"][number] & { keep: boolean; priceText: string };
type Hours = ProfileDraft["weekly_hours"][number] & { keep: boolean };
type Faq = ProfileDraft["faqs"][number] & { keep: boolean };
type ProfileKey = "business_name" | "bio" | "qualifications" | "postcode";

const PROFILE_FIELDS: { key: ProfileKey; label: string; long?: boolean }[] = [
  { key: "business_name", label: "Business name" },
  { key: "bio", label: "About you", long: true },
  { key: "qualifications", label: "Qualifications", long: true },
  { key: "postcode", label: "Postcode" },
];

const busyMessages = ["Reading what you sent…", "Drafting your profile…", "Writing answers for parents…", "Nearly there…"];

export function SetupFlow({ hasProfile }: { hasProfile: boolean }) {
  const [pastedText, setPastedText] = useState("");
  const [links, setLinks] = useState<string[]>([""]);
  const [linkNotes, setLinkNotes] = useState("");
  const [round, setRound] = useState(0);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"drafting" | "saving">("drafting");
  const [busyIdx, setBusyIdx] = useState(0);
  const [result, setResult] = useState<ApplyState | null>(null);

  // editable review state
  const [profile, setProfile] = useState<Record<ProfileKey, { value: string; keep: boolean }>>();
  const [services, setServices] = useState<Svc[]>([]);
  const [hours, setHours] = useState<Hours[]>([]);
  const [faqs, setFaqs] = useState<Faq[]>([]);

  function loadDraft(d: ProfileDraft) {
    setDraft(d);
    setAnswers({});
    setProfile(
      Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, { value: d[f.key] ?? "", keep: Boolean(d[f.key]) }])) as Record<ProfileKey, { value: string; keep: boolean }>,
    );
    setServices(d.services.map((s) => ({ ...s, keep: true, priceText: s.price_pounds == null ? "" : String(s.price_pounds) })));
    setHours(d.weekly_hours.map((h) => ({ ...h, keep: true })));
    setFaqs(d.faqs.map((f) => ({ ...f, keep: true })));
  }

  function run(withAnswers: boolean) {
    setError(null);
    setMode("drafting");
    setBusyIdx(0);
    const timer = setInterval(() => setBusyIdx((i) => Math.min(i + 1, busyMessages.length - 1)), 6000);
    start(async () => {
      const res = await requestDraft({
        pastedText,
        links: links.map((l) => l.trim()).filter(Boolean),
        linkNotes,
        round,
        previous: withAnswers ? draft : null,
        answers: withAnswers ? (draft?.questions ?? []).map((q) => ({ question: q.question, answer: answers[q.id] ?? "" })) : [],
      });
      clearInterval(timer);
      if (!res.ok) return setError(res.error);
      setLinkNotes(res.linkNotes);
      setRound(res.round);
      loadDraft(res.draft);
    });
  }

  function save() {
    setError(null);
    setMode("saving");
    start(async () => {
      const res = await applyDraft({
        profile: Object.fromEntries(Object.entries(profile ?? {}).filter(([, v]) => v.keep).map(([k, v]) => [k, v.value])),
        services: services.filter((s) => s.keep).map((s) => ({ name: s.name, type: s.type, duration_minutes: s.duration_minutes, price: s.priceText, max_participants: s.max_participants, location: s.location, description: s.description })),
        weekly_hours: hours.filter((h) => h.keep).map(({ keep: _k, ...h }) => h),
        faqs: faqs.filter((f) => f.keep).map(({ q, a }) => ({ q, a })),
      });
      if (!res.ok) return setError(res.error);
      setResult(res);
    });
  }

  if (result?.ok) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">Saved</h2>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {result.saved.map((s) => <li key={s}>{s}</li>)}
        </ul>
        {result.skipped.length > 0 && (
          <>
            <p className="mt-3 text-sm font-medium">Not saved – please add these by hand:</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-ink-soft">{result.skipped.map((s) => <li key={s}>{s}</li>)}</ul>
          </>
        )}
        <p className="mt-3 text-sm text-ink-soft">Check everything, add a photo, and tick your DBS box yourself on the Profile page if it applies.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href="/coach">Go to my dashboard</ButtonLink>
          <ButtonLink href="/coach/profile" variant="secondary">Open my profile</ButtonLink>
        </div>
      </Card>
    );
  }

  if (pending) {
    return (
      <Card className="flex items-center gap-3" aria-live="polite">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink/20 border-t-ink" aria-hidden />
        <p>{mode === "saving" ? "Saving…" : busyMessages[busyIdx]}</p>
      </Card>
    );
  }

  if (!draft) {
    return (
      <Card className="space-y-5">
        <Field label="Tell us about your coaching" hint="Paste your bio, an advert or a few lines: what you coach, ages, prices, when you're free, where. Rough notes are fine.">
          <Textarea value={pastedText} onChange={(e) => setPastedText(e.target.value)} maxLength={MAX_SOURCE_CHARS} rows={7}
            placeholder="e.g. I'm Sam, UEFA C coach in Bolton. 1-to-1s £30/hr for ages 7-14, small groups of 6 for £12 each on Saturday mornings at Moss Bank 3G. Free most weekday evenings 4-8pm." />
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium">Links (optional)</p>
          <p className="mb-2 text-xs text-ink-soft">Your website or a public page about your coaching. Instagram and Facebook often can&apos;t be read without logging in – paste your bio text above instead.</p>
          <div className="space-y-2">
            {links.map((l, i) => (
              <Input key={i} type="url" value={l} placeholder="https://" aria-label={`Link ${i + 1}`} onChange={(e) => setLinks(links.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
          </div>
          {links.length < MAX_LINKS && (
            <button type="button" onClick={() => setLinks([...links, ""])} className="mt-2 text-sm font-medium text-ink-soft hover:text-ink">+ Add another link</button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => run(false)} disabled={!pastedText.trim() && !links.some((l) => l.trim())}>Fill my profile for me</Button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
        <p className="text-xs text-ink-soft">Claude (our AI) drafts it only from what you give it. Nothing is saved until you check and approve it.</p>
      </Card>
    );
  }

  const toggleAll = draft.questions.length > 0;
  return (
    <div className="space-y-4">
      {toggleAll && (
        <Card>
          <h2 className="text-lg font-semibold">A few quick questions</h2>
          <p className="text-sm text-ink-soft">Answer what you can, then update the draft – or skip and edit below.</p>
          <div className="mt-3 space-y-3">
            {draft.questions.map((q) => (
              <Field key={q.id} label={q.question}>
                <Input value={answers[q.id] ?? ""} maxLength={1000} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
              </Field>
            ))}
          </div>
          <Button variant="secondary" className="mt-4" onClick={() => run(true)} disabled={!Object.values(answers).some((a) => a.trim()) || round >= 5}>
            Update my draft
          </Button>
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold">Your profile</h2>
        <p className="mb-3 text-sm text-ink-soft">Untick anything you don&apos;t want. You can edit the wording.</p>
        <div className="space-y-3">
          {PROFILE_FIELDS.map((f) => {
            const v = profile![f.key];
            if (!v.value && !v.keep) return null;
            return (
              <div key={f.key} className="flex gap-3">
                <input type="checkbox" aria-label={`Use ${f.label}`} checked={v.keep} onChange={(e) => setProfile({ ...profile!, [f.key]: { ...v, keep: e.target.checked } })} className="mt-8 h-4 w-4 accent-ink" />
                <Field label={f.label} className="flex-1">
                  {f.long ? (
                    <Textarea value={v.value} rows={f.key === "bio" ? 4 : 2} maxLength={2000} onChange={(e) => setProfile({ ...profile!, [f.key]: { ...v, value: e.target.value } })} />
                  ) : (
                    <Input value={v.value} maxLength={100} onChange={(e) => setProfile({ ...profile!, [f.key]: { ...v, value: e.target.value } })} />
                  )}
                </Field>
              </div>
            );
          })}
          {draft.dbs_mentioned && (
            <p className="rounded-xl bg-white/70 px-3 py-2 text-sm">Your details mention a DBS check. For safeguarding, please tick that yourself on your Profile page – we never tick it for you.</p>
          )}
          {!hasProfile && !profile!.business_name.keep && <p className="text-sm text-danger">A business name is needed to create your page.</p>}
        </div>
      </Card>

      {services.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Sessions & prices</h2>
          <ul className="space-y-3">
            {services.map((s, i) => {
              const set = (patch: Partial<Svc>) => setServices(services.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <li key={i} className={`flex gap-3 rounded-2xl border border-sage-line bg-white/70 p-3 ${s.keep ? "" : "opacity-60"}`}>
                  <input type="checkbox" aria-label={`Use session ${s.name}`} checked={s.keep} onChange={(e) => set({ keep: e.target.checked })} className="mt-2 h-4 w-4 accent-ink" />
                  <div className="grid flex-1 gap-2 sm:grid-cols-4">
                    <Input aria-label="Session name" value={s.name} onChange={(e) => set({ name: e.target.value })} className="sm:col-span-4" />
                    <Select aria-label="Type" value={s.type} onChange={(e) => set({ type: e.target.value as Svc["type"] })}>
                      <option value="one_to_one">1-to-1</option><option value="group">Small group</option><option value="camp">Camp</option>
                    </Select>
                    <div className="flex items-center rounded-xl border border-sage-line bg-white focus-within:border-ink">
                      <input aria-label="Minutes" type="number" min={15} max={720} value={s.duration_minutes} onChange={(e) => set({ duration_minutes: Number(e.target.value) })} className="w-full rounded-l-xl bg-transparent px-3 py-2 focus:outline-none" />
                      <span className="pr-3 text-sm text-ink-soft">min</span>
                    </div>
                    <div className="flex items-center rounded-xl border border-sage-line bg-white focus-within:border-ink">
                      <span className="pl-3 text-ink-soft">£</span>
                      <input aria-label="Price" inputMode="decimal" value={s.priceText} placeholder="Price?" onChange={(e) => set({ priceText: e.target.value })} className="w-full rounded-r-xl bg-transparent px-1 py-2 focus:outline-none" />
                    </div>
                    {s.type !== "one_to_one" ? (
                      <Input aria-label="Max players" type="number" min={1} max={200} placeholder="Max players" value={s.max_participants ?? ""} onChange={(e) => set({ max_participants: e.target.value ? Number(e.target.value) : null })} />
                    ) : <span />}
                    {s.keep && !s.priceText && <p className="text-xs text-danger sm:col-span-4">Add a price (0 for free) or untick this session.</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {hours.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Weekly hours</h2>
          <ul className="space-y-2">
            {hours.map((h, i) => {
              const set = (patch: Partial<Hours>) => setHours(hours.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" aria-label="Use these hours" checked={h.keep} onChange={(e) => set({ keep: e.target.checked })} className="h-4 w-4 accent-ink" />
                  <div className="w-40">
                    <Select aria-label="Day" value={h.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                      {WEEKDAY_ORDER.map((d) => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
                    </Select>
                  </div>
                  <div className="w-36"><Input aria-label="From" type="time" value={h.start} onChange={(e) => set({ start: e.target.value })} /></div>
                  <span className="text-sm text-ink-soft">to</span>
                  <div className="w-36"><Input aria-label="Until" type="time" value={h.end} onChange={(e) => set({ end: e.target.value })} /></div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {faqs.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">Answers for your AI receptionist</h2>
          <p className="mb-3 text-sm text-ink-soft">These go into your receptionist&apos;s FAQs.</p>
          <ul className="space-y-3">
            {faqs.map((f, i) => {
              const set = (patch: Partial<Faq>) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <li key={i} className="flex gap-3">
                  <input type="checkbox" aria-label="Use this answer" checked={f.keep} onChange={(e) => set({ keep: e.target.checked })} className="mt-3 h-4 w-4 accent-ink" />
                  <div className="grid flex-1 gap-1">
                    <Input aria-label="Question" value={f.q} onChange={(e) => set({ q: e.target.value })} className="font-medium" />
                    <Textarea aria-label="Answer" value={f.a} rows={2} onChange={(e) => set({ a: e.target.value })} className="min-h-14" />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {draft.notes.length > 0 && (
        <Card className="bg-white/50">
          <h2 className="font-semibold">Notes</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-soft">{draft.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={services.some((s) => s.keep && !s.priceText.trim()) || (!hasProfile && !profile!.business_name.keep)}>Save what&apos;s ticked</Button>
        <button type="button" onClick={() => { setDraft(null); setLinkNotes(""); setRound(0); }} className="text-sm font-medium text-ink-soft hover:text-ink">Start again</button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
      <p className="text-xs text-ink-soft">Drafted by AI from your details. Please check it&apos;s accurate before saving – <Link className="underline" href="/coach/profile">or set things up by hand</Link>.</p>
    </div>
  );
}
