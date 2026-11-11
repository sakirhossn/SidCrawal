import { afterEach, describe, expect, it } from "vitest";
import { getPublicSupabaseConfig, isSupabaseConfigured } from "../supabase/env";

describe("getPublicSupabaseConfig", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    }

    if (originalKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    }
  });

  it("returns configured=false when env vars are missing or placeholders", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(isSupabaseConfigured()).toBe(false);

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://your-project-ref.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "your-supabase-anon-key-placeholder";
    expect(getPublicSupabaseConfig().configured).toBe(false);
  });

  it("returns configured=true for valid public Supabase values", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcxyzproject.supabase.co/some-path";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid";

    const config = getPublicSupabaseConfig();
    expect(config.configured).toBe(true);
    expect(config.url).toBe("https://abcxyzproject.supabase.co");
    expect(config.anonKey).toBe("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid");
  });
});
