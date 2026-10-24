import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
const getUser = vi.fn();
const signInWithPassword = vi.fn();
const signUp = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser, signInWithPassword, signUp, signOut: vi.fn() },
    from: () => ({ insert }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: () => new Headers({ host: "localhost:3000" }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const { createBusiness } = await import("@/app/actions/businesses");
const auth = await import("@/app/actions/auth");

const WS = "3f1c2a4e-8b7d-4c6a-9e2f-1a2b3c4d5e6f";
function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  insert.mockResolvedValue({ error: null });
});

describe("createBusiness", () => {
  it("returns field errors and does not touch the database for invalid input", async () => {
    const r = await createBusiness({}, form({ workspaceId: WS, name: "a", businessType: "Other" }));
    expect(r.errors?.name).toBeTruthy();
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const r = await createBusiness({}, form({ workspaceId: WS, name: "Acme Ltd", businessType: "Other" }));
    expect(r.message).toMatch(/sign in/i);
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts as the signed-in user", async () => {
    const r = await createBusiness({}, form({ workspaceId: WS, name: " Acme Ltd ", businessType: "Cleaning" }));
    expect(r.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith({ workspace_id: WS, name: "Acme Ltd", business_type: "Cleaning", created_by: "user-1" });
  });

  it("reports an RLS rejection as a permissions error", async () => {
    insert.mockResolvedValue({ error: { code: "42501" } });
    const r = await createBusiness({}, form({ workspaceId: WS, name: "Acme Ltd", businessType: "Other" }));
    expect(r.ok).toBeUndefined();
    expect(r.message).toMatch(/permission/i);
  });
});

describe("auth actions", () => {
  it("uses one generic message for a failed sign in", async () => {
    signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials", status: 400 } });
    const r = await auth.signIn({}, form({ email: "a@b.co", password: "wrong" }));
    expect(r.message).toBe("Incorrect email or password.");
  });

  it("redirects only to a safe path after sign in", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    await expect(auth.signIn({}, form({ email: "a@b.co", password: "pw", next: "https://evil.example" }))).rejects.toThrow(
      "REDIRECT:/",
    );
  });

  it("validates sign up before calling Supabase", async () => {
    const r = await auth.signUp({}, form({ email: "a@b.co", password: "short" }));
    expect(r.errors?.password).toBeTruthy();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("asks the user to confirm their email after sign up", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    const r = await auth.signUp({}, form({ email: "a@b.co", password: "correct horse battery" }));
    expect(r.message).toMatch(/check your email/i);
    expect(signUp.mock.calls[0][0].options.emailRedirectTo).toBe("http://localhost:3000/auth/confirm");
  });
});
