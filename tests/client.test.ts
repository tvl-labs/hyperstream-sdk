import { describe, expect, it } from "bun:test";
import { createHyperstreamClient } from "../src/index";
import {
  TradeType,
  type FetchLike,
  type QuotesResponse,
  type QuoteStreamItem,
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

    const response = await client.quotes({
      fromAddress: "0x0000000000000000000000000000000000000001" as Address,
      tradeType: TradeType.ExactInput,
      fromChainId: 42161,
      fromToken: "0x0000000000000000000000000000000000000002" as Address,
      toChainId: 8453,
      toToken: "0x0000000000000000000000000000000000000003" as Address,
      amount: "0x10",
    });

    expect(response.quoteId).toBe("quote-123");
    expect(response.routes[0]?.routeId).toBe("Across");
    expect(mockFetch.calls.length).toBe(1);
    expect(mockFetch.calls[0]?.input.toString()).toBe(`${baseUrl}/v1/quotes`);
    expect(mockFetch.calls[0]?.init?.method).toBe("POST");
    expect(mockFetch.calls[0]?.init?.headers).toMatchObject({
      Accept: "application/json",
      "x-app-id": "sdk-tests",
    });
  });

  it("returns null when getToken receives no matches", async () => {
    const mockFetch = createMockFetch([
      {
        status: 200,
        body: createTokenSearchResponse({ tokens: [], cursor: undefined }),
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
    expect(mockFetch.calls[0]?.init?.method).toBe("GET");
  });

  it("streams quotes over NDJSON", async () => {
    const streamItems: QuoteStreamItem[] = [
      {
        quoteId: "quote-123",
        routeId: "Across",
        type: "external-intent-router",
        quote: {
          amountIn: "1",
          amountOut: "2",
          expectedDurationSeconds: 30,
          validBefore: 1234,
        },
      },
      {
        quoteId: "quote-123",
        routeId: "Native",
        type: "native-filler",
        quote: {
          amountIn: "3",
          amountOut: "4",
          expectedDurationSeconds: 45,
          validBefore: 1235,
        },
      },
    ];
    const mockFetch = createMockFetch([
      {
        status: 200,
        rawBody: streamItems.map((item) => JSON.stringify(item)).join("\n"),
        headers: { "content-type": "application/x-ndjson" },
      },
    ]);

    const client = createHyperstreamClient({
      baseUrl,
      fetch: mockFetch,
    });

    const received: QuoteStreamItem[] = [];
    for await (const item of client.streamQuotes({
      fromAddress: "0x1",
      tradeType: TradeType.ExactInput,
      fromChainId: 1,
      fromToken: "0x2",
      toChainId: 2,
      toToken: "0x3",
      amount: "10",
    })) {
      received.push(item);
    }

    expect(received).toEqual(streamItems);
    expect(mockFetch.calls[0]?.input.toString()).toBe(
      `${baseUrl}/v1/quotes?mode=stream`
    );
  });

  it("returns the orderId when submitDeposit succeeds", async () => {
    const mockFetch = createMockFetch([
      {
        status: 200,
        body: { orderId: "order-1" },
      },
    ]);

    const client = createHyperstreamClient({
      baseUrl,
      fetch: mockFetch,
    });

    const result = await client.submitDeposit({
      quoteId: "quote-123",
      routeId: "Across",
      txHash: "0x02",
    });

    expect(result.orderId).toBe("order-1");
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
  rawBody?: string;
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
      const body =
        responseConfig.rawBody !== undefined
          ? responseConfig.rawBody
          : responseConfig.body !== undefined
          ? JSON.stringify(responseConfig.body)
          : undefined;
      return new Response(body, {
        status: responseConfig.status,
        headers: {
          ...(responseConfig.rawBody === undefined
            ? { "content-type": "application/json" }
            : {}),
          ...(responseConfig.headers ?? {}),
        },
      });
    },
    { calls }
  );

  return fetchImpl;
}

function createQuoteResponse(): QuotesResponse {
  return {
    quoteId: "quote-123",
    routes: [
      {
        routeId: "Across",
        type: "external-intent-router",
        quote: {
          amountIn: "0x10",
          amountOut: "0x20",
          expectedDurationSeconds: 120,
          validBefore: Math.floor(Date.now() / 1000) + 60,
        },
      },
    ],
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
