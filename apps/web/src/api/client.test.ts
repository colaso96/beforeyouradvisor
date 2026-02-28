import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";

describe("api client flow endpoints", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the classified transactions endpoint shape needed by the main flow", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ rows: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.transactions({ status: "classified", limit: 100, offset: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/transactions?limit=100&offset=0&status=classified");
  });

  it("calls chat eligibility/clear/send endpoints for data-agent flow", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/transactions/chat/history") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url.includes("/api/transactions/chat") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            row: {
              id: "de305d54-75b4-431b-adb2-eb6b9e546014",
              role: "assistant",
              content: "Top vendor is Uber.",
              sql: "SELECT description FROM transactions WHERE user_id = $1 LIMIT 100",
              resultTable: { columns: ["description"], rows: [{ description: "Uber" }] },
              createdAt: "2026-02-27T00:00:00.000Z",
            },
          }),
          { status: 201 },
        );
      }

      const body = { eligible: true, transactionCount: 3, minRequired: 2 };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.transactionChatEligibility();
    await api.clearTransactionChatHistory();
    await api.sendTransactionChatMessage("show top vendors");

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((url) => url.includes("/api/transactions/chat/eligibility"))).toBe(true);
    expect(calledUrls.some((url) => url.includes("/api/transactions/chat/history"))).toBe(true);
    expect(calledUrls.some((url) => url.includes("/api/transactions/chat"))).toBe(true);

    const deleteCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/transactions/chat/history") && call[1]?.method === "DELETE");
    expect(deleteCall).toBeTruthy();
  });

  it("verifies checkout sessions via the stripe-style endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true, metadata: { userId: "u_123" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.verifyAnalysisCheckout("cs_test_123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/verify-session?session_id=cs_test_123");
  });
});
