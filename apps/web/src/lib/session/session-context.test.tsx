import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MeContext } from "@/lib/contracts";
import { ApiError } from "@/lib/api/problem";

vi.mock("@/lib/auth/auth-actions", () => ({ refresh: vi.fn(), logout: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/lib/api/token-store", () => ({
  getAccessToken: vi.fn(() => null),
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

import { api } from "@/lib/api/client";
import { getAccessToken, setAccessToken, clearAccessToken } from "@/lib/api/token-store";
import { logout, refresh } from "@/lib/auth/auth-actions";
import {
  SessionProvider,
  UnauthenticatedError,
  defaultSessionLoader,
  useSession,
  type SessionLoader,
} from "./session-context";

function ctx(overrides: Partial<MeContext> = {}): MeContext {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    tenantType: "CUSTOMER",
    roles: [{ id: "33333333-3333-3333-3333-333333333333", key: "operator", name: "Operator", isSystem: true }],
    permissions: ["telecom.read", "did.read"],
    ...overrides,
  };
}

function Probe() {
  const s = useSession();
  return (
    <div>
      <span data-testid="status">{s.status}</span>
      <span data-testid="platform">{String(s.isPlatform)}</span>
      <span data-testid="has-read">{String(s.hasPermission("telecom.read"))}</span>
      <span data-testid="has-manage">{String(s.hasPermission("telecom.manage"))}</span>
      <span data-testid="any">{String(s.hasAnyPermission("x", "did.read"))}</span>
      <span data-testid="all">{String(s.hasAllPermissions("telecom.read", "did.read"))}</span>
      <span data-testid="tenant">{s.context?.tenantId ?? "none"}</span>
    </div>
  );
}

function renderWith(loader: SessionLoader) {
  return render(
    <SessionProvider loader={loader}>
      <Probe />
    </SessionProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe("SessionProvider", () => {
  it("exposes an authenticated session with working permission checks", async () => {
    renderWith(async () => ctx());
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(screen.getByTestId("platform").textContent).toBe("false");
    expect(screen.getByTestId("has-read").textContent).toBe("true");
    expect(screen.getByTestId("has-manage").textContent).toBe("false");
    expect(screen.getByTestId("any").textContent).toBe("true");
    expect(screen.getByTestId("all").textContent).toBe("true");
    expect(screen.getByTestId("tenant").textContent).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("flags the platform tenant", async () => {
    renderWith(async () => ctx({ tenantType: "PLATFORM" }));
    await waitFor(() => expect(screen.getByTestId("platform").textContent).toBe("true"));
  });

  it("maps a 401 to unauthenticated with no context", async () => {
    renderWith(async () => {
      throw new ApiError({ title: "Unauthorized", status: 401 });
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(screen.getByTestId("tenant").textContent).toBe("none");
    expect(screen.getByTestId("has-read").textContent).toBe("false");
  });

  it("maps a 403 to forbidden", async () => {
    renderWith(async () => {
      throw new ApiError({ title: "Forbidden", status: 403 });
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("forbidden"));
  });

  it("maps a non-API failure to error", async () => {
    renderWith(async () => {
      throw new Error("network down");
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
  });

  it("maps an UnauthenticatedError (session gate) to unauthenticated, not error", async () => {
    renderWith(async () => {
      throw new UnauthenticatedError();
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(screen.getByTestId("tenant").textContent).toBe("none");
  });

  it("maps a 5xx failure to error, not unauthenticated", async () => {
    renderWith(async () => {
      throw new ApiError({ title: "Internal Server Error", status: 500 });
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
  });

  it("reload() re-invokes the loader", async () => {
    const loader = vi.fn<SessionLoader>(async () => ctx());
    function ReloadProbe() {
      const s = useSession();
      return (
        <button type="button" onClick={s.reload}>
          {s.status}
        </button>
      );
    }
    render(
      <SessionProvider loader={loader}>
        <ReloadProbe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("authenticated"));
    expect(loader).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });

  it("signOut revokes the server session and drops to unauthenticated", async () => {
    vi.mocked(logout).mockResolvedValue(undefined);
    function SignOutProbe() {
      const s = useSession();
      return (
        <button type="button" onClick={() => void s.signOut()}>
          {s.status}
        </button>
      );
    }
    render(
      <SessionProvider loader={async () => ctx()}>
        <SignOutProbe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("authenticated"));
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("unauthenticated"));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(clearAccessToken).toHaveBeenCalled();
  });

  it("useSession throws outside a provider", () => {
    function Orphan() {
      useSession();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/useSession must be used inside/);
    spy.mockRestore();
  });
});

describe("defaultSessionLoader", () => {
  it("refreshes when there is no access token, then loads the context", async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    vi.mocked(refresh).mockResolvedValue({ accessToken: "new-tok", expiresIn: 900 });
    vi.mocked(api.get).mockResolvedValue(ctx());
    const signal = new AbortController().signal;

    const result = await defaultSessionLoader(signal);

    expect(refresh).toHaveBeenCalledWith(signal);
    expect(setAccessToken).toHaveBeenCalledWith("new-tok");
    expect(api.get).toHaveBeenCalledWith("/v1/me/context", { signal });
    expect(result).toEqual(ctx());
  });

  it("skips refresh when an access token already exists", async () => {
    vi.mocked(getAccessToken).mockReturnValue("existing");
    vi.mocked(api.get).mockResolvedValue(ctx());

    await defaultSessionLoader(new AbortController().signal);

    expect(refresh).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledWith("/v1/me/context", expect.anything());
  });

  it("throws UnauthenticatedError when refresh returns 400 (missing/invalid refresh cookie)", async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    vi.mocked(refresh).mockRejectedValue(new ApiError({ title: "Bad Request", status: 400 }));

    await expect(defaultSessionLoader(new AbortController().signal)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(setAccessToken).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("throws UnauthenticatedError when refresh returns 401", async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    vi.mocked(refresh).mockRejectedValue(new ApiError({ title: "Unauthorized", status: 401 }));

    await expect(defaultSessionLoader(new AbortController().signal)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("re-throws a 5xx from refresh unchanged (real server error, not a sign-in signal)", async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    const serverError = new ApiError({ title: "Internal Server Error", status: 500 });
    vi.mocked(refresh).mockRejectedValue(serverError);

    await expect(defaultSessionLoader(new AbortController().signal)).rejects.toBe(serverError);
  });

  it("re-throws a network failure from refresh unchanged", async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    const netError = new Error("fetch failed");
    vi.mocked(refresh).mockRejectedValue(netError);

    await expect(defaultSessionLoader(new AbortController().signal)).rejects.toBe(netError);
  });
});
