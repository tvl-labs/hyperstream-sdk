import type { Address, Hex } from "viem";

export enum TradeType {
  ExactInput = "EXACT_INPUT",
  ExactOutput = "EXACT_OUTPUT",
}

export type FillerType =
  | "native-filler"
  | "external-intent-router"
  | "liquidity-router"
  | "aggregator-router";

export interface QuoteRequest {
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

export interface QuoteResult {
  amountIn: string;
  amountOut: string;
  expectedDurationSeconds: number;
  /**
   * Unix timestamp (seconds).
   */
  validBefore: number;
  encodePayload?: string;
}

export interface QuoteRoute {
  routeId: string;
  type: FillerType;
  quote: QuoteResult;
}

export interface QuotesResponse {
  quoteId: string;
  routes: QuoteRoute[];
}

export interface QuoteStreamItem extends QuoteRoute {
  quoteId: string;
}

export interface WalletSwitchChainRequest {
  method: "wallet_switchEthereumChain";
  params: [{ chainId: Hex }];
}

export interface EthSendTransactionParams {
  from: Address;
  to: Address;
  data?: Hex;
  value?: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: Hex;
}

export interface SendTransactionRequest {
  method: "eth_sendTransaction";
  params: [EthSendTransactionParams];
}

export interface EIP1193RequestApproval {
  type: "eip1193_request";
  request: WalletSwitchChainRequest | SendTransactionRequest;
  waitForReceipt?: boolean;
  deposit?: boolean;
}

export interface SolanaSendTransactionApproval {
  type: "solana_sendTransaction";
  transaction: string;
}

export type Approval = EIP1193RequestApproval | SolanaSendTransactionApproval;

export interface ContractCallDeposit {
  kind: "CONTRACT_CALL";
  approvals?: Approval[];
}

export type Deposit = ContractCallDeposit;

export interface BuildDepositRequest {
  from: string;
  quoteId: string;
  routeId: string;
}

export interface SubmitDepositRequest {
  quoteId: string;
  routeId: string;
  txHash: Hex;
}

export interface SubmitDepositResponse {
  orderId: string;
}

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
  rpcUrls: Record<string, ChainRpcUrls> & { default: ChainRpcUrls };
  blockExplorers?: Record<string, ChainBlockExplorer> & {
    default: ChainBlockExplorer;
  };
  testnet?: boolean;
}

export interface TokenBase {
  address: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  platform?: string;
}

export interface TokenExtensions {
  balance?: string;
  isRiskToken?: boolean;
  price?: {
    usd: string;
  };
  change?: string;
  volume?: string;
  marketCap?: string;
  liquidity?: string;
  firstTradeTime?: string;
  holders?: string;
  uniqueTraders?: string;
  txs?: string;
  txsBuy?: string;
  txsSell?: string;
  change24h?: string;
  spokeToken?: TokenBase;
}

export interface Token extends TokenBase {
  id?: string;
  extensions?: TokenExtensions;
}

export interface MToken extends TokenBase {
  extensions: {
    spokeToken: TokenBase;
  };
}

export interface SearchTokensRequest {
  q?: string;
  chainIds?: number[];
  limit?: number;
  cursor?: number;
  addresses?: string[];
  symbols?: string[];
}

export interface TokenSearchResponse {
  data: Token[];
  cursor?: number;
}

export interface TokenSearchAdaptersRequest {
  q: string;
  chainIds?: number[];
}

export type SemanticSlot =
  | "amount"
  | "usdAmount"
  | "tokenSymbol"
  | "chain"
  | "keyword";

export interface TokenAutocompleteItem {
  description: string;
  chain: Chain;
  token: Token;
  amount?: string;
  usdAmount?: string;
}

export interface TokenAutocompleteParsed {
  amount?: string;
  usdAmount?: string;
  tokenQuery?: string;
  chainQuery?: string;
  hasOn?: boolean;
  intent?: "receive";
}

export interface TokenAutocompleteResponse {
  data: TokenAutocompleteItem[];
  parsed: TokenAutocompleteParsed;
  nextSlots: SemanticSlot[];
}

export interface TokenAutocompleteQuery {
  chainIds?: number[];
  limit?: number;
}

export interface TokenBalancesQuery {
  chainIds?: number[];
}

export interface TopTokensQuery {
  chainIds?: number[];
}

export interface Vault {
  symbol: string;
  name: string;
  description: string;
  vault: Address;
  teller: Address;
  assets: Address[];
  testnet?: boolean;
  decimals: number;
  backend: string;
  extensions?: {
    coingeckoId?: string;
  };
}

export interface HubContracts {
  accessManager: Address;
  intentBook: Address;
  crossChainIntentBook: Address;
  mTokenManager: Address;
  mTokenRegistry: Address;
  mTokenVaultFactory: Address;
  gateway: Address;
  hyperlaneVerifier: Address;
  vaultLib?: Address;
  intentLib?: Address;
  stableAssetRateProvider?: Address;
  assetReserves: Record<string, Address>;
}

export interface ArcadiaConfig {
  chainId: number;
  medusaURL: string;
  contract: HubContracts;
}

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

export interface IntentDepositResponse {
  id: number;
  intentId: Hex;
  chainId: number;
  txHash: Hex;
  amountIn: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface IntentDetailsResponse {
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

export interface IntentsByAuthorResponse {
  data: IntentSummary[];
  cursor?: number;
}

export interface IntentsByAuthorQuery {
  limit?: number;
  cursor?: number;
  fromChainId?: number;
  toChainId?: number;
}

export type OrderStatus =
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

export interface Order {
  id: string;
  type: FillerType;
  quoteId: string;
  routeId: string;
  fromChainId: number;
  fromToken: Address;
  toChainId: number;
  toToken: Address;
  srcAmount: string;
  destAmount: string;
  status: OrderStatus;
  author: Address;
  depositTxHash?: Hex | null;
  externalOrderId?: string | null;
  createdAt: string;
  updatedAt: string;
  tradeType: TradeType;
}

export interface OrdersResponse {
  data: Order[];
  cursor?: number;
}

export interface OrdersQuery {
  fromChainId?: number;
  toChainId?: number;
  limit?: number;
  cursor?: number;
  orderIds?: string[];
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

export type HyperstreamClient = HyperstreamClientInterface;
