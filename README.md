# Hyperstream API

This README defines **request/response types inline per endpoint** (in `## API Overview`) so readers can copy/paste without hunting for shared type blocks.

## Usage (Quote → Build Deposit → Submit Deposit → Track)

The API flow is:

- **Quote** (`POST /v1/quotes`) → pick a `routeId`
- **Build deposit** (`POST /v1/deposit/build`) → get wallet action plan (`approvals[]`)
- **Submit deposit** (`PUT /v1/deposit/submit`) → create an order record (`orderId`)
- **Track** via orders / intents endpoints

### Quote example (get routes)

```ts
const BASE_URL = "{{BASE_URL}}";

const res = await fetch(`${BASE_URL}/v1/quotes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fromAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    tradeType: "EXACT_INPUT",
    fromChainId: 42161,
    fromToken: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    toChainId: 8453,
    toToken: "0x4200000000000000000000000000000000000006",
    amount: "1000000",
  }),
});

if (!res.ok) throw new Error(await res.text());

const quotes = await res.json()
const bestRoute = quotes.routes[0];
if (!bestRoute) throw new Error("No routes available");

console.log("quoteId:", quotes.quoteId);
console.log("best route:", bestRoute.routeId, bestRoute.type, bestRoute.quote.amountOut);
```

### EVM example (execute EIP-1193 approvals)

```ts
import { isHex } from "viem";

const buildRes = await fetch(`${BASE_URL}/v1/deposit/build`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    from: quoteReq.fromAddress,
    quoteId: quotes.quoteId,
    routeId: route.routeId,
  }),
});
if (!buildRes.ok) throw new Error(await buildRes.text());
const deposit = await buildRes.json()

let depositTxHash: Hex | null = null;
for (const approval of deposit.approvals ?? []) {
  if (approval.request.method === "wallet_switchEthereumChain") {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: approval.request.params,
    });
    continue;
  }

  const result = await ethereum.request({
    method: "eth_sendTransaction",
    params: approval.request.params,
  });

  if (typeof result === "string" && isHex(result)) {
    const txHash = result as Hex;
    if (approval.waitForReceipt) {
      // Optional: wait for receipt using your client stack (wagmi publicClient, ethers, viem public client, etc.)
      // await publicClient.waitForTransactionReceipt({ hash: txHash })
    }
    if (approval.deposit) depositTxHash = txHash;
  }
}

if (!depositTxHash) throw new Error("No deposit transaction hash produced.");

const submitRes = await fetch(`${BASE_URL}/v1/deposit/submit`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    txHash: depositTxHash,
    quoteId: quotes.quoteId,
    routeId: route.routeId,
  }),
});
if (!submitRes.ok) throw new Error(await submitRes.text());
const submitted = (await submitRes.json()) as { orderId: string };
console.log("orderId:", submitted.orderId);
```

### Solana example (execute Solana approvals)

```ts
import { VersionedTransaction } from "@solana/web3.js";

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const buildRes = await fetch(`${BASE_URL}/v1/deposit/build`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    from: quoteReq.fromAddress,
    quoteId: quotes.quoteId,
    routeId: route.routeId,
  }),
});
if (!buildRes.ok) throw new Error(await buildRes.text());
const deposit = (await buildRes.json()) as {
  approvals?: Array<{
    type: "solana_sendTransaction";
    transaction: string;
    deposit?: boolean;
  }>;
};

let depositSignature: string | null = null;
const approvals = deposit.approvals ?? [];
for (let i = 0; i < approvals.length; i++) {
  const approval = approvals[i];
  const txBytes = base64ToBytes(approval.transaction);
  const tx = VersionedTransaction.deserialize(txBytes);
  const signature = await solana.signAndSendTransaction(tx);
  if (approval.deposit) depositSignature = signature;
}

if (!depositSignature) throw new Error("No deposit signature produced.");

const submitRes = await fetch(`${BASE_URL}/v1/deposit/submit`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    txHash: depositSignature,
    quoteId: quotes.quoteId,
    routeId: route.routeId,
  }),
});
if (!submitRes.ok) throw new Error(await submitRes.text());
const submitted = (await submitRes.json()) as { orderId: string };
console.log("orderId:", submitted.orderId);
```

## API Overview

If you prefer calling the REST API directly.

### Error handling

- **General rule**: always check the HTTP status code first. On non-2xx, the body is usually JSON.
- **Standard error envelope** (most thrown errors):
  - `message`: human-readable message
  - `name`: stable error identifier
  - `details?`: optional structured metadata (often useful for UI / debugging)

```json
{
  "message": "string",
  "name": "string",
  "details": {}
}
```

- **Validation errors**:
  - Status: `400`
  - `name`: `ValidationException`
  - `details`: array of issues with `{ field, message, code }`

```json
{
  "message": "Validation failed",
  "name": "ValidationException",
  "details": [
    {
      "field": "fromChainId",
      "message": "Chain ID must be a positive integer",
      "code": "too_small"
    }
  ]
}
```

- **Quote KV lookup errors** (e.g. deposit build/submit with an expired or already-consumed quote):
  - Status: `404`
  - `name`: `QuoteNotFoundException`

```json
{
  "message": "Quote(quoteId: 123, routeId: Across) not found",
  "name": "QuoteNotFoundException",
  "details": {
    "quoteId": "123",
    "routeId": "Across",
    "code": 2
  }
}
```

- **Unhandled errors**:
  - Status: `500`
  - Body: `{ "message": "Internal Error", "name": "InternalErrorException" }`

- **Stream mode (`POST /v1/quotes?mode=stream`)**:
  - If the request body fails validation, the API responds with the normal JSON error (no stream).
  - Individual route/filler failures are **silently skipped** (you may receive fewer lines than the number of fillers).
  - The NDJSON stream **closes cleanly** once all fillers have either produced a result or failed.

### Exception catalog

All entries below are returned using the standard error envelope `{ message, name, details? }`, **except** the Prisma unique constraint fallback noted in `DuplicateRecordException`.

| name | status | message | details | notes / where it happens |
| --- | --- | --- | --- | --- |
| `ValidationException` | `400` | `"Validation failed"` | `Array<{ field: string; message: string; code: string }>` | zod validation failures via `validator(...)` |
| `CannotFillException` | `400` | `"Cannot fill the quote"` | `unknown` | when a filler/provider cannot produce a quote (e.g. upstream error or unsupported pair) |
| `UnexpectedFromAddressException` | `400` | `"Unexpected from address: ${from}"` | `undefined` | when a route expects Solana vs EVM `from` (or vice versa) |
| `NotSupportedContractException` | `400` | `"Not contract ${name}"` | `undefined` | contract/config selection rejects the input |
| `BuildDepositParsingException` | `400` | `"Parsing failed"` (or custom message) | `{ id: string; type: FillerType; raw: unknown }` | when the stored `quote.encodePayload` can't be parsed for building deposits |
| `NotSupportedTokenException` | `404` | `"Token ${token} is not supported"` | `undefined` | token not supported by a filler/config |
| `NotSupportedChainException` | `404` | `"Chain ${chainId} is not supported"` | `undefined` | chain not supported by a filler/config |
| `NotSupportedAssetReverseContractException` | `404` | `"Chain ${chainId} AssetReverse is not supported"` | `undefined` | required Arcadia contract not configured for that chain |
| `IntentNotFoundException` | `404` | `"Intent not found"` | `undefined` | when an intent payload is missing / can't be derived |
| `QuoteNotFoundException` | `404` | `"Quote(quoteId: ${quoteId}, routeId: ${routeId}) not found"` | `{ quoteId: string; routeId: string; code: number }` | deposit build/submit when the quote record is missing/expired/already consumed |
| `DuplicateRecordException` | `409` | `"${entity} already exists"` | `unknown` | used by services; **special-case**: Prisma unique constraint (`P2002`) is caught by `globalErrorHandler` and currently returns `{ message: "Duplicate record", name: "DuplicateRecordException" }` (status not explicitly set) |
| `InternalErrorException` | `500` | `"Internal Error"` | `unknown` | thrown explicitly in some routes/providers; also used as generic 500 fallback name |

### POST /v1/quotes

- **Purpose**: fetch quote candidates across all available routes.
- **Body**: `QuoteRequest`
- **Query**:
  - `mode=stream` — stream each route result as NDJSON (`application/x-ndjson`), one JSON object per line.

```ts
export interface PostQuotesQuery {
  /**
   * When set to "stream", the endpoint responds with NDJSON (one JSON object per line).
   */
  mode?: "stream";
}
```
- **Example**

```json
{
  "fromAddress": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "tradeType": "EXACT_INPUT",
  "fromChainId": 11155111,
  "fromToken": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  "toChainId": 11155111,
  "toToken": "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
  "amount": "100000"
}
```

- **Response (default)**:

```ts
export type Address = string;
export type Hex = string;

export type TradeType = "EXACT_INPUT" | "EXACT_OUTPUT";
export type FillerType =
  | "native-filler"
  | "external-intent-router"
  | "liquidity-router"
  | "aggregator-router";

export interface QuoteResult {
  amountIn: string;
  amountOut: string;
  expectedDurationSeconds: number;
  /** Unix timestamp (seconds). */
  validBefore: number;
}

export interface PostQuotesResponse {
  quoteId: string;
  routes: Array<{
    routeId: string;
    type: FillerType;
    quote: QuoteResult;
  }>;
}
```

- **Response (stream mode)**:

```ts
export type Address = string;
export type Hex = string;

export type FillerType =
  | "native-filler"
  | "external-intent-router"
  | "liquidity-router"
  | "aggregator-router";

export interface QuoteResult {
  amountIn: string;
  amountOut: string;
  expectedDurationSeconds: number;
  /** Unix timestamp (seconds). */
  validBefore: number;
}

export interface PostQuotesStreamItem {
  quoteId: string;
  routeId: string;
  type: FillerType;
  quote: QuoteResult;
}
// Content-Type: application/x-ndjson
// Each line is one `PostQuotesStreamItem` JSON object.
```
- **Errors**: JSON object `{ message, name, details? }` (e.g. `ValidationException` (400), `CannotFillException` (400), `NotSupportedTokenException` (404)).

### GET /v1/tokens

- **Purpose**: token search with cursor pagination (DB-backed).
- **Query**:
  - `q?` — symbol/name/address
  - `chainIds?` — repeated or comma-separated
  - `addresses?` — repeated or comma-separated
  - `symbols?` — repeated or comma-separated
  - `limit?` (default 50, max 2000)
  - `cursor?` (default 0)

```ts
export type Address = string;

/**
 * Validated query params (post-zod).
 * Note: array params accept repeated keys and/or comma-separated forms in the raw URL.
 */
export interface GetTokensQuery {
  q?: string;
  chainIds?: number[];
  limit?: number;
  cursor?: number;
  addresses?: Address[];
  symbols?: string[];
}
```
- **Response**:

```ts
export interface GetTokensResponse {
  data: Array<{
    id: string;
    address: string;
    chainId: number;
    name: string;
    symbol: string;
    decimals: number;
    logoURI?: string;
    platform?: string;
    extensions?: unknown;
  }>;
  cursor?: number;
}
```

### GET /v1/tokens/search

- **Purpose**: fast token search via adapters (no cursor; intended for UI search).
- **Query**:
  - `q` (required)
  - `chainIds?`

```ts
/**
 * Validated query params (post-zod).
 * Note: `chainIds` accepts repeated keys and/or comma-separated forms in the raw URL.
 */
export interface GetTokensSearchQuery {
  q: string;
  chainIds?: number[];
}
```
- **Response**:

```ts
export interface GetTokensSearchResponse {
  data: Array<{
    address: string;
    chainId: number;
    name: string;
    symbol: string;
    decimals: number;
    logoURI?: string;
    /**
     * Adapter-dependent metadata (OKX / DB / etc).
     * Always an object (never null) in this endpoint.
     */
    extensions: object;
  }>;
}
```

### GET /v1/tokens/autocomplete/:keyword

- **Purpose**: template-style autocomplete (supports patterns like `"1 USDC on Base"`).
- **Query**:
  - `chainIds?`
  - `limit?` (max 20)

```ts
/**
 * Validated query params (post-zod).
 * Note: `chainIds` accepts repeated keys and/or comma-separated forms in the raw URL.
 */
export interface GetTokensAutocompleteQuery {
  chainIds?: number[];
  limit?: number;
}
```
- **Response**:

```ts
export type ChainType = "eip155" | "solana" | "bitcoin";

export interface ChainBlockExplorer {
  name: string;
  url: string;
  apiUrl?: string;
}

export interface ChainRpcUrls {
  http: readonly string[];
  webSocket?: readonly string[];
}

export interface Chain {
  type: ChainType;
  id: number;
  name: string;
  nativeCurrency: {
    symbol: string;
    decimals: number;
  };
  rpcUrls: {
    [key: string]: ChainRpcUrls;
    default: ChainRpcUrls;
  };
  blockExplorers?:
    | {
        [key: string]: ChainBlockExplorer;
        default: ChainBlockExplorer;
      }
    | undefined;
  testnet?: boolean | undefined;
}

export interface Token {
  address: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  extensions?: unknown;
}

export interface TokenAutocompleteItem {
  description: string;
  chain: Chain;
  token: Token;
  amount?: string;
}

export interface GetTokensAutocompleteResponse {
  data: TokenAutocompleteItem[];
}
```

### GET /v1/tokens/top

- **Purpose**: top tokens by chain.
- **Query**: `chainIds?`

```ts
/**
 * Validated query params (post-zod).
 * Note: `chainIds` accepts repeated keys and/or comma-separated forms in the raw URL.
 */
export interface GetTokensTopQuery {
  chainIds?: number[];
}
```
- **Response**:

```ts
export interface Token {
  address: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  extensions?: unknown;
}

export type GetTokensTopResponse = Token[];
```

### GET /v1/tokens/balances/:address

- **Purpose**: token balances for an address (EVM or Solana).
- **Query**: `chainIds?`

```ts
/**
 * Validated query params (post-zod).
 * Note: `chainIds` accepts repeated keys and/or comma-separated forms in the raw URL.
 */
export interface GetTokenBalancesByAddressQuery {
  chainIds?: number[];
}
```
- **Response**:

```ts
export interface TokenWithBalance {
  address: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  extensions: {
    balance: string;
    isRiskToken?: boolean;
    price: {
      usd: string;
    };
  };
}

export type GetTokenBalancesByAddressResponse = TokenWithBalance[];
```

### GET /v1/mtokens

- **Purpose**: list configured mTokens for the current hub config.
- **Response**:

```ts
export interface Token {
  address: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

export interface MToken extends Omit<Token, "extensions"> {
  extensions: {
    spokeToken: Token;
  };
}

export type GetMTokensResponse = MToken[];
```

### GET /v1/chains

- **Purpose**: list supported chains and metadata.
- **Response**:

```ts
export interface ChainRpcUrls {
  http: readonly string[];
  webSocket?: readonly string[];
}

export interface ChainBlockExplorer {
  name: string;
  url: string;
  apiUrl?: string;
}

/**
 * `/v1/chains` returns EVM chains (Viem chain objects) without an explicit `type` field.
 */
export interface EvmChain {
  id: number;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: {
    [key: string]: ChainRpcUrls;
    default: ChainRpcUrls;
  };
  blockExplorers?:
    | {
        [key: string]: ChainBlockExplorer;
        default: ChainBlockExplorer;
      }
    | undefined;
  testnet?: boolean | undefined;
}

export type GetChainsResponse = EvmChain[];
```

### GET /v2/chains

- **Purpose**: list supported chains (v2 shape).
- **Response**:

```ts
export type ChainType = "eip155" | "solana" | "bitcoin";

export interface ChainRpcUrls {
  http: readonly string[];
  webSocket?: readonly string[];
}

export interface ChainBlockExplorer {
  name: string;
  url: string;
  apiUrl?: string;
}

export interface Chain {
  type: ChainType;
  id: number;
  name: string;
  nativeCurrency: {
    symbol: string;
    decimals: number;
  };
  rpcUrls: {
    [key: string]: ChainRpcUrls;
    default: ChainRpcUrls;
  };
  blockExplorers?:
    | {
        [key: string]: ChainBlockExplorer;
        default: ChainBlockExplorer;
      }
    | undefined;
  testnet?: boolean | undefined;
}

export type GetChainsV2Response = Chain[];
```

### GET /v1/vaults

- **Purpose**: list configured vaults for the current hub config.
- **Response**:

```ts
export interface Vault {
  symbol: string;
  name: string;
  description: string;
  vault: string;
  teller: string;
  assets: string[];
  testnet?: boolean;
  decimals: number;
  backend: string;
  extensions?: {
    coingeckoId?: string;
  };
}

export type GetVaultsResponse = Vault[];
```

### GET /v1/config/arcadia

- **Purpose**: returns selected runtime config (based on `HUB_CHAIN_ID`).
- **Response**:

```ts
export type GetConfigArcadiaResponse = ArcadiaConfig;

export type HexChainId = `0x${string}`;

export interface HubContracts {
  accessManager: string;
  intentBook: string;
  crossChainIntentBook: string;
  mTokenManager: string;
  mTokenRegistry: string;
  mTokenVaultFactory: string;
  gateway: string;
  hyperlaneVerifier: string;
  vaultLib?: string;
  intentLib?: string;
  stableAssetRateProvider?: string;
  assetReserves: Record<HexChainId, string>;
}

export interface ArcadiaConfig {
  chainId: number;
  medusaURL: string;
  contract: HubContracts;
}
```

Example:

```json
{
  "chainId": 4278608,
  "medusaURL": "https://medusa.example",
  "contract": {
    "accessManager": "0x3d00b558cAc8a858f9F4E22C78D49084acb4De45",
    "intentBook": "0xbb86f16F76f0BD566fc0704e9C1cF4b2aAfE8ec9",
    "crossChainIntentBook": "0xE743384109111f957f07c2BD644303ED4fa58E29",
    "mTokenManager": "0x6d5Aa1e443cCA7eB43BA7D59Cc839f361fb87B08",
    "mTokenRegistry": "0x23cD6d5e4ccC065ca0Fb97c127F333f156A0b26A",
    "mTokenVaultFactory": "0xdaa09350803aD16886D4Ad83d169faaDAd7B8Cc1",
    "gateway": "0xC88E67A1B4c105D101C39E4c32b3c625F2c70B1f",
    "hyperlaneVerifier": "0x027087a744dD44e13AeF377d69013C355E2D7994",
    "stableAssetRateProvider": "0x5D1e06059089716C4B90441b3053Ef57DD17A6Ce",
    "assetReserves": {
      "0x1": "0x4bACc118f9CEe2f6e9b52AAb317F8b5aaf2503F5",
      "0xa4b1": "0xb280C373F57c9169e009a66496EE556084afAd24",
      "0x2105": "0x1A7c327d0f402AEf2eD3D20D1141bD71BA1C317B"
    }
  }
}
```

### GET /v1/intent/:intentId

- **Purpose**: fetch the full record for a specific intent.
- **Response**:

```ts
export type Address = string;
export type Hex = string;

export type IntentState =
  | "NonExistent"
  | "Open"
  | "Locked"
  | "Solved"
  | "Settled"
  | "Expired"
  | "Cancelled"
  | "Error";

export interface IntentDepositResponse {
  id: number;
  intentId: Hex;
  chainId: number;
  txHash: Hex;
  amountIn: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface GetIntentByIntentIdResponse {
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
```

### GET /v1/intent/deposit

- **Purpose**: look up an intent using its deposit transaction.
- **Notes**: this route is currently registered without path params; the handler validates `chainId` and `txHash` as path params, so calls may fail validation until the API is updated.
- **Response**:

```ts
export type Address = string;
export type Hex = string;

export type IntentState =
  | "NonExistent"
  | "Open"
  | "Locked"
  | "Solved"
  | "Settled"
  | "Expired"
  | "Cancelled"
  | "Error";

export interface IntentDepositResponse {
  id: number;
  intentId: Hex;
  chainId: number;
  txHash: Hex;
  amountIn: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface GetIntentByDepositResponse {
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
```

### GET /v1/intents/:author

- **Purpose**: list intents by author (paginated).
- **Query**:
  - `limit?` (default 25, max 100)
  - `cursor?` (default 0)
  - `fromChainId?`
  - `toChainId?`

```ts
/**
 * Validated query params (post-zod).
 */
export interface GetIntentsByAuthorQuery {
  limit?: number;
  cursor?: number;
  fromChainId?: number;
  toChainId?: number;
}
```
- **Response**:

```ts
export type Address = string;
export type Hex = string;

export type IntentState =
  | "NonExistent"
  | "Open"
  | "Locked"
  | "Solved"
  | "Settled"
  | "Expired"
  | "Cancelled"
  | "Error";

export interface IntentSummary {
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
}

export interface GetIntentsByAuthorResponse {
  data: IntentSummary[];
  cursor?: number;
}
```

### POST /v1/deposit/build

- **Purpose**: build a wallet execution plan for a previously quoted `quoteId` + `routeId`.
- **Body**: `BuildDepositRequest`
- **Response**:

```ts
export type Address = string;
export type Hex = string;

export type Approval =
  | {
      type: "eip1193_request";
      request:
        | { method: "wallet_switchEthereumChain"; params: [{ chainId: Hex }] }
        | {
            method: "eth_sendTransaction";
            params: [
              {
                from: Address;
                to: Address;
                data?: Hex;
                value?: string;
                gas?: string;
                gasPrice?: string;
                maxFeePerGas?: string;
                maxPriorityFeePerGas?: string;
                nonce?: Hex;
              },
            ];
          };
      waitForReceipt?: boolean;
      deposit?: boolean;
    }
  | {
      type: "solana_sendTransaction";
      /** base64-encoded transaction */
      transaction: string;
    };

export interface PostDepositBuildResponse {
  kind: "CONTRACT_CALL";
  approvals?: Approval[];
}
```

### PUT /v1/deposit/submit

- **Purpose**: submit the deposit `txHash` for a previously quoted `quoteId` + `routeId`; creates an order record.
- **Body**: `SubmitDepositRequest`
- **Response**:

```ts
export interface PutDepositSubmitResponse {
  orderId: string;
}
```

### GET /v1/orders/:address

- **Purpose**: list orders for an address (paginated) and refresh statuses.
- **Query**:
  - `limit?` (default 10, max 20)
  - `cursor?` (default 0)
  - `fromChainId?`
  - `toChainId?`
  - `orderIds?` — repeated or comma-separated

```ts
/**
 * Validated query params (post-zod).
 * Note: `orderIds` accepts repeated keys and/or comma-separated forms in the raw URL.
 */
export interface GetOrdersQuery {
  fromChainId?: number;
  toChainId?: number;
  limit?: number;
  cursor?: number;
  orderIds?: string[];
}
```
- **Response**:

```ts
export interface GetOrdersResponse {
  data: Array<{
    id: string;
    type: "native-filler" | "external-intent-router" | "liquidity-router" | "aggregator-router";
    quoteId: string;
    routeId: string;
    fromChainId: number;
    fromToken: string;
    toChainId: number;
    toToken: string;
    srcAmount: string;
    destAmount: string;
    status:
      | "pending"
      | "inflight"
      | "completed"
      | "settled"
      | "refunded"
      | "cancelled"
      | "expired"
      | "reverted"
      | "failed"
      | "timeout"
      | "unknown";
    author: string;
    depositTxHash: string;
    externalOrderId: string;
    createdAt: string;
    updatedAt: string;
    tradeType: "EXACT_INPUT" | "EXACT_OUTPUT";
  }>;
  cursor?: number;
}
```
