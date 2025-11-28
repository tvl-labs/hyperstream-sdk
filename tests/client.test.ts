import { describe, expect, it } from "bun:test";
import { createHyperstreamClient } from "../src/index";
import {
  TradeType,
  type FetchLike,
  type QuoteResponse,
  type TokenSearchResponse,
} from "../src/types";
import type { Address } from "viem";
import { HyperstreamApiError } from "../src/errors";

describe("HyperstreamClient", () => {
  const baseUrl = "https://api.test.hyperstream.xyz";

  it("fetches quotes with the expected payload", async () => {
    const mockFetch = createMockFetch([
      {
        status: 200,
        body: createQuoteResponse(),
      },
    ]);

    const client = createHyperstreamClient({
      baseUrl,
      fetch: mockFetch,
      headers: { "x-app-id": "sdk-tests" },
    });

    const quote = await client.quotes({
      fromAddress: "0x0000000000000000000000000000000000000001" as Address,
      tradeType: TradeType.ExactInput,
      fromChainId: 42161,
      fromToken: "0x0000000000000000000000000000000000000002" as Address,
      toChainId: 8453,
      toToken: "0x0000000000000000000000000000000000000003" as Address,
      amount: "0x10",
    });

    expect(quote.intentId).toBe("intent-123");
    expect(mockFetch.calls.length).toBe(1);
    expect(mockFetch.calls[0]?.input.toString()).toBe(`${baseUrl}/v1/quotes`);
    expect(mockFetch.calls[0]?.init?.method).toBe("POST");
    expect(mockFetch.calls[0]?.init?.headers).toMatchObject({
      Accept: "application/json",
      "x-app-id": "sdk-tests",
    });
  });

  it("returns null when getToken receives a 404", async () => {
    const mockFetch = createMockFetch([
      {
        status: 404,
        body: { message: "NotFound" },
      },
    ]);

    const client = createHyperstreamClient({
      baseUrl,
      fetch: mockFetch,
    });

    const token = await client.getToken(
      42161,
      "0x0000000000000000000000000000000000000002"
    );

    expect(token).toBeNull();
  });

  it("streams searchTokens pages until the cursor ends", async () => {
    const mockFetch = createMockFetch([
      {
        status: 200,
        body: createTokenSearchResponse({
          cursor: 99,
          tokens: [
            {
              address: "0x1" as Address,
              chainId: 1,
              name: "Token 1",
              symbol: "TK1",
              decimals: 18,
            },
          ],
        }),
      },
      {
        status: 200,
        body: createTokenSearchResponse({
          cursor: undefined,
          tokens: [
            {
              address: "0x2" as Address,
              chainId: 1,
              name: "Token 2",
              symbol: "TK2",
              decimals: 6,
            },
          ],
        }),
      },
    ]);

    const client = createHyperstreamClient({
      baseUrl,
      fetch: mockFetch,
    });

    const pages: number[] = [];
    for await (const page of client.searchTokens({ q: "USDC", limit: 1 })) {
      pages.push(page.length);
    }

    expect(pages).toEqual([1, 1]);
    expect(mockFetch.calls).toHaveLength(2);
  });

  it("returns true when submitDeposit is accepted", async () => {
    const mockFetch = createMockFetch([
      {
        status: 200,
        body: { status: "accepted" },
      },
    ]);

    const client = createHyperstreamClient({
      baseUrl,
      fetch: mockFetch,
    });

    const accepted = await client.submitDeposit({
      intentId: "0x01",
      srcChainId: 42161,
      txHash: "0x02",
      amountIn: "0x10",
    });

    expect(accepted).toBe(true);
  });

  it("exposes the HyperstreamApiError for non-404 failures", async () => {
    const mockFetch = createMockFetch([
      {
        status: 500,
        body: { message: "Boom", code: "ServerError" },
      },
    ]);

    const client = createHyperstreamClient({
      baseUrl,
      fetch: mockFetch,
    });

    await expect(client.getIntentStatus("0xdeadbeef")).rejects.toBeInstanceOf(
      HyperstreamApiError
    );
  });
});

interface MockResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

interface MockCall {
  input: RequestInfo | URL;
  init?: RequestInit;
}

type MockFetch = FetchLike & {
  calls: MockCall[];
};

function createMockFetch(responses: MockResponse[]): MockFetch {
  const calls: MockCall[] = [];
  const fetchImpl: MockFetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const responseConfig = responses.shift();
      if (!responseConfig) {
        throw new Error("No mock response left for fetch call");
      }
      calls.push({ input, init });
      return new Response(
        responseConfig.body !== undefined
          ? JSON.stringify(responseConfig.body)
          : undefined,
        {
          status: responseConfig.status,
          headers: {
            "content-type": "application/json",
            ...(responseConfig.headers ?? {}),
          },
        }
      );
    },
    { calls }
  );

  return fetchImpl;
}

function createQuoteResponse(): QuoteResponse {
  return {
    tradeType: TradeType.ExactInput,
    fromChainId: 42161,
    fromToken: "0x0000000000000000000000000000000000000002",
    toChainId: 8453,
    toToken: "0x0000000000000000000000000000000000000003",
    amountIn: "0x10",
    amountOut: "0x20",
    expectedDurationSeconds: 120,
    validBefore: new Date().toISOString(),
    intentId: "intent-123",
    intent: {
      author: "0x0000000000000000000000000000000000009999",
      validBefore: "0x1234",
      nonce: "0x01",
      srcMToken: "0x5555",
      srcAmount: "0x10",
      destinationChainId: 8453,
      nativeOutcome: "0x05",
      outcomeToken: "0x0000000000000000000000000000000000000004",
      outcomeAmount: "0x20",
    },
    deposit: {
      kind: "CONTRACT_CALL",
      approvals: [
        {
          method: "eth_sendTransaction",
          params: [{}],
        },
      ],
    },
  };
}

function createTokenSearchResponse({
  tokens,
  cursor,
}: {
  tokens: TokenSearchResponse["data"];
  cursor?: number;
}): TokenSearchResponse {
  return {
    data: tokens,
    cursor,
  };
}
