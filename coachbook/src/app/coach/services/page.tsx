import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InlineAction } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getMyCoach } from "@/lib/auth";
import { formatDuration, formatPrice, SERVICE_TYPE_LABELS } from "@/lib/format";
import type { Service } from "@/lib/types";
import { addService, deleteService, setServiceActive, updateService } from "../actions";
import { ServiceForm } from "./service-form";

export const metadata: Metadata = { title: "Sessions & prices" };

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { supabase, coach } = await getMyCoach();
  if (!coach) redirect("/coach/profile");
  const { welcome } = await searchParams;

  const { data } = await supabase.from("services").select("*").eq("coach_id", coach.id).order("created_at");
  const services = (data ?? []) as Service[];

  return (
    <>
      {welcome && services.length === 0 && (
        <p className="mb-4 rounded-xl bg-lime px-4 py-3 text-sm font-medium">Profile saved. Next, add the sessions you offer.</p>
      )}
      <PageHeader title="Sessions & prices" description="The types of session parents can book with you." />

      {services.length > 0 && (
        <ul className="mb-6 space-y-3">
          {services.map((s) => (
            <li key={s.id}>
              <Card className={s.active ? "" : "opacity-70"}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{s.name}</h2>
                      <Badge>{SERVICE_TYPE_LABELS[s.type]}</Badge>
                      {!s.active && <Badge tone="muted">Hidden</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">
                      {formatDuration(s.duration_minutes)} · {formatPrice(s.price_pence)}
                      {s.type !== "one_to_one" && ` per player · up to ${s.max_participants}`}
                      {s.location && ` · ${s.location}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <InlineAction action={setServiceActive.bind(null, s.id, !s.active)} label={s.active ? "Hide" : "Show"} />
                    <InlineAction action={deleteService.bind(null, s.id)} label="Delete" confirm={`Delete “${s.name}”?`} />
                  </div>
                </div>
                <details className="mt-3 group">
                  <summary className="cursor-pointer text-sm font-medium text-ink-soft hover:text-ink">Edit</summary>
                  <div className="mt-4 rounded-xl bg-canvas p-4">
                    <ServiceForm action={updateService.bind(null, s.id)} service={s} submitLabel="Save changes" />
                  </div>
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <h2 className="mb-4 text-lg font-semibold">{services.length ? "Add another session" : "Add your first session"}</h2>
        <ServiceForm action={addService} submitLabel="Add session" />
      </Card>
    </>
  );
}
