import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : undefined;
const isLocalSupabase = supabaseUrl && ["127.0.0.1", "localhost"].includes(supabaseUrl.hostname);

const nextConfig: NextConfig = {
  experimental: {
    // Coach photo uploads (5 MB max) and setup screenshots (5 shrunk images) go through Server Actions.
    serverActions: { bodySizeLimit: "8mb" },
  },
  images: {
    // Coach photos come from Supabase Storage.
    remotePatterns: supabaseUrl
      ? [{ protocol: supabaseUrl.protocol === "http:" ? "http" : "https", hostname: supabaseUrl.hostname, port: supabaseUrl.port, pathname: "/storage/v1/object/public/**" }]
      : [],
    // The image optimiser refuses local addresses, so skip it when using local Supabase.
    unoptimized: Boolean(isLocalSupabase),
  },
};

export default nextConfig;
