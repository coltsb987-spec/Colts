"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { businessSchema, firstErrors, type FieldErrors } from "@/lib/validation";

export type BusinessFormState = { ok?: boolean; errors?: FieldErrors; message?: string };

export async function createBusiness(_prev: BusinessFormState, formData: FormData): Promise<BusinessFormState> {
  const parsed = businessSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    businessType: formData.get("businessType"),
  });
  if (!parsed.success) return { errors: firstErrors(parsed.error) };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "Your session has expired. Please sign in again." };

  // RLS rejects this insert unless the user is a member of the workspace.
  const { error } = await supabase.from("businesses").insert({
    workspace_id: parsed.data.workspaceId,
    name: parsed.data.name,
    business_type: parsed.data.businessType,
    created_by: user.id,
  });
  if (error) {
    return {
      message:
        error.code === "42501"
          ? "You don't have permission to add businesses to this workspace."
          : "We couldn't save the business. Please try again.",
    };
  }
  revalidatePath("/");
  return { ok: true, message: "Business added. Connect a phone provider before taking live calls." };
}
