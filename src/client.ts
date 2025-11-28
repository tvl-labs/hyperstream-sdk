import { HyperstreamApiError } from "./errors";
import { Fetch } from "./fetch";
import type { FetchJSONResult } from "./fetch";
import type {
  HyperstreamClientConfig,
  HyperstreamClientInterface,
  IntentDeposit,
  IntentStatus,
  QuoteRequest,
  QuoteResponse,
  SearchTokensRequest,
  SubmitDepositRequest,
  Token,
  TokenSearchResponse,
} from "./types";
import type { Address, Chain, Hex } from "viem";

interface ClientRequestConfig {
  path: string;
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
}

type TransportProxy = {
  get<T>(url: string, init?: RequestInit): Promise<FetchJSONResult<T>>;
  post<T>(
    url: string,
    body?: unknown,
    init?: RequestInit
  ): Promise<FetchJSONResult<T>>;
};

export class HyperstreamClient
  extends Fetch
  implements HyperstreamClientInterface
{
  private readonly transport: TransportProxy;

  constructor(config: HyperstreamClientConfig) {
    if (!config.baseUrl) {
      throw new Error("HyperstreamClient: `baseUrl` is required.");
    }

    const normalizedBase = config.baseUrl.replace(/\/+$/, "") || config.baseUrl;
    const headers = { ...(config.headers ?? {}) };
    if (config.userAgent) {
      headers["User-Agent"] = config.userAgent;
    }

    super({
      baseURL: normalizedBase,
      headers,
      fetch: config.fetch,
    });

    this.transport = this.createTransportProxy();
  }

  async quotes(request: QuoteRequest): Promise<QuoteResponse> {
    return this.postJson<QuoteResponse>("/v1/quotes", request);
  }

  async getToken(chainId: number, address: Address): Promise<Token | null>;
  async getToken(chainId: number, symbol: string): Promise<Token | null>;
  async getToken(chainId: number, identifier: string): Promise<Token | null> {
    const encodedIdentifier = encodeURIComponent(identifier);
    const path = isHexLike(identifier)
      ? `/v1/tokens/${chainId}/${encodedIdentifier}`
      : `/v1/tokens/${chainId}/symbol/${encodedIdentifier}`;

    try {
      return await this.getJson<Token>(path);
    } catch (error) {
      if (
        error instanceof HyperstreamApiError &&
        (error.status === 404 || error.status === 400)
      ) {
        return null;
      }
      throw error;
    }
  }

  async *searchTokens(request: SearchTokensRequest): AsyncGenerator<Token[]> {
    let cursor = request.cursor;

    do {
      const payload = { ...request, cursor };
      const page = await this.postJson<TokenSearchResponse>(
        "/v1/tokens/search",
        payload
      );
      yield page.data;
      cursor = page.cursor ?? undefined;
    } while (cursor !== undefined);
  }

  async getChains(): Promise<Chain[]> {
    return this.getJson<Chain[]>("/v1/chains");
  }

  async getIntentStatus(intent: Hex): Promise<IntentStatus> {
    return this.getJson<IntentStatus>(
      `/v1/intent/${encodeURIComponent(intent)}`
    );
  }

  async getIntentByDeposit(
    chainId: number,
    txHash: string
  ): Promise<IntentDeposit | null> {
    try {
      return await this.getJson<IntentDeposit>(
        `/v1/intent/by-deposit/${chainId}/${encodeURIComponent(txHash)}`
      );
    } catch (error) {
      if (error instanceof HyperstreamApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async submitDeposit(request: SubmitDepositRequest): Promise<boolean> {
    const response = await this.postJson<{ status?: string }>(
      "/v1/deposits/submit",
      request
    );
    if (!response) {
      return false;
    }
    return response.status === "accepted";
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.dispatchRequest<T>({ path, method: "GET" });
  }

  private async postJson<T>(path: string, body?: unknown): Promise<T> {
    return this.dispatchRequest<T>({
      path,
      method: "POST",
      body,
    });
  }

  private async dispatchRequest<T>(config: ClientRequestConfig): Promise<T> {
    const path = this.buildPathWithQuery(config.path, config.query);
    return this.executeRequest<T>(path, config);
  }

  private async executeRequest<T>(
    path: string,
    config: ClientRequestConfig
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(config.headers ?? {}),
    };

    const method = config.method ?? "GET";
    const result =
      method === "GET"
        ? await this.transport.get<T>(path, { headers })
        : await this.transport.post<T>(path, config.body, { headers });

    if (!result.ok) {
      const payload = result.data as Record<string, unknown> | undefined;
      const message =
        (payload?.message as string | undefined) ||
        (payload?.error as string | undefined) ||
        result.raw?.statusText ||
        "Hyperstream API request failed";
      throw new HyperstreamApiError({
        message,
        status: result.status,
        code: (payload?.code as string | undefined) ?? undefined,
        details: payload?.details ?? payload,
        requestId: result.raw?.headers.get("x-request-id"),
        causeResponseBody: payload,
      });
    }

    return result.data as T;
  }

  private buildPathWithQuery(
    path: string,
    query?: Record<string, string | number | undefined>
  ) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    if (!query) {
      return normalizedPath;
    }

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }

    const queryString = params.toString();
    return queryString ? `${normalizedPath}?${queryString}` : normalizedPath;
  }

  private createTransportProxy(): TransportProxy {
    return new Proxy({} as TransportProxy, {
      get: (_target, prop) => {
        if (prop !== "get" && prop !== "post") {
          return undefined;
        }
        const handler =
          prop === "get" ? Fetch.prototype.get : Fetch.prototype.post;
        return async (...args: unknown[]) => {
          try {
            return await (
              handler as (
                ...args: unknown[]
              ) => Promise<FetchJSONResult<unknown>>
            ).apply(this, args);
          } catch (error) {
            throw this.normalizeTransportError(error);
          }
        };
      },
    });
  }

  private normalizeTransportError(error: unknown): HyperstreamApiError {
    if (error instanceof HyperstreamApiError) {
      return error;
    }
    const message =
      error instanceof Error
        ? error.message
        : "Hyperstream transport request failed";
    return new HyperstreamApiError({
      message,
      status: 0,
      code: "TransportError",
      details: { error },
    });
  }
}

function isHexLike(value: string) {
  return /^0x[0-9a-fA-F]+$/.test(value);
}
