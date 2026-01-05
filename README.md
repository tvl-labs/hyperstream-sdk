# Hyperstream SDK

## Types

Core TypeScript contracts shared by the SDK and REST API so integrators can rely on strong typing end to end.

```ts
import type { Address, Hex } from "viem";

interface HyperstreamClient {
  quotes(request: QuoteRequest): Promise<QuotesResponse>;
  streamQuotes(request: QuoteRequest): AsyncGenerator<QuoteStreamItem>;

  buildDeposit(request: BuildDepositRequest): Promise<Deposit>;
  submitDeposit(request: SubmitDepositRequest): Promise<SubmitDepositResponse>;

  getToken(chainId: number, identifier: string): Promise<Token | null>;

  searchTokens(request: SearchTokensRequest): AsyncGenerator<Token[]>;
  searchTokensPage(request: SearchTokensRequest): Promise<TokenSearchResponse>;
  searchTokensWithAdapters(
    request: TokenSearchAdaptersRequest
  ): Promise<Token[]>;

  autocompleteTokens(
    keyword: string,
    query?: TokenAutocompleteQuery
  ): Promise<TokenAutocompleteResponse>;
  getTokenBalances(
    address: string,
    query?: TokenBalancesQuery
  ): Promise<Token[]>;
  getTopTokens(query?: TopTokensQuery): Promise<Token[]>;
  getMTokens(): Promise<MToken[]>;

  getChains(): Promise<Chain[]>;
  getArcadiaConfig(): Promise<ArcadiaConfig>;
  getVaults(): Promise<Vault[]>;

  getIntentStatus(intentId: Hex): Promise<IntentDetailsResponse>;
  getIntentByDeposit(
    chainId: number,
    txHash: Hex
  ): Promise<IntentDetailsResponse | null>;
  getIntentsByAuthor(
    author: Address,
    query?: IntentsByAuthorQuery
  ): Promise<IntentsByAuthorResponse>;

  getOrders(address: Address, query?: OrdersQuery): Promise<OrdersResponse>;
}

type FillerType =
  | "native-filler"
  | "external-intent-router"
  | "liquidity-router"
  | "aggregator-router";

export enum TradeType {
  ExactInput = "EXACT_INPUT",
  ExactOutput = "EXACT_OUTPUT",
}

interface QuoteRequest {
  fromAddress: string;
  tradeType: TradeType;
  fromChainId: number;
  fromToken: string;
  toChainId: number;
  toToken: string;
  amount: Hex | string;
  recipient?: string;
  refundTo?: string;
}

interface QuoteResult {
  amountIn: string;
  amountOut: string;
  expectedDurationSeconds: number;
  validBefore: number; // unix timestamp (seconds)
}

interface QuoteRoute {
  routeId: string;
  type: FillerType;
  quote: QuoteResult;
}

interface QuotesResponse {
  quoteId: string;
  routes: QuoteRoute[];
}

type QuoteStreamItem = QuoteRoute & { quoteId: string };

type Approval =
  | {
      type: "eip1193_request";
      request:
        | { method: "wallet_switchEthereumChain"; params: [{ chainId: Hex }] }
        | {
            method: "eth_sendTransaction";
            params: [EthSendTransactionParams];
          };
      waitForReceipt?: boolean;
      deposit?: boolean;
    }
  | {
      type: "solana_sendTransaction";
      transaction: string;
    };

interface ContractCallDeposit {
  kind: "CONTRACT_CALL";
  approvals?: Approval[];
}

type Deposit = ContractCallDeposit;

interface BuildDepositRequest {
  from: string;
  quoteId: string;
  routeId: string;
}

interface SubmitDepositRequest {
  quoteId: string;
  routeId: string;
  txHash: Hex;
}

interface SubmitDepositResponse {
  orderId: string;
}

interface SearchTokensRequest {
  q?: string;
  chainIds?: number[];
  limit?: number;
  cursor?: number;
  addresses?: string[];
  symbols?: string[];
}

interface Token {
  address: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  extensions?: TokenExtensions;
}

interface TokenExtensions {
  balance?: string;
  price?: { usd: string };
  change?: string;
  spokeToken?: {
    chainId: number;
    address: string;
    symbol: string;
  };
}

interface TokenSearchResponse {
  data: Token[];
  cursor?: number;
}

interface TokenSearchAdaptersRequest {
  q: string;
  chainIds?: number[];
}

interface TokenAutocompleteResponse {
  data: TokenAutocompleteItem[];
  parsed: TokenAutocompleteParsed;
  nextSlots: SemanticSlot[];
}

enum IntentState {
  NonExistent = "NonExistent",
  Open = "Open",
  Locked = "Locked",
  Solved = "Solved",
  Settled = "Settled",
  Expired = "Expired",
  Cancelled = "Cancelled",
  Error = "Error",
}

interface IntentDetailsResponse {
  intentId: Hex;
  state: IntentState;
  fromChainId: number;
  toChainId: number;
  author: Address;
  fromToken: Address;
  toToken: Address;
  srcAmount: string;
  destAmount: string;
  createdAt: string;
  openedAt: string | null;
  filledAt: string | null;
  settledAt: string | null;
  deposits: IntentDepositResponse[];
}

interface OrdersResponse {
  data: Order[];
  cursor?: number;
}
```

## HyperstreamClient Usage

### Client initialization

The Hyperstream API ships with an SDK that conforms to the `HyperstreamClient` interface. You typically import a factory that wires up the base URL, auth headers, and other runtime config, and it returns an object that implements every method listed above:

```ts
import { createHyperstreamClient } from "@hyperstream-sdk/client";

const client = createHyperstreamClient({
  baseUrl: "{{BASE_URL}}",
});
```

### Methods overview

- `quotes(request)` — returns a `QuotesResponse` containing every available route.
- `streamQuotes(request)` — NDJSON streaming variant that yields `QuoteStreamItem`s as the fillers respond.
- `buildDeposit({ from, quoteId, routeId })` — renders the wallet plan for a specific route.
- `submitDeposit({ quoteId, routeId, txHash })` — records a deposit and returns `{ orderId }` for optimistic UIs.
- `getToken(chainId, identifier)` — convenience helper that wraps `searchTokens`.
- `searchTokens(request)` / `searchTokensPage(request)` — DB-backed token search with cursor pagination.
- `searchTokensWithAdapters({ q, chainIds? })` — semantic / adapter-backed token search (OKX, intents DB, etc.).
- `autocompleteTokens(keyword, query?)` — semantic autocomplete with parsed slots (`amount`, `chain`, etc.).
- `getTokenBalances`, `getTopTokens`, `getMTokens` — portfolio surfaces wired to Hyperstream + OKX providers.
- `getChains`, `getArcadiaConfig`, `getVaults` — configuration endpoints for supported chains and deployed contracts.
- `getIntentStatus`, `getIntentByDeposit`, `getIntentsByAuthor` — full intent lifecycle accessors.
- `getOrders(address, query?)` — Hyperstream order history with cursor pagination.

### searchTokens pagination example

```ts
const params = { q: "USDC", limit: 50 };

for await (const page of client.searchTokens(params)) {
  // page: Token[]
  for (const token of page) {
    console.log(token.chainId, token.symbol);
  }
}
```

Pagination uses cursors under the hood. The SDK automatically injects the `cursor` returned from the previous page into the next request, so iterating with `for await ... of` streams the full result set. If you want manual control (for a "Load more" button, for example) you can either stop iterating or call `client.searchTokensPage(params)` directly to retrieve a single page.

### Intent queries

```ts
const status = await client.getIntentStatus(intentId);
console.log(status.state, status.deposits.length);

const intent = await client.getIntentByDeposit(42161, "0xabc...");
if (intent) {
  console.log(intent.state, intent.deposits.length);
}
```

The `IntentState` enum covers every lifecycle phase (`Open`, `Locked`, `Solved`, etc.), which is useful for rendering timeline components or firing notifications in your app.

### Quote and Sign

```ts
import { createWalletClient, http, parseUnits, type Hex } from "viem";

const walletClient = createWalletClient({
  /* ... */
});

const quotes = await client.quotes({
  fromAddress: walletClient.account.address,
  tradeType: "EXACT_INPUT",
  fromChainId: 42161,
  fromToken: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
  toChainId: 8453,
  toToken: "0x4200000000000000000000000000000000000006",
  amount: parseUnits("100", 6).toString(),
});

const bestRoute = quotes.routes[0];
if (!bestRoute) {
  throw new Error("No routes available");
}

const depositPlan = await client.buildDeposit({
  from: walletClient.account.address,
  quoteId: quotes.quoteId,
  routeId: bestRoute.routeId,
});

let depositTxHash: Hex | undefined;

for (const approval of depositPlan.approvals || []) {
  const result = await walletClient.request(approval);
  if (!depositTxHash && typeof result === "string") {
    depositTxHash = result as Hex;
  }
}

if (depositTxHash) {
  const { orderId } = await client.submitDeposit({
    quoteId: quotes.quoteId,
    routeId: bestRoute.routeId,
    txHash: depositTxHash,
  });
  console.log("hyperstream order queued", orderId);
}
```

`buildDeposit` returns every approval/transaction in the exact order required (allowances, permits, final deposits, etc.), so you can either surface them step-by-step or fire them all through a wallet UX.

### QuotesResponse quick reference

- `quoteId` — required for `buildDeposit` and `submitDeposit` calls.
- `routes[].routeId` — unique filler identifier (Across, Native, Uniswap Gateway, etc.).
- `routes[].type` — whether the route is native, external intent router, liquidity router, etc.
- `routes[].quote.expectedDurationSeconds` — SLA-style estimate of settlement time.
- `routes[].quote.validBefore` — expiry timestamp (seconds). Request a fresh quote if it lapses.

## API Overview

If you prefer calling the REST API directly.

### POST /v1/quotes

- **Purpose**: return a `quoteId` plus every available route (and optional NDJSON stream of `QuoteStreamItem`s).
- **Body**: `QuoteRequest`
- **Query**:
  - `mode=stream` — switches the response to `application/x-ndjson`
- **Response**: `QuotesResponse`
- **Errors**: `ValidationException`, `CannotFillException`, `NotSupportedTokenException`, `NotSupportedChainException`, `RateLimitException`

### GET /v1/tokens

- **Purpose**: fuzzy token search with cursor pagination (database-backed).
- **Query params**:
  - `q?`, `chainIds?`, `addresses?`, `symbols?`, `limit?`, `cursor?`
- **Response**: `TokenSearchResponse` (`data` + `cursor`). When `cursor` is `undefined`, pagination is complete.

### GET /v1/tokens/search

- **Purpose**: adapter/semantic token search (`q` required, optional `chainIds[]` filter).
- **Response**: `{ "data": Token[] }`

### GET /v1/chains

- **Purpose**: list supported chains and metadata.
- **Response**: `Chain[]`.

### GET /v1/intent/:intentId

- **Purpose**: fetch the full record for a specific intent.
- **Response**: `IntentDetailsResponse`; returns `404` if not found.

### GET /v1/intent/deposit/:chainId/:txHash

- **Purpose**: look up an intent using its deposit transaction.
- **Response**: `IntentDetailsResponse`; returns `404` if not found.

### POST /v1/deposit/build

- **Purpose**: expand a `{ quoteId, routeId }` into wallet-ready approvals and transactions.
- **Body**: `{ "from": "0x...", "quoteId": "...", "routeId": "Across" }`
- **Response**: `Deposit`

### PUT /v1/deposit/submit

- **Purpose**: register a deposit transaction and obtain a Hyperstream order id.
- **Body** `SubmitDepositRequest`

```json
{
  "quoteId": "quote-123",
  "routeId": "Across",
  "txHash": "0xabc..."
}
```

- **Response**: `{ "orderId": "order_123" }`
