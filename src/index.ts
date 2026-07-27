/**
 * CabalSpy SDK — multichain KOL, smart money and whale wallet tracking.
 *
 * Covers the full v1 REST API and the realtime gateway.
 * Chains: solana, bnb, base, eth, rh (Robinhood Chain).
 *
 * Auth: Authorization: Bearer <API_KEY> (or ?api_key=).
 * Every authenticated request costs 10 credits.
 */

// ═══════════════════════════════════════════════════════════════════════════
//  CHAINS AND TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const CHAINS = ['solana', 'bnb', 'base', 'eth', 'rh'] as const;
export type Chain = (typeof CHAINS)[number];

/** Wallet types per chain. Mirrors CHAIN_REGISTRY.wallet_types on the server. */
export interface WalletTypesByChain {
  solana: 'kol' | 'smart' | 'whale';
  bnb: 'kol' | 'smart';
  base: 'kol' | 'smart';
  eth: 'kol';
  rh: 'kol' | 'smart';
}

/** The wallet types a given chain actually supports, enforced at compile time. */
export type WalletTypeFor<C extends Chain> = WalletTypesByChain[C];
export type WalletType = WalletTypesByChain[Chain];

export type Period = '6h' | '1d' | '7d' | '30d';
export type Currency = 'SOL' | 'BNB' | 'ETH';

export const WALLET_TYPES_BY_CHAIN: Record<Chain, readonly WalletType[]> = {
  solana: ['kol', 'smart', 'whale'],
  bnb: ['kol', 'smart'],
  base: ['kol', 'smart'],
  eth: ['kol'],
  rh: ['kol', 'smart'],
};

export const CURRENCY_BY_CHAIN: Record<Chain, Currency> = {
  solana: 'SOL',
  bnb: 'BNB',
  base: 'ETH',
  eth: 'ETH',
  rh: 'ETH',
};

/**
 * Chains for which the REST API returns market cap, price and unrealized PNL.
 * On every other chain those REST fields come back null.
 *
 * The websocket gateway is different: it computes market cap for all chains
 * through its own price service, so `position_update`, `holder_update` and
 * `signal` events carry populated market cap and unrealized PNL on bnb, base,
 * eth and rh as well. Same field names, different availability per surface.
 */
export const MARKETCAP_CHAINS_REST: readonly Chain[] = ['solana'];

/** @deprecated Renamed to MARKETCAP_CHAINS_REST — the rule is REST-only. */
export const MARKETCAP_CHAINS: readonly Chain[] = ['solana'];

export function walletTypeIsValid(chain: Chain, type: string): boolean {
  return (WALLET_TYPES_BY_CHAIN[chain] as readonly string[]).includes(type);
}

// ═══════════════════════════════════════════════════════════════════════════
//  RESPONSE ENVELOPE
// ═══════════════════════════════════════════════════════════════════════════

export interface ResponseMeta {
  request_id: string;
  cached: boolean;
  cache_age_seconds: number;
  version: string;
  timestamp: string;
}

export interface Pagination {
  limit: number;
  total: number;
  has_more: boolean;
  next_cursor: string | null;
}

/** Shape of every successful API response. */
export interface ApiResponse<T> {
  success: true;
  data: T;
  pagination?: Pagination;
  meta: ResponseMeta;
}

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  /** Unix seconds at which the current minute window resets. */
  reset: number | null;
}

/** Response body plus the metadata carried in HTTP headers. */
export interface Envelope<T> extends ApiResponse<T> {
  rateLimit: RateLimitInfo;
  status: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ERRORS
// ═══════════════════════════════════════════════════════════════════════════

export interface ApiErrorBody {
  code: string;
  message: string;
  request_id: string;
  docs: string;
  parameter?: string;
  allowed?: unknown[];
}

/** Base class for every error thrown by this SDK. */
export class CabalSpyError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly docs?: string;
  readonly parameter?: string;
  readonly allowed?: unknown[];
  readonly rateLimit: RateLimitInfo;

  constructor(
    message: string,
    opts: {
      status?: number;
      code?: string;
      requestId?: string;
      docs?: string;
      parameter?: string;
      allowed?: unknown[];
      rateLimit?: RateLimitInfo;
    } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.status = opts.status ?? 0;
    this.code = opts.code ?? 'unknown_error';
    this.requestId = opts.requestId;
    this.docs = opts.docs;
    this.parameter = opts.parameter;
    this.allowed = opts.allowed;
    this.rateLimit = opts.rateLimit ?? { limit: null, remaining: null, reset: null };
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — missing_parameter / invalid_parameter / invalid_body */
export class BadRequestError extends CabalSpyError {}
/** 401 — missing_api_key */
export class AuthenticationError extends CabalSpyError {}
/** 403 — invalid_api_key / insufficient_credits */
export class PermissionError extends CabalSpyError {}
/** 403 — insufficient_credits. Separate class so billing can be handled on its own. */
export class InsufficientCreditsError extends PermissionError {}
/** 404 — wallet_not_found / token_not_found */
export class NotFoundError extends CabalSpyError {}
/** 429 — rate_limit_exceeded */
export class RateLimitError extends CabalSpyError {
  /** Seconds until the next request is allowed, taken from Retry-After. */
  readonly retryAfter: number | null;
  constructor(message: string, opts: ConstructorParameters<typeof CabalSpyError>[1] & { retryAfter?: number | null } = {}) {
    super(message, opts);
    this.retryAfter = opts.retryAfter ?? null;
  }
}
/** 5xx — internal_error / service_unavailable */
export class ServerError extends CabalSpyError {}
/** Network failure, timeout or aborted connection. */
export class ConnectionError extends CabalSpyError {}
/** Response was not valid JSON, or did not have the expected envelope. */
export class InvalidResponseError extends CabalSpyError {}

function errorFromStatus(
  status: number,
  body: ApiErrorBody | null,
  rateLimit: RateLimitInfo,
  retryAfter: number | null,
  fallbackMessage: string,
): CabalSpyError {
  const opts = {
    status,
    code: body?.code ?? `http_${status}`,
    requestId: body?.request_id,
    docs: body?.docs,
    parameter: body?.parameter,
    allowed: body?.allowed,
    rateLimit,
  };
  const msg = body?.message ?? fallbackMessage;

  if (status === 400) return new BadRequestError(msg, opts);
  if (status === 401) return new AuthenticationError(msg, opts);
  if (status === 403) {
    return body?.code === 'insufficient_credits'
      ? new InsufficientCreditsError(msg, opts)
      : new PermissionError(msg, opts);
  }
  if (status === 404) return new NotFoundError(msg, opts);
  if (status === 429) return new RateLimitError(msg, { ...opts, retryAfter });
  if (status >= 500) return new ServerError(msg, opts);
  return new CabalSpyError(msg, opts);
}

// ═══════════════════════════════════════════════════════════════════════════
//  CLIENT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export interface CabalSpyOptions {
  /** API key. Falls back to process.env.CABALSPY_API_KEY. */
  apiKey?: string;
  /** REST base URL including /v1. Default: https://api.cabalspy.xyz/v1 */
  baseUrl?: string;
  /** WebSocket gateway. Default: wss://stream.cabalspy.xyz */
  wsUrl?: string;
  /** Per-request timeout in milliseconds. Default: 30_000 */
  timeout?: number;
  /** Retries on 429, 5xx and network errors. Default: 2 */
  maxRetries?: number;
  /** Extra headers added to every request. */
  headers?: Record<string, string>;
  /** Custom fetch implementation, for Node < 18, tests or proxies. */
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE_URL = 'https://api.cabalspy.xyz/v1';
const DEFAULT_WS_URL = 'wss://stream.cabalspy.xyz';
const SDK_VERSION = '0.1.0';

type QueryValue = string | number | boolean | undefined | null;
type Query = Record<string, QueryValue>;

function buildQuery(params: Query): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function parseIntHeader(h: Headers, name: string): number | null {
  const raw = h.get(name);
  if (raw == null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════════
//  HTTP CORE
// ═══════════════════════════════════════════════════════════════════════════

export class CabalSpy {
  readonly baseUrl: string;
  readonly wsUrl: string;
  readonly timeout: number;
  readonly maxRetries: number;

  private readonly apiKey: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly fetchImpl: typeof globalThis.fetch;

  /** Rate limit state from the most recent request. */
  lastRateLimit: RateLimitInfo = { limit: null, remaining: null, reset: null };

  readonly system: SystemResource;
  readonly wallets: WalletsResource;
  readonly tokens: TokensResource;
  readonly transactions: TransactionsResource;
  readonly signals: SignalsResource;
  readonly analytics: AnalyticsResource;
  readonly bundle: BundleResource;

  constructor(options: CabalSpyOptions = {}) {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const envKey = env?.CABALSPY_API_KEY;
    const key = options.apiKey ?? envKey;
    if (!key) {
      throw new CabalSpyError(
        'Missing API key. Pass { apiKey } or set CABALSPY_API_KEY in the environment.',
        { code: 'missing_api_key' },
      );
    }
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.wsUrl = (options.wsUrl ?? DEFAULT_WS_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.extraHeaders = options.headers ?? {};

    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') {
      throw new CabalSpyError(
        'No fetch implementation available. Use Node 18+ or pass { fetch }.',
        { code: 'no_fetch' },
      );
    }
    this.fetchImpl = f.bind(globalThis);

    this.system = new SystemResource(this);
    this.wallets = new WalletsResource(this);
    this.tokens = new TokensResource(this);
    this.transactions = new TransactionsResource(this);
    this.signals = new SignalsResource(this);
    this.analytics = new AnalyticsResource(this);
    this.bundle = new BundleResource(this);
  }

  /** GET returning the full envelope: data, pagination, meta and rate limit headers. */
  async getRaw<T>(path: string, query: Query = {}): Promise<Envelope<T>> {
    return this.request<T>('GET', path + buildQuery(query));
  }

  /** GET returning only the data payload. */
  async get<T>(path: string, query: Query = {}): Promise<T> {
    return (await this.getRaw<T>(path, query)).data;
  }

  /** POST returning the full envelope. */
  async postRaw<T>(path: string, body: unknown): Promise<Envelope<T>> {
    return this.request<T>('POST', path, body);
  }

  /** POST returning only the data payload. */
  async post<T>(path: string, body: unknown): Promise<T> {
    return (await this.postRaw<T>(path, body)).data;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Envelope<T>> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    let lastError: CabalSpyError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await sleep(backoffDelay(attempt, lastError));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
            'User-Agent': `cabalspy-sdk/${SDK_VERSION}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...this.extraHeaders,
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        clearTimeout(timer);
        const aborted = (err as Error)?.name === 'AbortError';
        lastError = new ConnectionError(
          aborted ? `Request timed out after ${this.timeout} ms: ${method} ${path}` : `Network error: ${(err as Error).message}`,
          { code: aborted ? 'timeout' : 'connection_error' },
        );
        continue; // Network errors are retryable
      } finally {
        clearTimeout(timer);
      }

      const rateLimit: RateLimitInfo = {
        limit: parseIntHeader(res.headers, 'X-RateLimit-Limit'),
        remaining: parseIntHeader(res.headers, 'X-RateLimit-Remaining'),
        reset: parseIntHeader(res.headers, 'X-RateLimit-Reset'),
      };
      this.lastRateLimit = rateLimit;

      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      if (!res.ok) {
        const errBody = (parsed as { error?: ApiErrorBody } | null)?.error ?? null;
        const retryAfter = parseIntHeader(res.headers, 'Retry-After');
        const error = errorFromStatus(res.status, errBody, rateLimit, retryAfter, `HTTP ${res.status} on ${method} ${path}`);

        if (isRetryable(error) && attempt < this.maxRetries) {
          lastError = error;
          continue;
        }
        throw error;
      }

      if (parsed == null || typeof parsed !== 'object' || !('data' in (parsed as object))) {
        throw new InvalidResponseError(
          `Unexpected response shape on ${method} ${path}: no data field`,
          { status: res.status, code: 'invalid_response', rateLimit },
        );
      }

      const env = parsed as ApiResponse<T>;
      return { ...env, rateLimit, status: res.status };
    }

    throw lastError ?? new ConnectionError(`Request failed: ${method} ${path}`);
  }

  /**
   * Walks a cursor-paginated route and yields whole pages, not individual
   * items: the key holding the array differs from endpoint to endpoint.
   *
   *   for await (const page of client.pages(c => c.wallets.historyRaw({ ... })))
   */
  async *pages<T>(
    fetchPage: (cursor: string | undefined) => Promise<Envelope<T>>,
    maxPages = 100,
  ): AsyncGenerator<Envelope<T>, void, void> {
    let cursor: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const page = await fetchPage(cursor);
      yield page;
      const next = page.pagination?.next_cursor;
      if (!page.pagination?.has_more || !next) return;
      cursor = next;
    }
  }

  /** Builds the gateway URL including the auth query parameter. */
  websocketUrl(): string {
    return `${this.wsUrl}/?apiKey=${encodeURIComponent(this.apiKey)}`;
  }

  /** Opens a realtime client against the gateway. */
  realtime(options: RealtimeOptions = {}): CabalSpyRealtime {
    return new CabalSpyRealtime(this.wsUrl, this.apiKey, options);
  }
}

function isRetryable(err: CabalSpyError): boolean {
  return err instanceof RateLimitError || err instanceof ServerError || err instanceof ConnectionError;
}

function backoffDelay(attempt: number, lastError?: CabalSpyError): number {
  // The server's Retry-After takes precedence over our own backoff.
  if (lastError instanceof RateLimitError && lastError.retryAfter != null) {
    return Math.min(lastError.retryAfter * 1000, 60_000);
  }
  const base = 500 * 2 ** (attempt - 1); // 500, 1000, 2000 …
  return Math.min(base, 8_000) + Math.random() * 250; // Jitter gegen Thundering Herd
}

// ═══════════════════════════════════════════════════════════════════════════
//  RESOURCES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rejects a chain and wallet type combination the API does not have, before a
 * request goes out.
 *
 * The type system already prevents this for TypeScript callers, but plain
 * JavaScript, a value cast to `any`, or a chain read from configuration at
 * runtime all bypass that. Without this check such a call costs credits and
 * comes back as a 400 from the server. The Python and Rust SDKs validate the
 * same way.
 */
function assertChainType(chain: string, type?: string | null): void {
  if (!(CHAINS as readonly string[]).includes(chain)) {
    throw new BadRequestError(`Unknown blockchain '${chain}'`, {
      code: 'invalid_parameter',
      parameter: 'blockchain',
      allowed: [...CHAINS],
    });
  }
  if (type == null) return;
  const allowed = WALLET_TYPES_BY_CHAIN[chain as Chain];
  if (!(allowed as readonly string[]).includes(type)) {
    throw new BadRequestError(`${chain} supports only: ${allowed.join(', ')}`, {
      code: 'invalid_parameter',
      parameter: 'type',
      allowed: [...allowed],
    });
  }
}

abstract class Resource {
  constructor(protected readonly client: CabalSpy) {}
}

// ── System ────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  components: {
    redis: 'connected' | 'error';
    mysql: 'connected' | 'error';
    websockets: Record<string, Record<string, boolean>>;
  };
  latency_ms: number;
}

export interface MetaResponse {
  chains: Chain[];
  wallet_types: WalletType[];
  periods: Period[];
  currencies: Record<Chain, Currency>;
  wallet_counts: Record<string, Record<string, number>>;
  limits: { max_limit: number; batch_max_mints: number; batch_max_addresses: number };
}

/**
 * /v1/health and /v1/meta.
 * Both respond without the success/data envelope and without auth, so they need
 * their own code path.
 */
export class SystemResource extends Resource {
  private async plain<T>(path: string): Promise<T> {
    try {
      const env = await this.client.getRaw<T>(path);
      return env.data;
    } catch (err) {
      if (err instanceof InvalidResponseError) {
        // health and meta return the object directly, so fetch it unwrapped.
        return (await this.rawFetch<T>(path)) as T;
      }
      throw err;
    }
  }

  private async rawFetch<T>(path: string): Promise<T> {
    const res = await fetch(`${this.client.baseUrl}${path}`);
    if (!res.ok) {
      throw errorFromStatus(res.status, null, { limit: null, remaining: null, reset: null }, null, `HTTP ${res.status} on GET ${path}`);
    }
    return (await res.json()) as T;
  }

  /** GET /v1/health — Redis, MySQL and websocket status per chain and wallet type. */
  health(): Promise<HealthResponse> {
    return this.plain<HealthResponse>('/health');
  }

  /** GET /v1/meta — available chains, types, periods, limits and wallet counts. */
  meta(): Promise<MetaResponse> {
    return this.plain<MetaResponse>('/meta');
  }
}

// ── Wallets ───────────────────────────────────────────────────────────────

export interface ListWalletsParams<C extends Chain = Chain> {
  blockchain: C;
  type: WalletTypeFor<C>;
  /** Omitting limit returns every wallet. */
  limit?: number;
  cursor?: string;
}

export interface WalletHistoryParams {
  blockchain: Chain;
  address: string;
  /** Server default is 500, maximum 1000. */
  limit?: number;
  cursor?: string;
}

export interface LeaderboardParams<C extends Chain = Chain> {
  blockchain: C;
  /** Default: kol */
  type?: WalletTypeFor<C>;
  /** Default: 1d */
  period?: Period;
  /** Omitting limit returns every entry. */
  limit?: number;
  cursor?: string;
}

export interface TrackerParams {
  blockchain: Chain;
  address: string;
  /** Default: 1d */
  period?: Period;
}

export interface AddressParams {
  blockchain: Chain;
  address: string;
}

export type BatchWalletField = 'profile' | 'period_stats' | 'win_rate_distribution' | 'open_positions';

export interface WalletsBatchParams<C extends Chain = Chain> {
  blockchain: C;
  /** Default: kol */
  type?: WalletTypeFor<C>;
  /** Maximum 100. The server truncates anything beyond that. */
  addresses: string[];
  /** Default: ['profile', 'period_stats'] */
  fields?: BatchWalletField[];
  /** Default: 7d */
  period?: Period;
}

export interface WalletLookupResult {
  found: boolean;
  wallet_address: string;
  name?: string;
  image_url?: string;
  twitter?: string;
  telegram?: string;
  blockchain?: Chain;
  type?: WalletType;
  currency?: Currency;
  [key: string]: unknown;
}

export const BATCH_MAX_ADDRESSES = 100;

/**
 * Every wallet endpoint. `type` is bound to the chain through WalletTypeFor<C>,
 * so client.wallets.list({ blockchain: 'eth', type: 'whale' }) is a compile
 * error, because eth only has kol wallets.
 */
export class WalletsResource extends Resource {
  /** GET /v1/wallets — every tracked wallet for one chain and wallet type. */
  list<C extends Chain>(params: ListWalletsParams<C>): Promise<unknown> {
    assertChainType(params.blockchain, params.type);
    return this.client.get('/wallets', { ...params });
  }

  listRaw<C extends Chain>(params: ListWalletsParams<C>): Promise<Envelope<unknown>> {
    assertChainType(params.blockchain, params.type);
    return this.client.getRaw('/wallets', { ...params });
  }

  /** GET /v1/wallets/history — trade history, cursor paginated. */
  history(params: WalletHistoryParams): Promise<unknown> {
    assertChainType(params.blockchain);
    return this.client.get('/wallets/history', { ...params });
  }

  historyRaw(params: WalletHistoryParams): Promise<Envelope<unknown>> {
    assertChainType(params.blockchain);
    return this.client.getRaw('/wallets/history', { ...params });
  }

  /**
   * Follows next_cursor through the entire history and yields pages.
   *
   * This endpoint returns its pagination block inside `data` rather than at the
   * envelope level, unlike every other paginated route. The iterator reads both
   * places, so callers do not have to care.
   */
  async *historyPages(params: WalletHistoryParams, maxPages = 100) {
    let cursor = params.cursor;
    for (let i = 0; i < maxPages; i++) {
      const page = await this.historyRaw({ ...params, cursor });
      const inner = (page.data as { pagination?: Pagination } | null)?.pagination;
      const pagination = page.pagination ?? inner;
      yield { ...page, pagination };
      const next = pagination?.next_cursor;
      if (!pagination?.has_more || !next) return;
      cursor = next;
    }
  }

  /**
   * GET /v1/wallets/lookup — searches an address across every chain and wallet
   * type. Deliberately takes no blockchain argument.
   */
  lookup(address: string): Promise<WalletLookupResult> {
    return this.client.get<WalletLookupResult>('/wallets/lookup', { address });
  }

  /** GET /v1/wallets/leaderboard — ranking for the given period. */
  leaderboard<C extends Chain>(params: LeaderboardParams<C>): Promise<unknown> {
    assertChainType(params.blockchain, params.type);
    return this.client.get('/wallets/leaderboard', { ...params });
  }

  leaderboardRaw<C extends Chain>(params: LeaderboardParams<C>): Promise<Envelope<unknown>> {
    assertChainType(params.blockchain, params.type);
    return this.client.getRaw('/wallets/leaderboard', { ...params });
  }

  /** GET /v1/wallets/tracker — period stats and open positions for one wallet. */
  tracker(params: TrackerParams): Promise<WalletTrackerResponse> {
    assertChainType(params.blockchain);
    return this.client.get<WalletTrackerResponse>('/wallets/tracker', { ...params });
  }

  /** GET /v1/wallets/holdings — current onchain holdings, independent of period. */
  holdings(params: AddressParams): Promise<{ active_holdings: unknown }> {
    assertChainType(params.blockchain);
    return this.client.get('/wallets/holdings', { ...params });
  }

  /**
   * GET /v1/wallet/pnl_calendar — daily PNL calendar.
   * Note: this endpoint only exists under /wallet/, singular.
   */
  pnlCalendar(params: AddressParams): Promise<unknown> {
    assertChainType(params.blockchain);
    return this.client.get('/wallet/pnl_calendar', { ...params });
  }

  /** GET /v1/wallets/connections — wallets whose traded tokens overlap, 30d window. */
  connections(params: AddressParams & { limit?: number }): Promise<unknown> {
    assertChainType(params.blockchain);
    return this.client.get('/wallets/connections', { ...params });
  }

  /** POST /v1/wallets/batch — up to 100 addresses in a single request. */
  batch<C extends Chain>(params: WalletsBatchParams<C>): Promise<Record<string, unknown>> {
    assertChainType(params.blockchain, params.type);
    if (params.addresses.length === 0) {
      throw new BadRequestError('addresses must not be empty', {
        code: 'missing_parameter',
        parameter: 'addresses',
      });
    }
    if (params.addresses.length > BATCH_MAX_ADDRESSES) {
      throw new BadRequestError(
        `At most ${BATCH_MAX_ADDRESSES} addresses per request, received ${params.addresses.length}`,
        { code: 'invalid_parameter', parameter: 'addresses' },
      );
    }
    return this.client.post('/wallets/batch', params);
  }
}

// ── Tokens ────────────────────────────────────────────────────────────────

export interface TokenParams<C extends Chain = Chain> {
  blockchain: C;
  mint: string;
  /** Optional. Omitting it merges every wallet type of that chain. */
  type?: WalletTypeFor<C>;
}

export type TokenBatchField =
  | 'token'
  | 'total_holders'
  | 'total_holdings'
  | 'total_statistics'
  | 'traders';

export interface TokensBatchParams<C extends Chain = Chain> {
  blockchain: C;
  type: WalletTypeFor<C>;
  /** Maximum 100. The server truncates anything beyond that. */
  mints: string[];
  /** Default: everything except traders. */
  fields?: TokenBatchField[];
}

export const BATCH_MAX_MINTS = 100;

export class TokensResource extends Resource {
  /** GET /v1/tokens/transactions — trades by tracked wallets in this token. */
  transactions<C extends Chain>(params: TokenParams<C> & { limit?: number }): Promise<unknown> {
    assertChainType(params.blockchain, params.type);
    return this.client.get('/tokens/transactions', { ...params });
  }

  transactionsRaw<C extends Chain>(params: TokenParams<C> & { limit?: number }): Promise<Envelope<unknown>> {
    assertChainType(params.blockchain, params.type);
    return this.client.getRaw('/tokens/transactions', { ...params });
  }

  /**
   * GET /v1/tokens/stats — aggregated token statistics.
   *
   * Note: this endpoint does not pass the native price into its market cap
   * builder, so market_cap_usd, price_usd and sol_price_usd come back null even
   * on Solana. tokens/holders returns them populated.
   */
  stats<C extends Chain>(params: TokenParams<C>): Promise<TokenStatsResponse> {
    assertChainType(params.blockchain, params.type);
    return this.client.get<TokenStatsResponse>('/tokens/stats', { ...params });
  }

  /** GET /v1/tokens/holders — tracked holders, sorted by balance. */
  holders<C extends Chain>(params: TokenParams<C> & { limit?: number }): Promise<unknown> {
    assertChainType(params.blockchain, params.type);
    return this.client.get('/tokens/holders', { ...params });
  }

  /** POST /v1/tokens/batch — up to 100 mints in a single request. */
  batch<C extends Chain>(params: TokensBatchParams<C>): Promise<Record<string, unknown>> {
    assertChainType(params.blockchain, params.type);
    if (params.mints.length === 0) {
      throw new BadRequestError('mints must not be empty', {
        code: 'missing_parameter',
        parameter: 'mints',
      });
    }
    if (params.mints.length > BATCH_MAX_MINTS) {
      throw new BadRequestError(
        `At most ${BATCH_MAX_MINTS} mints per request, received ${params.mints.length}`,
        { code: 'invalid_parameter', parameter: 'mints' },
      );
    }
    return this.client.post('/tokens/batch', params);
  }
}

// ── Transactions / Feed ───────────────────────────────────────────────────

export interface FeedBaseParams<C extends Chain = Chain> {
  blockchain: C;
  type: WalletTypeFor<C>;
  /** Restrict to transactions in this token only. */
  mint?: string;
}

/** Time window. seconds, minutes and hours are clamped server side. */
export interface TimeWindow {
  seconds?: number;
  minutes?: number;
  hours?: number;
}

export interface CountResult {
  blockchain: Chain;
  type: WalletType;
  mode: 'count';
  count: number;
  wallet_count: number;
  time_window_seconds: number;
  mint?: string;
  warnings?: string[];
}

export interface VolumeResult {
  blockchain: Chain;
  type: WalletType;
  mode: 'volume';
  volume: number;
  volume_usd: number | null;
  currency: Currency;
  time_window_seconds: number;
  mint?: string;
  warnings?: string[];
}

/** Maximum time windows accepted by the server. */
export const TIMERANGE_MAX_SECONDS = 60 * 60;
export const VOLUME_MAX_SECONDS = 24 * 60 * 60;

export class TransactionsResource extends Resource {
  /** GET /v1/transactions/latest — most recent trades by tracked wallets. */
  latest<C extends Chain>(params: FeedBaseParams<C> & { limit?: number }): Promise<TransactionsListResponse> {
    assertChainType(params.blockchain, params.type);
    return this.client.get<TransactionsListResponse>('/transactions/latest', { ...params });
  }

  latestRaw<C extends Chain>(params: FeedBaseParams<C> & { limit?: number }): Promise<Envelope<unknown>> {
    assertChainType(params.blockchain, params.type);
    return this.client.getRaw('/transactions/latest', { ...params });
  }

  /** GET /v1/transactions/timerange — trades in the last N, up to 60 minutes. */
  timerange<C extends Chain>(params: FeedBaseParams<C> & TimeWindow & { limit?: number }): Promise<TransactionsListResponse> {
    assertChainType(params.blockchain, params.type);
    return this.client.get<TransactionsListResponse>('/transactions/timerange', { ...params });
  }

  /** GET /v1/transactions/count — trade count and unique wallets, up to 24 hours. */
  count<C extends Chain>(params: FeedBaseParams<C> & TimeWindow): Promise<CountResult> {
    assertChainType(params.blockchain, params.type);
    return this.client.get<CountResult>('/transactions/count', { ...params });
  }

  /** GET /v1/transactions/volume — volume in native currency and USD, up to 24 hours. */
  volume<C extends Chain>(params: FeedBaseParams<C> & TimeWindow): Promise<VolumeResult> {
    assertChainType(params.blockchain, params.type);
    return this.client.get<VolumeResult>('/transactions/volume', { ...params });
  }

  /**
   * GET /v1/feed — legacy alias taking mode as a query parameter.
   * @deprecated Use latest, timerange, count or volume instead.
   */
  feed<C extends Chain>(
    params: FeedBaseParams<C> & TimeWindow & { mode: 'latest' | 'timerange' | 'count' | 'volume'; limit?: number },
  ): Promise<unknown> {
    assertChainType(params.blockchain, params.type);
    return this.client.get('/feed', { ...params });
  }
}

// ── Signals ───────────────────────────────────────────────────────────────

export type SignalMode = 'cluster' | 'entry' | 'exit';

export interface SignalsParams<C extends Chain = Chain> {
  blockchain: C;
  type: WalletTypeFor<C>;
  mode: SignalMode;
  limit?: number;
  /** Default 3. Minimum number of buying wallets to count as a cluster. */
  min_wallets?: number;
  /** Default 0. Minimum buy value in native currency. */
  min_value?: number;
  /** Default 1. Observation window in hours. */
  hours?: number;
}

/**
 * Optional gated filters. Setting any one of these switches the server into
 * gated mode, which applies an AND gate across wallet types.
 */
export interface SignalGatedFilters {
  /** Entry thresholds for kol as CSV, for example "3,5,10". */
  kol?: string;
  smart?: string;
  kol_min_buy?: number;
  kol_max_buy?: number;
  /** Exit thresholds as remaining holders, CSV in descending order. */
  kol_exit?: string;
  smart_min_buy?: number;
  smart_max_buy?: number;
  smart_exit?: string;
  /** Comma separated list of wallet addresses. */
  include_wallets?: string;
  exclude_wallets?: string;
  /** Between 0 and 100. */
  min_win_rate?: number;
  /** Token age in hours. */
  min_token_age?: number;
  max_token_age?: number;
}

export interface SignalsHistoryParams<C extends Chain = Chain> {
  blockchain: C;
  type: WalletTypeFor<C>;
  /** Default: 200 */
  limit?: number;
  /** Default: 30 */
  days?: 7 | 30 | 90 | 'all';
  mode?: SignalMode;
}

export class SignalsResource extends Resource {
  /**
   * GET /v1/signals — live clusters, entries and exits.
   * smart is unavailable on eth, which has no smart money feed.
   */
  list<C extends Chain>(params: SignalsParams<C> & SignalGatedFilters): Promise<SignalsResponse<ClusterSignal>> {
    assertChainType(params.blockchain, params.type);
    return this.client.get<SignalsResponse<ClusterSignal>>('/signals', { ...params } as Query);
  }

  listRaw<C extends Chain>(params: SignalsParams<C> & SignalGatedFilters): Promise<Envelope<unknown>> {
    assertChainType(params.blockchain, params.type);
    return this.client.getRaw('/signals', { ...params } as Query);
  }

  /** GET /v1/signals/history — backtest over 7, 30 or 90 days, or 'all'. */
  history<C extends Chain>(params: SignalsHistoryParams<C> & SignalGatedFilters): Promise<unknown> {
    assertChainType(params.blockchain, params.type);
    return this.client.get('/signals/history', { ...params } as Query);
  }

  historyRaw<C extends Chain>(params: SignalsHistoryParams<C> & SignalGatedFilters): Promise<Envelope<unknown>> {
    assertChainType(params.blockchain, params.type);
    return this.client.getRaw('/signals/history', { ...params } as Query);
  }
}

// ── Analytics ─────────────────────────────────────────────────────────────

export type AnalyticsMode = 'volume_trend' | 'most_traded' | 'win_rate' | 'top_performers';

export interface AnalyticsParams<C extends Chain = Chain> {
  blockchain: C;
  type: WalletTypeFor<C>;
  mode: AnalyticsMode;
  /** Default: 7d */
  period?: Period;
  limit?: number;
}

export class AnalyticsResource extends Resource {
  /** GET /v1/analytics — four modes, available on every chain. */
  get<C extends Chain>(params: AnalyticsParams<C>): Promise<unknown> {
    assertChainType(params.blockchain, params.type);
    return this.client.get('/analytics', { ...params });
  }

  getRaw<C extends Chain>(params: AnalyticsParams<C>): Promise<Envelope<unknown>> {
    assertChainType(params.blockchain, params.type);
    return this.client.getRaw('/analytics', { ...params });
  }
}

// ── Bundle ────────────────────────────────────────────────────────────────

export interface BundleTokenBlock {
  mint: string;
  symbol: string;
  name: string;
  supply: number | null;
  market_cap: number | null;
  market_cap_usd: number | null;
  market_cap_currency: 'SOL' | null;
  price: number | null;
  price_usd: number | null;
  sol_price_usd: number | null;
  pool: string | null;
  on_curve: boolean | null;
  bonding_curve_progress: number | null;
}

export interface BundlePosition {
  held: number;
  peak: number;
  bought_tokens: number;
  sold_tokens: number;
  bag_pct: number | null;
  supply_pct: number | null;
  invested: number;
  invested_usd: number | null;
  max_single_buy: number;
  buy_txn: number;
  sell_txn: number;
  sold_value: number;
  sold_value_usd: number | null;
  realized_pnl_sol: number;
  realized_pnl_usd: number | null;
  entry_market_cap: number | null;
  entry_market_cap_usd: number | null;
  unrealized_pnl_sol: number | null;
  unrealized_pnl_usd: number | null;
  unrealized_pnl_pct: number | null;
  remaining_sol: number | null;
  remaining_usd: number | null;
  first_buy_at: string | null;
  last_activity_at: string | null;
}

export interface BundleProfile {
  name: string;
  image_url: string;
  twitter: string;
  telegram: string;
  blockchain: 'solana';
  currency: 'SOL';
  type: 'kol' | null;
}

export interface BundleWallet {
  address: string;
  is_kol: boolean;
  transaction_type: 'buy' | 'sell';
  signature: string | null;
  entry_source: string | null;
  position_source: 'live';
  profile: BundleProfile;
  position: BundlePosition;
  /** Present on side wallets only, never on the KOL wallet itself. */
  fee_lamports?: number | null;
  block_index?: number | null;
  adjacent_to_kol?: boolean | null;
  same_fee?: boolean | null;
  occurrences?: number | null;
}

export interface BundleEntry {
  bundle_id: string | null;
  kol_wallet: string | null;
  kol_profile: BundleProfile | null;
  confidence: number | null;
  jito_confirmed: boolean | null;
  proof_type: string | null;
  slot: number | null;
  wallet_count: number;
  proof: unknown;
  verify_hint: unknown;
  detected_at: string | null;
  bundle_wallets: BundleWallet[];
}

export interface BundleResponse {
  blockchain: 'solana';
  token: BundleTokenBlock;
  bundles: BundleEntry[];
}

/**
 * GET /v1/bundle — snapshot of the bundle stream.
 * Solana only. Other chains are rejected with 400 invalid_parameter.
 */
export class BundleResource extends Resource {
  get(params: { mint: string; blockchain?: 'solana' }): Promise<BundleResponse> {
    return this.client.get<BundleResponse>('/bundle', {
      blockchain: params.blockchain ?? 'solana',
      mint: params.mint,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  REALTIME (WEBSOCKET GATEWAY)
// ═══════════════════════════════════════════════════════════════════════════

export type StreamName = 'tx' | 'count' | 'signal' | 'bundle' | 'holder' | 'balance';

export interface GatewayEnvelope<T = unknown> {
  success: boolean;
  channel: string;
  event: string;
  data: T;
  meta?: { request_id?: string; version?: string; timestamp?: string };
}

export interface GatewayAck {
  success: boolean;
  type: string;
  stream?: StreamName;
  channel?: string;
  filters?: unknown;
  warnings?: string[];
  message?: string;
  subscriptions?: string[];
}

/**
 * tx: trades by tracked wallets. Event: position_update
 *
 * Unlike the REST endpoints, these events carry market cap and unrealized PNL
 * on every chain, not just Solana.
 */
export interface TxSubscription<C extends Chain = Chain> {
  stream: 'tx';
  blockchain: C;
  type: WalletTypeFor<C>;
  /** Mint or contract address, or '*' for all. Default: '*' */
  token?: string;
}

/** count: number of buying wallets per token. Event: wallet_count */
export interface CountSubscription {
  stream: 'count';
  blockchain: Chain;
  token?: string;
}

/** Filter block for one wallet type on the signal stream. */
export interface SignalTypeBlock {
  /** Minimum buy value per wallet in native currency. */
  min_buy?: number;
  /** Upper bound per wallet. */
  max_wallet_buy?: number;
  /** Entry thresholds, up to 3 values, for example [3, 5, 10]. */
  entry_at?: number[];
  /** Exit thresholds as remaining holders, up to 2 values, descending. */
  exit_at?: number[];
}

/** signal: cluster, entry and exit signals. Event: signal */
export interface SignalSubscription {
  stream: 'signal';
  blockchain: Chain;
  token?: string;
  kol?: SignalTypeBlock;
  /** Unavailable on eth. The server rejects the subscription. */
  smart?: SignalTypeBlock;
  include_wallets?: string[];
  exclude_wallets?: string[];
  min_win_rate?: number;
}

/** bundle: KOL bundles. Events: init, kol_bundle. Solana only. */
export interface BundleSubscription {
  stream: 'bundle';
  blockchain?: 'solana';
  token?: string;
  /** events sends real detections only, full adds market cap driven updates. */
  mode?: 'events' | 'full';
  /** Between 1 and 30. Throttles market cap updates when mode is 'full'. */
  mc_interval?: number;
}

/** holder: holder balances for a token. Events: init, holder_update, position_update */
export interface HolderSubscription<C extends Chain = Chain> {
  stream: 'holder';
  blockchain: C;
  token?: string;
  /** Default: every wallet type of that chain. */
  wallet_types?: WalletTypeFor<C>[];
}

/** balance: native balance of a wallet. Events: init, balance_update */
export interface BalanceSubscription<C extends Chain = Chain> {
  stream: 'balance';
  blockchain: C;
  wallet: string;
  wallet_types?: WalletTypeFor<C>[];
}

/**
 * Distributed across every chain so the chain/type pairing is enforced inside
 * subscribe() too. Without the mapped type, WalletTypeFor<Chain> would collapse
 * into the union of all types and { blockchain: 'base', type: 'whale' } would
 * be accepted.
 */
export type Subscription =
  | { [C in Chain]: TxSubscription<C> }[Chain]
  | CountSubscription
  | SignalSubscription
  | BundleSubscription
  | { [C in Chain]: HolderSubscription<C> }[Chain]
  | { [C in Chain]: BalanceSubscription<C> }[Chain];

export interface RealtimeOptions {
  /** Reconnect automatically. Default: true */
  reconnect?: boolean;
  /** Initial delay in ms, doubling up to maxReconnectDelay. Default: 1000 */
  reconnectDelay?: number;
  /** Default: 30_000 */
  maxReconnectDelay?: number;
  /** Ping interval in ms, 0 disables it. Default: 25_000 */
  pingInterval?: number;
  /** WebSocket implementation. On Node < 22, pass the `ws` package. */
  WebSocketImpl?: unknown;
}

type Handler<T> = (payload: T) => void;

interface MinimalWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

/**
 * Realtime client for the gateway.
 *
 *   const rt = client.realtime();
 *   rt.on('position_update', tx => console.log(tx));
 *   await rt.connect();
 *   rt.subscribe({ stream: 'tx', blockchain: 'solana', type: 'kol' });
 *
 * Subscriptions are remembered and re-sent automatically after a reconnect.
 */
export class CabalSpyRealtime {
  private ws: MinimalWebSocket | null = null;
  private readonly opts: Required<Omit<RealtimeOptions, 'WebSocketImpl'>> & { WebSocketImpl?: unknown };
  private readonly subs = new Map<string, Subscription>();
  private readonly handlers = new Map<string, Set<Handler<never>>>();
  private reconnectAttempt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedByUser = false;

  constructor(
    private readonly wsUrl: string,
    private readonly apiKey: string,
    options: RealtimeOptions = {},
  ) {
    this.opts = {
      reconnect: options.reconnect ?? true,
      reconnectDelay: options.reconnectDelay ?? 1_000,
      maxReconnectDelay: options.maxReconnectDelay ?? 30_000,
      pingInterval: options.pingInterval ?? 25_000,
      WebSocketImpl: options.WebSocketImpl,
    };
  }

  /**
   * Registers an event handler. Gateway events:
   *   position_update | wallet_count | signal | kol_bundle | holder_update |
   *   balance_update | init
   * SDK events: 'open' | 'close' | 'error' | 'ack' | 'message'
   */
  on<T = unknown>(event: string, handler: Handler<T>): this {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return this;
  }

  off(event: string, handler: Handler<never>): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  private emit(event: string, payload: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) {
      try {
        (h as Handler<unknown>)(payload);
      } catch (err) {
        // A throwing handler must not take down the connection.
        if (event !== 'error') this.emit('error', err);
      }
    }
  }

  /** Connects and resolves once the gateway has sent 'connected'. */
  connect(): Promise<void> {
    this.closedByUser = false;
    const WS = (this.opts.WebSocketImpl ?? (globalThis as { WebSocket?: unknown }).WebSocket) as
      | (new (url: string) => MinimalWebSocket)
      | undefined;
    if (!WS) {
      return Promise.reject(
        new ConnectionError(
          'No WebSocket implementation found. On Node < 22, run `npm i ws` and pass { WebSocketImpl: WebSocket }.',
          { code: 'no_websocket' },
        ),
      );
    }

    const url = `${this.wsUrl}/?apiKey=${encodeURIComponent(this.apiKey)}`;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WS(url);
      this.ws = ws;

      ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.startPing();
        this.emit('open', undefined);
        // Restore subscriptions after a reconnect.
        for (const sub of this.subs.values()) this.send({ op: 'subscribe', ...sub });
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        this.emit('message', msg);

        const event = typeof msg.event === 'string' ? msg.event : null;
        const type = typeof msg.type === 'string' ? msg.type : null;

        if (event) {
          this.emit(event, msg);
          return;
        }
        if (type === 'subscribed' || type === 'unsubscribed' || type === 'connected') {
          this.emit('ack', msg as unknown as GatewayAck);
          return;
        }
        if (type === 'error' || msg.success === false) {
          this.emit(
            'error',
            new CabalSpyError(String(msg.message ?? 'Gateway error'), { code: 'gateway_error' }),
          );
        }
      };

      ws.onerror = (ev) => {
        const err = new ConnectionError(`WebSocket error connecting to ${this.wsUrl}: ${describeWsEvent(ev)}`, {
          code: 'ws_error',
        });
        this.emit('error', err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      ws.onclose = (ev) => {
        this.stopPing();
        this.emit('close', ev);
        // Closing before the handshake completed usually means the server
        // rejected us. The close code says why, so surface it instead of
        // hanging on an unresolved promise.
        if (!settled) {
          settled = true;
          const e = ev as { code?: number; reason?: string };
          reject(
            new ConnectionError(
              `WebSocket closed before it opened (code ${e?.code ?? 'unknown'}${e?.reason ? `, ${e.reason}` : ''}). ` +
                `Code 1008 means the API key was rejected; 1006 usually means nothing is listening at ${this.wsUrl}.`,
              { code: 'ws_closed_early' },
            ),
          );
          return;
        }
        if (!this.closedByUser && this.opts.reconnect) this.scheduleReconnect();
      };
    });
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      this.opts.reconnectDelay * 2 ** this.reconnectAttempt,
      this.opts.maxReconnectDelay,
    );
    this.reconnectAttempt++;
    setTimeout(() => {
      if (this.closedByUser) return;
      this.connect().catch((err) => this.emit('error', err));
    }, delay + Math.random() * 250);
  }

  private startPing(): void {
    if (!this.opts.pingInterval) return;
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ op: 'ping' }), this.opts.pingInterval);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(payload));
  }

  private static key(sub: Subscription): string {
    const s = sub as unknown as Record<string, unknown>;
    const chain = s.blockchain ?? 'solana';
    const target = s.token ?? s.wallet ?? '*';
    const type = s.type ?? (Array.isArray(s.wallet_types) ? s.wallet_types.join('+') : '');
    return `${sub.stream}:${chain}:${type}:${target}`;
  }

  /** Subscribes to a channel. Re-sent automatically after a reconnect. */
  subscribe(sub: Subscription): this {
    validateSubscription(sub);
    // bundle is Solana only, so send it explicitly rather than relying on
    // the server default.
    const normalized: Subscription =
      sub.stream === 'bundle' ? ({ ...sub, blockchain: 'solana' } as Subscription) : sub;
    this.subs.set(CabalSpyRealtime.key(normalized), normalized);
    this.send({ op: 'subscribe', ...normalized });
    return this;
  }

  /** Channel shorthand, for example 'tx.solana.kol.*' or 'bundle.solana.<MINT>'. */
  subscribeChannel(channel: string): this {
    this.send({ op: 'subscribe', channel });
    return this;
  }

  unsubscribe(sub: Subscription): this {
    this.subs.delete(CabalSpyRealtime.key(sub));
    this.send({ op: 'unsubscribe', ...sub });
    return this;
  }

  /** Asks the server for its list of subscriptions. The reply arrives as 'ack'. */
  listSubscriptions(): this {
    this.send({ op: 'subscriptions' });
    return this;
  }

  /** Closes the connection and disables reconnecting. */
  close(): void {
    this.closedByUser = true;
    this.stopPing();
    this.ws?.close(1000, 'client closed');
    this.ws = null;
  }
}

/** Pulls whatever detail the runtime attached to a websocket error event. */
function describeWsEvent(ev: unknown): string {
  if (!ev || typeof ev !== 'object') return 'no detail available';
  const e = ev as { message?: string; error?: { message?: string; code?: string }; type?: string };
  return (
    e.error?.message ??
    e.message ??
    (e.error?.code ? `errno ${e.error.code}` : undefined) ??
    e.type ??
    'no detail available'
  );
}

function validateSubscription(sub: Subscription): void {
  const s = sub as unknown as Record<string, unknown>;

  if (sub.stream === 'bundle') {
    const chain = (s.blockchain as string) ?? 'solana';
    if (chain !== 'solana') {
      throw new BadRequestError('The bundle stream is currently available for solana only', {
        code: 'invalid_parameter',
        parameter: 'blockchain',
        allowed: ['solana'],
      });
    }
    const interval = s.mc_interval as number | undefined;
    if (interval !== undefined && (interval < 1 || interval > 30)) {
      throw new BadRequestError('mc_interval must be between 1 and 30', {
        code: 'invalid_parameter',
        parameter: 'mc_interval',
      });
    }
    return;
  }

  const chain = s.blockchain as Chain | undefined;
  if (!chain) {
    throw new BadRequestError(`Stream '${sub.stream}' requires blockchain`, {
      code: 'missing_parameter',
      parameter: 'blockchain',
      allowed: [...CHAINS],
    });
  }
  if (!(CHAINS as readonly string[]).includes(chain)) {
    throw new BadRequestError(`Unknown blockchain '${chain}'`, {
      code: 'invalid_parameter',
      parameter: 'blockchain',
      allowed: [...CHAINS],
    });
  }

  if (sub.stream === 'tx') {
    const type = s.type as string;
    if (!walletTypeIsValid(chain, type)) {
      throw new BadRequestError(`${chain} supports only: ${WALLET_TYPES_BY_CHAIN[chain].join(', ')}`, {
        code: 'invalid_parameter',
        parameter: 'type',
        allowed: [...WALLET_TYPES_BY_CHAIN[chain]],
      });
    }
  }

  if (sub.stream === 'signal' && s.smart && chain === 'eth') {
    throw new BadRequestError('Smart money signals are not available on eth, kol only', {
      code: 'invalid_parameter',
      parameter: 'smart',
    });
  }

  if (sub.stream === 'balance' && !s.wallet) {
    throw new BadRequestError("Stream 'balance' requires wallet", {
      code: 'missing_parameter',
      parameter: 'wallet',
    });
  }
}

export * from './types';
import type {
  WalletTrackerResponse, TokenStatsResponse, SignalsResponse, ClusterSignal,
  TransactionsListResponse,
} from './types';

export default CabalSpy;
