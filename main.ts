// Momentum trend-follower for the BTC race (agent-fun/bars-replay/v1).
//
// Single symbol (CBBTC), long only, $1,000 paper. v1 (-198 USDC, 143
// trades) and v2 (-33.54, 30 trades) churned by exiting on a short-window
// sign flip; v3 (+6.84, 17 trades) still churned on a 2-hour flip. The
// lesson from the kit's baselines is stark: on 1-minute bars the winners
// are the ones that buy early and hold -- momentum (+34.94, 1 trade) and
// buy-and-hold (+32.17, 1 trade) -- while every signal-exit bleeds on
// pullbacks. v4 keeps that shape and only exits on a real drawdown:
//
//   - Decide only once every 24 bars (a rebalance); hold between them.
//   - Entry: buy the whole stake at the first rebalance (like the
//     momentum baseline), and after a stop-exit re-enter only when the
//     trailing 24-bar return is positive again.
//   - Exit: sell the whole position only when its value has fallen 5%
//     from its peak since entry (a trailing stop). The dev window's max
//     drawdown is 1.98%, so the stop never fires there; on the race
//     window it caps a crash instead of riding it down.
//
// All arithmetic is exact integers (bigint, no floats, no clock, no
// random), so two runs on the same bars produce the same orders.
//
// (First written as main.py; switched to main.ts because the local
// sandbox runs node only, so a Python bot cannot be graded locally
// before submit.)

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const LOOKBACK = 24;
const REBALANCE = 24;
/** Trailing stop: sell when the position is worth 95/100 of its peak. */
const STOP_NUM = 95n;
const STOP_DEN = 100n;
const MAX_SLIPPAGE_BPS = 100;

/** Closes of the symbol's bars, in order; a missing bar adds nothing. */
const closes: bigint[] = [];
/** The next rebalance bar; set from hello: max(LOOKBACK, the warm-up's batches). */
let nextRebalance = LOOKBACK;
/** Peak value of the current position since entry (0 when flat). */
let peak = 0n;
/** Whether the bot has ever bought (the first entry is unconditional). */
let everBought = false;

await runBars({
  onHello(state: BarsState) {
    nextRebalance = Math.max(LOOKBACK, state.warmupBars);
  },
  onBatch(state: BarsState, batch) {
    const sym = state.hello.symbols[0].symbol;
    for (const bar of batch.bars) {
      if (bar.symbol === sym) closes.push(bar.c);
    }
    if (state.warming_up) return [];
    const held = state.positions.get(sym);
    if (held !== undefined) {
      const value = state.value(sym, held.qty);
      if (value > peak) peak = value;
    }
    if (batch.seq < nextRebalance) return [];
    nextRebalance = batch.seq + REBALANCE;
    if (held !== undefined) {
      const value = state.value(sym, held.qty);
      if (value * STOP_DEN <= peak * STOP_NUM) {
        peak = 0n;
        const sell: SellInput = { side: 'sell', symbol: sym, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }
    if (closes.length <= LOOKBACK) return [];
    const now = closes[closes.length - 1];
    const then = closes[closes.length - 1 - LOOKBACK];
    if (!everBought || now > then) {
      const { caps, fees } = state.hello;
      const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
      const amount = state.cash < byWeight ? state.cash : byWeight;
      if (amount === 0n || amount < BigInt(fees.min_notional_quote_units)) return [];
      everBought = true;
      const buy: BuyInput = { side: 'buy', symbol: sym, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS };
      return [buy];
    }
    return [];
  },
});
