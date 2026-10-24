export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`${name} is not set. Copy .env.example to .env.local and fill in your Supabase project values.`);
    this.name = "MissingEnvError";
  }
}

// Only public values live here. The browser may see these; RLS policies keep data safe.
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new MissingEnvError("NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new MissingEnvError("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return { url, key };
}

export function hasSupabaseEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}
