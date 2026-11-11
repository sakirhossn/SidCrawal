export interface PublicSupabaseConfig {
  url: string;
  anonKey: string;
  configured: boolean;
}

const PLACEHOLDER_MARKERS = [
  "your-project-ref",
  "your-supabase-anon-key",
  "placeholder",
];

function isRealEnvValue(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  return !PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Reads only public Supabase environment variables safe for client and server components.
 * Returns `configured: false` when env vars are missing or contain `.env.example` placeholders.
 */
export function getPublicSupabaseConfig(): PublicSupabaseConfig {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!isRealEnvValue(rawUrl) || !isRealEnvValue(rawAnonKey)) {
    return {
      url: "",
      anonKey: "",
      configured: false,
    };
  }

  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { url: "", anonKey: "", configured: false };
    }
    return {
      url: parsed.origin,
      anonKey: rawAnonKey.trim(),
      configured: true,
    };
  } catch {
    return {
      url: "",
      anonKey: "",
      configured: false,
    };
  }
}

export function isSupabaseConfigured(): boolean {
  return getPublicSupabaseConfig().configured;
}
