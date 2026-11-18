"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import type { ActionState } from "@/lib/types";
import { firstError, playerSchema } from "@/lib/validation";

export async function addPlayer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireRole("parent");
  const parsed = playerSchema.safeParse({
    first_name: formData.get("first_name") ?? "",
    age_group: formData.get("age_group") ?? "",
    notes: formData.get("notes") ?? "",
    consent: formData.get("consent") === "on",
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { consent: _consent, ...player } = parsed.data;
  const { error } = await supabase.from("players").insert({
    ...player,
    parent_profile_id: user.id,
    parental_consent_at: new Date().toISOString(),
  });
  if (error) return { error: "Couldn't add the player. Please try again." };
  revalidatePath("/parent");
  return { success: `${parsed.data.first_name} added.` };
}

export async function deletePlayer(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const { supabase, user } = await requireRole("parent");
  const { error } = await supabase.from("players").delete().eq("id", id).eq("parent_profile_id", user.id);
  if (error) return { error: "Couldn't remove." };
  revalidatePath("/parent");
  return { success: "Removed." };
}
