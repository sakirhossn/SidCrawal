import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockConfig = vi.fn();

vi.mock("@/lib/supabase/env", () => ({
  getPublicSupabaseConfig: () => mockConfig(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
}));

import { proxy } from "@/proxy";

describe("proxy route protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.mockReturnValue({
      url: "https://demo.supabase.co",
      anonKey: "anon-key",
      configured: true,
    });
  });

  it("redirects unauthenticated users from /dashboard to /login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const req = new NextRequest("http://localhost:3000/dashboard/settings");
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fdashboard%2Fsettings"
    );
  });

  it("redirects unverified users from /dashboard to /verify-email", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "u1",
          email: "pending@example.com",
          email_confirmed_at: null,
        },
      },
    });
    const req = new NextRequest("http://localhost:3000/dashboard");
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/verify-email?reason=unverified&email=pending%40example.com"
    );
  });

  it("allows verified users on /dashboard and redirects them away from /login", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "u1",
          email: "verified@example.com",
          email_confirmed_at: "2026-11-10T10:00:00Z",
        },
      },
    });

    const dashRes = await proxy(new NextRequest("http://localhost:3000/dashboard"));
    expect(dashRes.status).toBe(200);

    const loginRes = await proxy(new NextRequest("http://localhost:3000/login"));
    expect(loginRes.status).toBe(307);
    expect(loginRes.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });
});
