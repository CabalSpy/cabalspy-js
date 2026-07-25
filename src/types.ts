/**
 * Response types for the CabalSpy API.
 *
 * Derived from live responses and from the server source. Where a field is only
 * observed on one chain or one endpoint, that is noted on the field.
 *
 * Two conventions worth knowing before reading further:
 *
 * 1. Timestamps inside `data` are NOT ISO 8601. They come back as
 *    "YYYY-MM-DD HH:MM:SS" with no timezone marker, which `new Date()` parses as
 *    LOCAL time, not UTC. Only `meta.timestamp` is proper ISO with a Z suffix.
 *    Use `parseApiDate()` from this SDK rather than `new Date()`.
 *
 * 2. `realized_pnl` is computed as `total_sell - total_buy`. A wallet that has
 *    bought and not yet sold therefore reports its full investment as a loss and
 *    `realized_pnl_percentage: -100`. Treat it as net flow, not as realised
 *    profit, and check `still_holding` before showing it to a user.
 */

import type { Chain, Currency, WalletType } from './index';

/** Parses the "YYYY-MM-DD HH:MM:SS" timestamps the API returns inside `data`, as UTC. */
export function parseApiDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SHARED
// ═══════════════════════════════════════════════════════════════════════════

/** Wallet profile. Single source is build_profile() on the server. */
export interface WalletProfile {
  wallet_address: string;
  name: string;
  image_url: string;
  /** Full URL, or an empty string when unset. Never null. */
  twitter: string;
  telegram: string;
  copytrade_link: string;
  type: WalletType;
  blockchain: Chain;
  currency: Currency;
  /** Only present on some endpoints, e.g. wallets/tracker. */
  active_hours?: string;
}

/**
 * Token block as returned by tokens/stats, tokens/holders and tokens/transactions.
 *
 * The USD fields are populated only where the endpoint passes the native price
 * into the market cap builder. As of writing, tokens/holders does; tokens/stats
 * and tokens/transactions do not, so `market_cap_usd`, `price_usd` and
 * `sol_price_usd` come back null there even on Solana.
 */
export interface TokenBlock {
  blockchain: Chain;
  currency: Currency;
  mint: string;
  token_name: string;
  token_supply: number;
  token_decimals: number;
  /** Native currency. Solana only on REST; null on other chains. */
  market_cap: number | null;
  market_cap_usd: number | null;
  market_cap_currency: Currency | null;
  price: number | null;
  price_usd: number | null;
  sol_price_usd: number | null;
  pool?: string | null;
  on_curve?: boolean | null;
  bonding_curve_progress?: number | null;
}

/** Token block on the signals endpoint. Carries no market cap at all. */
export interface SignalTokenBlock {
  blockchain: Chain;
  currency: Currency;
  mint: string;
  token_name: string;
  token_supply: number;
  token_decimals: number;
}

/** Holdings snapshot attached to a feed transaction. */
export interface HoldingsAfter {
  token_amount: number;
  token_amount_peak: number;
  supply_pct: number;
  supply_pct_peak: number;
  bag_pct: number;
  still_holding: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  GET /v1/wallets/tracker
// ═══════════════════════════════════════════════════════════════════════════

export interface PeriodStats {
  period: string;
  buy_txn: number;
  sell_txn: number;
  total_buy: number;
  total_buy_usd: number;
  total_sell: number;
  total_sell_usd: number;
  volume: number;
  volume_usd: number;
  realized_pnl: number;
  realized_pnl_usd: number;
  realized_pnl_percentage: number;
  win_count: number;
  loss_count: number;
  best_trade_pnl: number;
  worst_trade_pnl: number;
  largest_buy: number;
  avg_hold_time_minutes: number;
}

export interface WinRateDistribution {
  below_zero: number;
  above_zero_to_100: number;
  above_100_to_500: number;
  above_500: number;
  closed_count: number;
  win_count: number;
  win_rate_percentage: number;
}

/** Summary object, not a list — despite the plural name. */
export interface ActiveTokensSummary {
  active_tokens_count: number;
  still_holding_count: number;
  avg_position_size: number;
}

export interface WalletTrackerResponse {
  wallet: string;
  profile: WalletProfile;
  period_stats: PeriodStats;
  period_active_tokens: ActiveTokensSummary;
  period_win_rate_distribution: WinRateDistribution;
  /** Empty for wallets with no activity in the period. */
  period_history_tokens: unknown[];
  period_realized_pnl_chart: unknown[];
  period_trades: unknown[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  GET /v1/tokens/stats
// ═══════════════════════════════════════════════════════════════════════════

export interface TotalHolders {
  kol_count: number;
  smart_count: number;
  whale_count: number;
  still_holding_count: number;
}

export interface TotalHoldings {
  token_amount: number;
  token_amount_peak: number;
  supply_pct: number;
  supply_pct_peak: number;
}

export interface TokenTotalStatistics {
  total_buy: number;
  total_buy_usd: number;
  total_sell: number;
  total_sell_usd: number;
  total_volume: number;
  total_volume_usd: number;
  net_flow: number;
  net_flow_usd: number;
  /** Share of volume that was buying, 0..1. */
  buying_pressure: number;
  avg_position_size: number;
  largest_position: number;
  /** "YYYY-MM-DD HH:MM:SS", UTC without a marker. Use parseApiDate(). */
  first_entry_time: string;
  first_entry_type: WalletType;
  first_entry_wallet_address: string;
  latest_entry_time: string;
  latest_entry_type: WalletType;
  latest_entry_wallet_address: string;
  time_since_first_entry_hours: number;
}

export interface TraderHoldings {
  token_amount: number;
  token_amount_peak: number;
  supply_pct: number;
  supply_pct_peak: number;
  bag_pct: number;
  still_holding: boolean;
  /** Frozen at first buy, never recomputed. Null when it was not captured. */
  entry_market_cap: number | null;
  entry_market_cap_usd: number | null;
  unrealized_pnl_sol: number | null;
  unrealized_pnl_usd: number | null;
  unrealized_pnl_pct: number | null;
  remaining_sol: number | null;
  remaining_usd: number | null;
}

export interface TraderStats {
  buy: number;
  buy_usd: number;
  buy_count: number;
  buy_tokens: number;
  sell: number;
  sell_usd: number;
  sell_count: number;
  sell_tokens: number;
  volume_buy: number;
  volume_buy_usd: number;
  volume_sell: number;
  volume_sell_usd: number;
  avg_buy_price: number;
  /** total_sell - total_buy. See the note at the top of this file. */
  realized_pnl: number;
  realized_pnl_usd: number;
  realized_pnl_percentage: number;
  first_trade_at: string;
  last_trade_at: string;
}

export interface TokenTrader {
  profile: WalletProfile;
  trader_holdings: TraderHoldings;
  trader_stats: TraderStats;
}

export interface TokenStatsResponse {
  token: TokenBlock;
  total_holders: TotalHolders;
  total_holdings: TotalHoldings;
  total_statistics: TokenTotalStatistics;
  /** Omitted when `fields` excludes it, which is the default on tokens/batch. */
  traders?: TokenTrader[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  GET /v1/signals
// ═══════════════════════════════════════════════════════════════════════════

export interface SignalTokenStats {
  total_buyers: number;
  active_count: number;
  exited_count: number;
  still_holding_count: number;
  holders_by_type: { kol_count: number; smart_count: number; whale_count: number };
  total_buy: number;
  total_buy_usd: number;
  total_buy_txn: number;
  total_sell: number;
  total_sell_usd: number;
  total_sell_txn: number;
  total_volume: number;
  total_volume_usd: number;
  total_txn: number;
  net_flow: number;
  net_flow_usd: number;
  buying_pressure: number;
  supply_pct_held: number;
  supply_pct_held_peak: number;
  first_entry_time: string;
  latest_entry_time: string;
}

/** One wallet inside a cluster signal. window_* fields cover the query window only. */
export interface SignalWallet {
  profile: WalletProfile;
  bought_at: string;
  is_active: boolean;
  still_holding: boolean;
  buy_txn: number;
  sell_txn: number;
  buy_tokens: number;
  sell_tokens: number;
  held_tokens: number;
  held_tokens_peak: number;
  bag_pct: number;
  supply_pct: number;
  supply_pct_peak: number;
  total_buy: number;
  total_buy_usd: number;
  total_sell: number;
  total_sell_usd: number;
  /** total_sell - total_buy. See the note at the top of this file. */
  realized_pnl: number;
  realized_pnl_usd: number;
  realized_pnl_percentage: number;
  window_buy_txn: number;
  window_invested: number;
  window_invested_usd: number;
  window_tokens_bought: number;
}

export interface SignalWindow {
  hours: number;
  wallet_count: number;
  first_buy_at: string;
  latest_buy_at: string;
  time_span_minutes: number;
  total_invested: number;
  total_invested_usd: number;
  avg_invested: number;
  avg_invested_usd: number;
  total_tokens_bought: number;
  supply_pct_bought: number;
}

export interface ClusterSignal {
  signal_type: 'cluster';
  signal_strength: 'strong' | 'medium' | 'weak' | string;
  currency: Currency;
  token: SignalTokenBlock;
  token_stats: SignalTokenStats;
  wallets: SignalWallet[];
  window: SignalWindow;
}

export interface SignalsResponse<S = ClusterSignal> {
  blockchain: Chain;
  type: WalletType;
  currency: Currency;
  mode: 'cluster' | 'entry' | 'exit';
  /** Total before the limit was applied. Mirrors pagination.total. */
  _total: number;
  signals: S[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  GET /v1/transactions/*
// ═══════════════════════════════════════════════════════════════════════════

export interface FeedTransaction {
  tx_signature: string;
  mint: string;
  token_name: string;
  token_supply: number | null;
  token_decimals: number | null;
  transaction_type: 'buy' | 'sell';
  value: number;
  value_usd: number | null;
  currency: Currency;
  token_amount: number | null;
  price_per_token: number | null;
  price_per_token_usd: number | null;
  created_at: string;
  profile: WalletProfile;
  holdings_after: HoldingsAfter;
}

export interface TransactionsListResponse {
  blockchain: Chain;
  type: WalletType;
  mode: 'latest' | 'timerange';
  currency: Currency;
  count: number;
  transactions: FeedTransaction[];
  time_window_seconds?: number;
  /** Present when a requested limit or window was capped. */
  warnings?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  WEBSOCKET EVENTS
// ═══════════════════════════════════════════════════════════════════════════

export interface GatewayMeta {
  request_id: string;
  version: string;
  /** Proper ISO 8601 with Z, unlike the timestamps inside REST payloads. */
  timestamp: string;
  retry?: true;
}

/**
 * IMPORTANT: `position_update` is emitted on two different channels with two
 * completely different payloads.
 *
 *   channel "tx.<chain>.<type>"  → TxPositionUpdate     (one wallet, one trade)
 *   channel "holder.<chain>"     → HolderPositionUpdate (all holders of a token)
 *
 * Branch on `channel`, not on `event`, when handling this event.
 */
export interface TxPositionUpdate {
  success: true;
  channel: string;
  event: 'position_update';
  data: {
    wallet: string;
    profile: WalletProfile;
    transaction: {
      signature: string;
      slot: number | null;
      action: 'buy' | 'sell';
      transaction_type: 'buy' | 'sell';
      created_at: string | null;
      fee: number;
      fee_native: number | null;
      fee_payer: string;
    };
    token: {
      mint: string;
      symbol: string;
      name: string;
      decimals: number | null;
      supply: number;
      logo: string | null;
    };
    value: {
      currency: Currency;
      amount: number;
      amount_usd: number | null;
      price_usd: number | null;
      peak: number;
      current: number;
    };
    position: {
      token_amount: number;
      held: number;
      peak: number;
      supply_pct: number;
      bag_pct: number;
      prev_supply_pct: number;
      prev_bag_pct: number;
      delta_supply_pct: number;
      delta_bag_pct: number;
      delta_held: number;
      /** True when bag_pct was derived from value rather than token count. */
      used_fallback: boolean;
    };
  };
  meta: GatewayMeta;
}

/** Live position of one holder, as sent on the holder channel. */
export interface HolderPosition {
  held: number;
  peak: number;
  supply_pct: number | null;
  bag_pct: number | null;
  invested: number;
  sold_value: number;
  realized_pnl_sol: number;
  realized_pnl_usd: number | null;
  /**
   * Unlike REST, the gateway does not zero these once a position is closed:
   * a fully sold position reports the negative of its open cost basis.
   * Populated on every chain, not just Solana.
   */
  unrealized_pnl_sol: number | null;
  unrealized_pnl_usd: number | null;
  unrealized_pnl_pct: number | null;
  remaining_sol: number | null;
  remaining_usd: number | null;
  entry_market_cap: number | null;
  entry_market_cap_usd: number | null;
  first_buy_at?: string | null;
  last_activity_at?: string | null;
}

export interface HolderPositionUpdate {
  success: true;
  channel: string;
  event: 'position_update' | 'holder_update' | 'init';
  data: {
    trigger?: 'marketcap' | string;
    blockchain: Chain;
    mint: string;
    token: TokenBlock;
    holder_count: number;
    holders: Array<{
      wallet: string;
      wallet_type: WalletType;
      win_rate: number | null;
      position: HolderPosition;
    }>;
  };
  meta: GatewayMeta;
}

export interface WalletCountEvent {
  success: true;
  channel: string;
  event: 'wallet_count';
  data: { blockchain: Chain; mint: string; kol_count: number };
  meta: GatewayMeta;
}

/** Any position_update, discriminated by the shape of `data`. */
export type PositionUpdate = TxPositionUpdate | HolderPositionUpdate;

/** Narrows a position_update to the per-trade variant from the tx channel. */
export function isTxPositionUpdate(m: PositionUpdate): m is TxPositionUpdate {
  return 'wallet' in m.data && 'transaction' in m.data;
}

/** Narrows a position_update to the token-wide variant from the holder channel. */
export function isHolderPositionUpdate(m: PositionUpdate): m is HolderPositionUpdate {
  return 'holders' in m.data;
}
