# CabalSpy SDK — KOL and smart money wallet tracking API

Official TypeScript client for the **CabalSpy API**: a multichain **KOL wallet tracking API** covering **Solana, Base, BNB Chain, Ethereum and Robinhood Chain**.

Track what Key Opinion Leaders, smart money wallets and whales are actually buying — in real time, with PnL, holder data, cluster signals and bundle detection. Full v1 REST coverage plus six WebSocket streams.

```bash
npm install cabalspy
```

**What you can build with it:** copy-trading bots, KOL leaderboards, memecoin alert systems, wallet analytics dashboards, bundle and sniper detection, portfolio and PnL trackers.

## Quick start

```ts
import { CabalSpy } from 'cabalspy';

const client = new CabalSpy({ apiKey: process.env.CABALSPY_API_KEY });

// Who is this wallet? Searches every chain and wallet type.
const wallet = await client.wallets.lookup('DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK');

// Leaderboard of the best KOL wallets on Solana over 7 days
const board = await client.wallets.leaderboard({
  blockchain: 'solana',
  type: 'kol',
  period: '7d',
  limit: 25,
});

// Live cluster signals: 5+ KOLs buying the same token within an hour
const signals = await client.signals.list({
  blockchain: 'solana',
  type: 'kol',
  mode: 'cluster',
  min_wallets: 5,
  hours: 1,
});
```

## Realtime

One socket, all streams. Subscriptions survive reconnects automatically.

```ts
import { WebSocket } from 'ws'; // Node < 22 only

const rt = client.realtime({ WebSocketImpl: WebSocket });

rt.on('position_update', (msg) => console.log('trade', msg.data));
rt.on('signal',          (msg) => console.log('signal', msg.data));
rt.on('kol_bundle',      (msg) => console.log('bundle', msg.data));

await rt.connect();

rt.subscribe({ stream: 'tx', blockchain: 'solana', type: 'kol', token: '*' });
rt.subscribe({ stream: 'bundle', token: 'MINT_ADDRESS', mode: 'full', mc_interval: 5 });
rt.subscribe({
  stream: 'signal',
  blockchain: 'solana',
  kol: { min_buy: 2, entry_at: [3, 5, 10], exit_at: [2, 0] },
});
```

## Chain coverage

| Chain | Identifier | Currency | Wallet types |
|---|---|---|---|
| Solana | `solana` | SOL | `kol`, `smart`, `whale` |
| BNB Chain | `bnb` | BNB | `kol`, `smart` |
| Base | `base` | ETH | `kol`, `smart` |
| Ethereum | `eth` | ETH | `kol` |
| Robinhood Chain | `rh` | ETH | `kol`, `smart` |

### KOL tracking API for Solana

The deepest coverage of the five. Solana is the only chain with `whale` wallets, live market cap and unrealized PnL, pump.fun bonding curve progress, and the `bundle` stream that detects KOL wallets buying through Jito bundles alongside side wallets.

```ts
await client.signals.list({ blockchain: 'solana', type: 'kol', mode: 'cluster', min_wallets: 5 });
await client.bundle.get({ mint: 'MINT_ADDRESS' });
```

### KOL tracking API for Base

Base carries both `kol` and `smart` wallets. Contract addresses are EVM format, values are denominated in ETH.

```ts
await client.transactions.latest({ blockchain: 'base', type: 'smart', limit: 50 });
```

### KOL tracking API for BNB Chain

BNB Chain carries `kol` and `smart` wallets, denominated in BNB.

```ts
await client.wallets.leaderboard({ blockchain: 'bnb', type: 'kol', period: '7d' });
```

### KOL tracking API for Ethereum

Ethereum mainnet carries `kol` wallets only. Smart money signals are unavailable on this chain.

```ts
await client.wallets.list({ blockchain: 'eth', type: 'kol' });
```

### KOL tracking API for Robinhood Chain

Robinhood Chain is Robinhood's Ethereum L2 on the Arbitrum Orbit stack, live since July 2026, with ETH as the gas token. Both `kol` and `smart` wallets are tracked.

```ts
await client.transactions.volume({ blockchain: 'rh', type: 'kol', hours: 24 });
```

The wallet type is bound to the chain at the type level, so invalid combinations fail to compile:

```ts
client.wallets.list({ blockchain: 'eth', type: 'whale' });
//                                       ~~~~ Type '"whale"' is not assignable to type '"kol"'
```

> **Market cap availability differs between REST and websocket.**
>
> On the **REST API**, `market_cap*`, `price*`, `unrealized_pnl_*` and `remaining_*` are populated for
> Solana only. On `bnb`, `base`, `eth` and `rh` they come back as `null`. Realized PNL, invested amounts,
> holdings and counters are available on every chain.
>
> On the **websocket gateway**, the same fields are populated on every chain, because the gateway runs its
> own multichain price service. A `position_update` for a Base wallet carries a real `unrealized_pnl_usd`,
> while the equivalent REST call returns `null`.
>
> One further difference: REST zeroes `unrealized_pnl_*` once a position is fully sold, the gateway does
> not — over websocket a closed position keeps reporting the negative of its open cost basis.

## REST endpoints

### Wallets

| Method | Endpoint |
|---|---|
| `wallets.list({ blockchain, type, limit?, cursor? })` | `GET /v1/wallets` |
| `wallets.history({ blockchain, address, limit?, cursor? })` | `GET /v1/wallets/history` |
| `wallets.historyPages({ ... })` | auto-follows `next_cursor` |
| `wallets.lookup(address)` | `GET /v1/wallets/lookup` |
| `wallets.leaderboard({ blockchain, type?, period?, limit?, cursor? })` | `GET /v1/wallets/leaderboard` |
| `wallets.tracker({ blockchain, address, period? })` | `GET /v1/wallets/tracker` |
| `wallets.holdings({ blockchain, address })` | `GET /v1/wallets/holdings` |
| `wallets.pnlCalendar({ blockchain, address })` | `GET /v1/wallet/pnl_calendar` |
| `wallets.connections({ blockchain, address, limit? })` | `GET /v1/wallets/connections` |
| `wallets.batch({ blockchain, type?, addresses, fields?, period? })` | `POST /v1/wallets/batch` |

`wallets.list` and `wallets.leaderboard` return **everything** when `limit` is omitted. `wallets.history`
defaults to 500 and caps at 1000. Batch requests take at most 100 addresses.

### Tokens

| Method | Endpoint |
|---|---|
| `tokens.transactions({ blockchain, mint, type?, limit? })` | `GET /v1/tokens/transactions` |
| `tokens.stats({ blockchain, mint, type? })` | `GET /v1/tokens/stats` |
| `tokens.holders({ blockchain, mint, type?, limit? })` | `GET /v1/tokens/holders` |
| `tokens.batch({ blockchain, type, mints, fields? })` | `POST /v1/tokens/batch` |

Omitting `type` merges all wallet types of that chain. Batch takes at most 100 mints.

### Transactions / feed

| Method | Endpoint | Window |
|---|---|---|
| `transactions.latest({ blockchain, type, limit?, mint? })` | `GET /v1/transactions/latest` | – |
| `transactions.timerange({ ..., minutes })` | `GET /v1/transactions/timerange` | max 60 min |
| `transactions.count({ ..., hours })` | `GET /v1/transactions/count` | max 24 h |
| `transactions.volume({ ..., hours })` | `GET /v1/transactions/volume` | max 24 h |

Windows accept `seconds`, `minutes` or `hours`; values above the cap are clamped and reported in `warnings`.

### Signals & analytics

| Method | Endpoint |
|---|---|
| `signals.list({ blockchain, type, mode, ... })` | `GET /v1/signals` |
| `signals.history({ blockchain, type, days?, mode? })` | `GET /v1/signals/history` |
| `analytics.get({ blockchain, type, mode, period?, limit? })` | `GET /v1/analytics` |

- Signal modes: `cluster`, `entry`, `exit`
- Analytics modes: `volume_trend`, `most_traded`, `win_rate`, `top_performers`
- History windows: `7`, `30`, `90`, `all`
- Smart money is unavailable on `eth` (no smart feed)

Setting any gated filter (`kol`, `smart`, `kol_min_buy`, `kol_exit`, `include_wallets`, `min_win_rate`,
`min_token_age`, …) switches the server into gated mode with an AND gate across types.

### Bundles

| Method | Endpoint |
|---|---|
| `bundle.get({ mint })` | `GET /v1/bundle` — **Solana only** |

Fully typed response including per-wallet positions and side-wallet proof fields.

### System

| Method | Endpoint |
|---|---|
| `system.health()` | `GET /v1/health` |
| `system.meta()` | `GET /v1/meta` |

## Errors

Every failure is a typed subclass of `CabalSpyError`, so you can branch on the kind instead of parsing strings.

```ts
import { NotFoundError, RateLimitError, InsufficientCreditsError } from 'cabalspy';

try {
  await client.wallets.tracker({ blockchain: 'solana', address: addr });
} catch (err) {
  if (err instanceof NotFoundError) return null;              // wallet not tracked
  if (err instanceof InsufficientCreditsError) await topUp(); // billing
  if (err instanceof RateLimitError) console.log(err.retryAfter);
  throw err;
}
```

| Class | Status | Codes |
|---|---|---|
| `BadRequestError` | 400 | `missing_parameter`, `invalid_parameter`, `invalid_body` |
| `AuthenticationError` | 401 | `missing_api_key` |
| `PermissionError` | 403 | `invalid_api_key` |
| `InsufficientCreditsError` | 403 | `insufficient_credits` |
| `NotFoundError` | 404 | `wallet_not_found`, `token_not_found` |
| `RateLimitError` | 429 | `rate_limit_exceeded` |
| `ServerError` | 5xx | `internal_error`, `service_unavailable` |
| `ConnectionError` | – | network failure, timeout |

`BadRequestError` carries `.parameter` and `.allowed`, so validation failures are actionable. Every error
carries `.requestId` and `.docs`.

### Retries and rate limits

`429` and `5xx` responses plus network errors are retried automatically with exponential backoff and jitter.
When the server sends `Retry-After`, that value wins over the SDK's own backoff.

```ts
const client = new CabalSpy({ apiKey, maxRetries: 3, timeout: 15_000 });

await client.wallets.lookup(addr);
console.log(client.lastRateLimit); // { limit, remaining, reset }
```

Each authenticated request costs 10 credits. Rate limits are per minute and per plan.

## Pagination

Cursor-paginated endpoints expose a page iterator. It yields whole envelopes, since the item key differs
per endpoint:

```ts
for await (const page of client.wallets.historyPages({ blockchain: 'solana', address: addr })) {
  console.log(page.pagination?.total, page.data);
}
```

## Configuration

```ts
new CabalSpy({
  apiKey: process.env.CABALSPY_API_KEY, // required (env fallback: CABALSPY_API_KEY)
  baseUrl: 'https://api.cabalspy.xyz/v1',
  wsUrl: 'wss://stream.cabalspy.xyz',
  timeout: 30_000,
  maxRetries: 2,
  headers: {},
  fetch: undefined,                     // custom fetch (proxies, tests)
});
```

Never hardcode the key. Read it from the environment or a secret manager.

## Raw access

Every resource method has a `*Raw` variant returning the full envelope (`data`, `pagination`, `meta`,
`rateLimit`, `status`). For endpoints not yet wrapped, call the client directly:

```ts
const env = await client.wallets.leaderboardRaw({ blockchain: 'bnb', period: '30d' });
console.log(env.meta.cached, env.meta.cache_age_seconds);

const custom = await client.get('/some/new/endpoint', { blockchain: 'solana' });
```

## FAQ

### What is a KOL wallet?

KOL stands for Key Opinion Leader: a trader or crypto personality whose token calls move markets. CabalSpy tracks their onchain wallets with a public identity attached — name, avatar, Twitter and Telegram handle — so you can verify whether they actually bought what they promoted.

### How is smart money different from a KOL?

A KOL is identified by influence, a smart money wallet by track record. KOL trades carry social signal; smart money trades carry statistical signal. CabalSpy exposes both as separate wallet types on the same endpoints, so you can query either or merge them.

### What does bundle detection do?

On Solana, KOL wallets often buy through Jito bundles together with side wallets they control, which hides the true size of a position. The `bundle` endpoint and stream group those wallets, report a confidence score and expose the evidence — fee match, block index, adjacency to the KOL transaction.

### Does it work in the browser?

The SDK runs anywhere `fetch` exists, but your API key would be readable in a browser bundle. Use it server side and proxy requests from your frontend.

### Is there a free tier?

Rate limits and credits are set per API key plan. See [docs.cabalspy.xyz](https://docs.cabalspy.xyz).

## Docs

Full API reference: [docs.cabalspy.xyz](https://docs.cabalspy.xyz)

## Related

- [SDK overview](https://www.cabalspy.xyz/sdks/) on cabalspy.xyz · [KOL API](https://www.cabalspy.xyz/kol-api/) · [Smart Money API](https://www.cabalspy.xyz/smart-money-api/) · [use cases](https://www.cabalspy.xyz/use-cases/)
- SDKs: [TypeScript](https://www.npmjs.com/package/cabalspy) · [Python](https://pypi.org/project/cabalspy/) · [Rust](https://crates.io/crates/cabalspy)
- x402 clients (pay per request, no API key): [TypeScript](https://www.npmjs.com/package/cabalspy-x402) · [Python](https://pypi.org/project/cabalspy-x402/)
- [MCP server](https://www.cabalspy.xyz/mcp/) — for Claude, Cursor and VS Code
- [CabalSpy Terminal](https://app.cabalspy.xyz/) — trade with the same wallet data

## License

MIT
