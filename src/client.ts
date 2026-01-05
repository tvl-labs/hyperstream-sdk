import { HyperstreamApiError } from "./errors";
import { Fetch } from "./fetch";
import type { FetchJSONResult } from "./fetch";
import type {
  ArcadiaConfig,
  BuildDepositRequest,
  Chain,
  Deposit,
  HyperstreamClientConfig,
  HyperstreamClientInterface,
  IntentDetailsResponse,
  IntentsByAuthorQuery,
  IntentsByAuthorResponse,
  MToken,
  OrdersQuery,
  OrdersResponse,
  QuoteRequest,
  QuoteStreamItem,
  QuotesResponse,
  SearchTokensRequest,
  SubmitDepositRequest,
  SubmitDepositResponse,
  Token,
  TokenAutocompleteQuery,
  TokenAutocompleteResponse,
  TokenBalancesQuery,
  TokenSearchAdaptersRequest,
  TokenSearchResponse,
  TopTokensQuery,
  Vault,
} from "./types";
import type { Address, Hex } from "viem";

type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean | null | undefined>;

interface ClientRequestConfig {
  path: string;
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
}

type TransportProxy = {
  get<T>(url: string, init?: RequestInit): Promise<FetchJSONResult<T>>;
  post<T>(
    url: string,
    body?: unknown,
    init?: RequestInit
  ): Promise<FetchJSONResult<T>>;
  put<T>(
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

  async quotes(request: QuoteRequest): Promise<QuotesResponse> {
    return this.postJson<QuotesResponse>("/v1/quotes", request);
  }

  async *streamQuotes(request: QuoteRequest): AsyncGenerator<QuoteStreamItem> {
    const path = this.buildPathWithQuery("/v1/quotes", { mode: "stream" });
    const url = this.resolveUrl(path);
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: this.resolveHeaders({
        Accept: "application/x-ndjson",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      await this.throwResponseError(response);
    }

    if (!response.body) {
      const text = await response.text();
      yield* this.parseNdjsonText(text);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        yield JSON.parse(line) as QuoteStreamItem;
      }
    }

    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      yield JSON.parse(tail) as QuoteStreamItem;
    }
  }

  async buildDeposit(request: BuildDepositRequest): Promise<Deposit> {
    return this.postJson<Deposit>("/v1/deposit/build", request);
  }

  async submitDeposit(
    request: SubmitDepositRequest
  ): Promise<SubmitDepositResponse> {
    return this.putJson<SubmitDepositResponse>("/v1/deposit/submit", request);
  }

  async getToken(chainId: number, identifier: string): Promise<Token | null> {
    const query: SearchTokensRequest = {
      chainIds: [chainId],
      limit: 1,
    };
    if (isHexLike(identifier)) {
      query.addresses = [identifier];
    } else {
      query.symbols = [identifier];
    }

    const page = await this.searchTokensPage(query);
    return page.data[0] ?? null;
  }

  async *searchTokens(request: SearchTokensRequest): AsyncGenerator<Token[]> {
    let cursor = request.cursor;
    do {
      const page = await this.searchTokensPage({
        ...request,
        cursor,
      });
      yield page.data;
      cursor = page.cursor ?? undefined;
    } while (cursor !== undefined);
  }

  async searchTokensPage(
    request: SearchTokensRequest
  ): Promise<TokenSearchResponse> {
    return this.getJson<TokenSearchResponse>(
      "/v1/tokens",
      this.buildSearchTokensQuery(request)
    );
  }

  async searchTokensWithAdapters(
    request: TokenSearchAdaptersRequest
  ): Promise<Token[]> {
    const query: Record<string, QueryValue> = { q: request.q };
    if (request.chainIds?.length) {
      query.chainIds = request.chainIds;
    }
    const response = await this.getJson<{ data: Token[] }>(
      "/v1/tokens/search",
      query
    );
    return response.data;
  }

  async autocompleteTokens(
    keyword: string,
    query?: TokenAutocompleteQuery
  ): Promise<TokenAutocompleteResponse> {
    const params =
      query && query.chainIds?.length
        ? {
            chainIds: query.chainIds,
            ...(typeof query.limit === "number" ? { limit: query.limit } : {}),
          }
        : typeof query?.limit === "number"
        ? { limit: query.limit }
        : undefined;
    return this.getJson<TokenAutocompleteResponse>(
      `/v1/tokens/autocomplete/${encodeURIComponent(keyword)}`,
      params
    );
  }

  async getTokenBalances(
    address: string,
    query?: TokenBalancesQuery
  ): Promise<Token[]> {
    const params =
      query && query.chainIds?.length ? { chainIds: query.chainIds } : undefined;
    return this.getJson<Token[]>(
      `/v1/tokens/balances/${encodeURIComponent(address)}`,
      params
    );
  }

  async getTopTokens(query?: TopTokensQuery): Promise<Token[]> {
    const params =
      query && query.chainIds?.length ? { chainIds: query.chainIds } : undefined;
    return this.getJson<Token[]>("/v1/tokens/top", params);
  }

  async getMTokens(): Promise<MToken[]> {
    return this.getJson<MToken[]>("/v1/mtokens");
  }

  async getChains(): Promise<Chain[]> {
    return this.getJson<Chain[]>("/v1/chains");
  }

  async getArcadiaConfig(): Promise<ArcadiaConfig> {
    return this.getJson<ArcadiaConfig>("/v1/config/arcadia");
  }

  async getVaults(): Promise<Vault[]> {
    return this.getJson<Vault[]>("/v1/vaults");
  }

  async getIntentStatus(intentId: Hex): Promise<IntentDetailsResponse> {
    return this.getJson<IntentDetailsResponse>(
      `/v1/intent/${encodeURIComponent(intentId)}`
    );
  }

  async getIntentByDeposit(
    chainId: number,
    txHash: Hex
  ): Promise<IntentDetailsResponse | null> {
    try {
      return await this.getJson<IntentDetailsResponse>(
        `/v1/intent/deposit/${chainId}/${encodeURIComponent(txHash)}`
      );
    } catch (error) {
      if (error instanceof HyperstreamApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getIntentsByAuthor(
    author: Address,
    query?: IntentsByAuthorQuery
  ): Promise<IntentsByAuthorResponse> {
    const params =
      query !== undefined
        ? {
            ...(typeof query.limit === "number" ? { limit: query.limit } : {}),
            ...(typeof query.cursor === "number" ? { cursor: query.cursor } : {}),
            ...(typeof query.fromChainId === "number"
              ? { fromChainId: query.fromChainId }
              : {}),
            ...(typeof query.toChainId === "number"
              ? { toChainId: query.toChainId }
              : {}),
          }
        : undefined;
    return this.getJson<IntentsByAuthorResponse>(
      `/v1/intents/${encodeURIComponent(author)}`,
      params
    );
  }

  async getOrders(
    address: Address,
    query?: OrdersQuery
  ): Promise<OrdersResponse> {
    const params =
      query !== undefined
        ? {
            ...(typeof query.limit === "number" ? { limit: query.limit } : {}),
            ...(typeof query.cursor === "number" ? { cursor: query.cursor } : {}),
            ...(typeof query.fromChainId === "number"
              ? { fromChainId: query.fromChainId }
              : {}),
            ...(typeof query.toChainId === "number"
              ? { toChainId: query.toChainId }
              : {}),
            ...(query.orderIds?.length ? { orderIds: query.orderIds } : {}),
          }
        : undefined;
    return this.getJson<OrdersResponse>(
      `/v1/orders/${encodeURIComponent(address)}`,
      params
    );
  }

  private async getJson<T>(
    path: string,
    query?: Record<string, QueryValue>
  ): Promise<T> {
    return this.dispatchRequest<T>({
      path,
      method: "GET",
      query,
    });
  }

  private async postJson<T>(
    path: string,
    body?: unknown,
    query?: Record<string, QueryValue>
  ): Promise<T> {
    return this.dispatchRequest<T>({
      path,
      method: "POST",
      body,
      query,
    });
  }

  private async putJson<T>(
    path: string,
    body?: unknown,
    query?: Record<string, QueryValue>
  ): Promise<T> {
    return this.dispatchRequest<T>({
      path,
      method: "PUT",
      body,
      query,
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
    let result: FetchJSONResult<unknown>;

    if (method === "GET") {
      result = await this.transport.get<T>(path, { headers });
    } else if (method === "POST") {
      result = await this.transport.post<T>(path, config.body, { headers });
    } else if (method === "PUT") {
      result = await this.transport.put<T>(path, config.body, { headers });
    } else {
      throw new Error(`Unsupported HTTP method: ${method}`);
    }

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
        code:
          (payload?.code as string | undefined) ||
          (payload?.name as string | undefined) ||
          undefined,
        details: payload?.details ?? payload,
        requestId: result.raw?.headers.get("x-request-id"),
        causeResponseBody: payload,
      });
    }

    return result.data as T;
  }

  private buildPathWithQuery(
    path: string,
    query?: Record<string, QueryValue>
  ) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    if (!query) {
      return normalizedPath;
    }

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry === undefined || entry === null) continue;
          params.append(key, String(entry));
        }
        continue;
      }
      params.append(key, String(value));
    }

    const queryString = params.toString();
    return queryString ? `${normalizedPath}?${queryString}` : normalizedPath;
  }

  private buildSearchTokensQuery(request: SearchTokensRequest) {
    const query: Record<string, QueryValue> = {};
    if (request.q) query.q = request.q;
    if (request.chainIds?.length) query.chainIds = request.chainIds;
    if (request.addresses?.length) query.addresses = request.addresses;
    if (request.symbols?.length) query.symbols = request.symbols;
    if (typeof request.limit === "number") query.limit = request.limit;
    if (typeof request.cursor === "number") query.cursor = request.cursor;
    return query;
  }

  private createTransportProxy(): TransportProxy {
    return new Proxy({} as TransportProxy, {
      get: (_target, prop) => {
        if (prop !== "get" && prop !== "post" && prop !== "put") {
          return undefined;
        }
        const handler =
          prop === "get"
            ? Fetch.prototype.get
            : prop === "post"
            ? Fetch.prototype.post
            : Fetch.prototype.put;
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

  private resolveUrl(path: string) {
    return this.baseURL ? `${this.baseURL}${path}` : path;
  }

  private resolveHeaders(extra?: Record<string, string>) {
    const headers: Record<string, string> = {};
    const source = this.headers;
    if (source instanceof Headers) {
      source.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(source)) {
      for (const [key, value] of source) {
        headers[key] = value;
      }
    } else if (source) {
      Object.assign(headers, source as Record<string, string>);
    }
    return { ...headers, ...(extra ?? {}) };
  }

  private async throwResponseError(response: Response): Promise<never> {
    let payload: Record<string, unknown> | undefined;
    try {
      payload = (await response.clone().json()) as Record<string, unknown>;
    } catch {
      // ignore JSON parse errors
    }
    const message =
      (payload?.message as string | undefined) ||
      response.statusText ||
      "Hyperstream API request failed";
    throw new HyperstreamApiError({
      message,
      status: response.status,
      code:
        (payload?.code as string | undefined) ||
        (payload?.name as string | undefined) ||
        undefined,
      details: payload?.details ?? payload,
      requestId: response.headers.get("x-request-id"),
      causeResponseBody: payload,
    });
  }

  private *parseNdjsonText(text: string): Generator<QuoteStreamItem> {
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed) as QuoteStreamItem;
    }
  }
}

function isHexLike(value: string) {
  return /^0x[0-9a-fA-F]+$/.test(value);
}
