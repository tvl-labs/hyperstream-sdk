import type { Address, Chain, Hex } from "viem";

export enum IntentState {
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

export interface QuoteRequest {
  fromAddress: Address;
  tradeType: TradeType;
  fromChainId: number;
  fromToken: Address;
  toChainId: number;
  toToken: Address;
  amount: Hex | string;
}

export interface CrossChainIntent {
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

export interface ContractCallDeposit {
  kind: "CONTRACT_CALL";
  approvals?: Array<{
    method: string;
    params: unknown[];
  }>;
}

export interface QuoteResponse {
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

export interface SearchTokensRequest {
  q: string;
  chainIds?: number[];
  limit?: number;
  cursor?: number;
  addresses?: Address[];
  symbols?: string[];
}

export interface Token {
  address: Address;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  extensions?: unknown;
}

export interface TokenSearchResponse {
  data: Token[];
  cursor?: number;
}

export interface SubmitDepositRequest {
  intentId: Hex;
  srcChainId: number;
  txHash: Hex;
  amountIn: Hex;
}

export interface IntentDeposit {
  chainId: number;
  txHash: Hex;
  intentId: Hex;
  state: IntentState;
}

export interface IntentStatus {
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

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface HyperstreamClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  fetch?: FetchLike;
  userAgent?: string;
}

export interface HyperstreamClientInterface {
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

export type HyperstreamClient = HyperstreamClientInterface;
