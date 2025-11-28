# Hyperstream SDK

## Types

Core TypeScript contracts shared by the SDK and REST API so integrators can rely on strong typing end to end.

```ts
import { Chain, Hex, Address } from "viem";

interface HyperstreamClient {
  quotes(request: QuoteRequest): Promise<QuoteResponse>;

  getToken(chainId: number, address: Address): Promise<Token | null>;
  getToken(chainId: number, symbol: string): Promise<Token | null>;

  searchTokens(request: SearchTokensRequest): AsyncGenerator<Token[]>;

  getChains(): Promise<Chain[]>;

  getIntentStatus(intent: Hex): Promise<IntentStatus>;

  getIntentByDeposit(
    chainId: number,
    txHash: string
  ): Promise<IntentDeposit | null>;

  submitDeposit(request: SubmitDepositRequest): Promise<boolean>;
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

export enum TradeType {
  ExactInput = "EXACT_INPUT",
  ExactOutput = "EXACT_OUTPUT",
}

interface QuoteRequest {
  fromAddress: Address;
  tradeType: TradeType;
  fromChainId: number;
  fromToken: Address;
  toChainId: number;
  toToken: Address;
  amount: Hex | string;
}

interface QuoteResponse {
  tradeType: TradeType;

  fromChainId: number;
  fromToken: string;
  toChainId: number;
  toToken: string;

  amountIn: Hex;
  amountOut: Hex;

  expectedDurationSeconds: number;
  validBefore: string;

  intentId: string;
  intent: CrossChainIntent;

  deposit?: ContractCallDeposit;
}

interface CrossChainIntent {
  author: Address;
  validBefore: Hex;
  nonce: Hex;
  srcMToken: Address;
  srcAmount: Hex;
  destinationChainId: number;
  nativeOutcome: Hex;
  outcomeToken: Address;
  outcomeAmount: Hex;
}

interface SearchTokensRequest {
  q: string; // query by symbol, name, or token address
  chainIds?: number[];
  limit?: number;
  cursor?: number;
  addresses?: Address[];
  symbols?: string[];
}

interface SubmitDepositRequest {
  intentId: Hex;
  srcChainId: number;
  txHash: Hex;
  amountIn: Hex;
}

interface ContractCallDeposit {
  kind: "CONTRACT_CALL";
  approvals?: Array<{
    method: string;
    params: unknown[];
  }>;
}

interface Token {
  address: Address;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  extensions?: unknown;
}

interface TokenSearchResponse {
  data: Token[];
  cursor?: number;
}

interface IntentDeposit {
  chainId: number;
  txHash: Hex;
  intentId: Hex;
  state: IntentState;
}

interface IntentStatus {
  intent: {
    raw: CrossChainIntent;
    state: IntentState;
  };
  deposits: Array<{
    srcChainId: number;
    txHash: string;
    amountIn: string;
    confirmedAt: string;
  }>;
  fills?: Array<{
    destinationChainId: number;
    txHash: string;
    destTokenAmountFilled: string;
    destNativeAmountSent: string;
    filler: string;
    timestamp: string;
  }>;
  refunds?: Array<{
    txHash: Hex;
    refundAmount: Hex;
    timestamp: string;
    recipient: Address;
  }>;
  openedAt: string;
  filledAt: string;
  settledAt: string;
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

- `quotes(request)` — fetches a cross-chain quote plus the contract call plan, returns a `QuoteResponse`.
- `getToken(chainId, address | symbol)` — fetches a single token by address or symbol.
- `searchTokens(request)` — fuzzy token search with keyword/chain/address filters. Returns `AsyncGenerator<Token[]>`, each page being a batch of tokens.
- `getChains()` — lists all supported chains.
- `getIntentStatus(intentId)` — fetches full intent status.
- `getIntentByDeposit(chainId, txHash)` — looks up an intent by deposit transaction.
- `submitDeposit(request)` — submits an off-chain record of a deposit transaction to speed up UX feedback loops.

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

Pagination uses cursors under the hood. The SDK automatically injects the `cursor` returned from the previous page into the next request, so iterating with `for await ... of` streams the full result set. If you want manual control (for a "Load more" button, for example) you can stop iterating at any time.

### Intent queries

```ts
const status = await client.getIntentStatus(intentId);

const intent = await client.getIntentByDeposit(42161, "0xabc...");
if (intent) {
  console.log(intent.intent.state, intent.deposits.length);
}
```

The `IntentState` enum covers every lifecycle phase (`Open`, `Locked`, `Solved`, etc.), which is useful for rendering timeline components or firing notifications in your app.

### Quote and Sign

```ts
import { createWalletClient, http, parseUnits, type Hex } from "viem";

const walletClient = createWalletClient({
  /* ... */
});

const quote = await client.quotes({
  fromAddress: walletClient.account.address,
  tradeType: "EXACT_INPUT",
  fromChainId: 42161,
  fromToken: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
  toChainId: 8453,
  toToken: "0x4200000000000000000000000000000000000006",
  amount: parseUnits("100", 6).toString(),
});

let depositTxHash: Hex | undefined;

for (const approval of quote.deposit?.approvals || []) {
  // request already includes every RPC argument
  const result = await walletClient.request(approval);
  if (!depositTxHash && typeof result === "string") {
    depositTxHash = result as Hex;
  }
}

if (depositTxHash) {
  await client.submitDeposit({
    intentId: quote.intentId as Hex,
    srcChainId: quote.fromChainId,
    txHash: depositTxHash,
    amountIn: quote.amountIn,
  });
}
```

`QuoteResponse.deposit?.approvals` lists every required on-chain action (allowances, permits, final deposits, etc.) in order, so you can either surface them step-by-step or fire them all through a wallet UX.

### QuoteResponse quick reference

- `intentId` — use this to poll `getIntentStatus` or correlate webhooks.
- `expectedDurationSeconds` — SLA-style estimate of settlement time.
- `validBefore` — expiry timestamp; request a fresh quote if it lapses.
- `deposit.approvals` — ordered JSON-RPC payloads (`eth_sendTransaction`, `eth_signTypedData_v4`, etc.).

## API Overview

If you prefer calling the REST API directly.

### POST /v1/quotes

- **Purpose**: return an intent, contract call data, and signing plan for a cross-chain swap.
- **Body**: `QuoteRequest`
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

- **Response**: `QuoteResponse`, including `deposit.approvals` for wallet execution.
- **Error codes**: `CannotFillException`, `NotSupportedTokenException`, `NotSupportedChainException`, `RateLimitException`

### POST /v1/tokens/search

- **Purpose**: fuzzy token search with cursor pagination.
- **Body**: `SearchTokensRequest`
- **Example**

```json
{
  "q": "USDC",
  "chainIds": [42161, 8453],
  "limit": 50,
  "cursor": 150
}
```

- **Response**: `TokenSearchResponse` (`data` + `cursor`). When `cursor` is `undefined`, pagination is complete.

### GET /v1/chains

- **Purpose**: list supported chains and metadata.
- **Response**: `Chain[]`.

### GET /v1/intent/:intentId

- **Purpose**: fetch the full record for a specific intent.
- **Response**: `IntentStatus`; returns `404` if not found.

### GET /v1/intent/by-deposit/:chainId/:txHash

- **Purpose**: look up an intent using its deposit transaction.
- **Response**: `IntentDeposit`; returns `404` if not found.

### POST /v1/deposits/submit

- **Purpose**: submit a deposit transaction record to speed up UX feedback loops and debugging.
- **Body** `SubmitDepositRequest`
- **Example**

```json
{
  "intentId": "0x1234...",
  "srcChainId": 42161,
  "txHash": "0xabc...",
  "amountIn": "1000000"
}
```

- **Response**: `200 OK` with `{ "status": "accepted" }` (empty body reserved for future metadata). Duplicate submissions are idempotent.
