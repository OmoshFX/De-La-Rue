'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { DerivWS } from '@deriv/core';
import { getLastDigit } from '@/lib/digit-stats';
import { SYMBOL_DISPLAY_NAMES } from '@/lib/active-symbols-display-names';
import { cn } from '@/lib/utils';

/**
 * Digit-frequency panel for the Analysis Tool.
 *
 * Self-contained by design: it owns its own DerivWS connection rather than
 * sharing DerivWSProvider's socket. The shared socket is used by @deriv/core's
 * useTicks, which fires `forget_all: 'ticks'` on symbol change and unmount —
 * that would silently kill this panel's subscription, and this panel's own
 * teardown would just as silently kill the trade screen's. Separate sockets
 * mean neither page can disturb the other. This mirrors what DigitAnalysis
 * already does on this same page, and for the same reason.
 *
 * The endpoint still comes from packages/core/src/config/urls.ts, so this runs
 * under our own app registration rather than the shared public app_id.
 */

/** Digit-tradable volatility indices. The 1s variants tick every second. */
const SYMBOLS = [
  'R_100', '1HZ100V',
  'R_75', '1HZ75V',
  'R_50', '1HZ50V',
  'R_25', '1HZ25V',
  'R_10', '1HZ10V',
] as const;

const MIN_WINDOW = 50;
const MAX_WINDOW = 5000;
const DEFAULT_WINDOW = 1000;

/** Deriv caps ticks_history at 5000, which is why MAX_WINDOW is what it is. */

interface TicksHistoryLike {
  history?: { prices: number[] };
  pip_size?: number;
}

/**
 * Infer decimal places from a batch of prices.
 *
 * Only used when ticks_history omits pip_size. Across a full batch the odds of
 * every price ending in a trailing zero are negligible, so the observed maximum
 * is reliable.
 */
function inferPipSize(prices: number[]): number {
  let max = 2;
  for (const price of prices) {
    const str = String(price);
    const dot = str.indexOf('.');
    if (dot !== -1) max = Math.max(max, str.length - dot - 1);
  }
  return max;
}

type Rank = 'most' | 'least' | null;

/**
 * Rank the ten digits by frequency.
 *
 * Ranks are assigned by *value*, not by position, so ties share a rank — if two
 * digits are both on 9.7% they are both highlighted, rather than one of them
 * winning arbitrarily on array order. Returns all nulls when there is no data
 * or when every digit is level, since highlighting is meaningless in both cases.
 */
function rankDigits(percentages: number[], totalTicks: number): Rank[] {
  if (totalTicks === 0) return Array(10).fill(null);

  const distinct = [...new Set(percentages)].sort((a, b) => b - a);
  if (distinct.length === 1) return Array(10).fill(null);

  const most = distinct[0];
  const least = distinct[distinct.length - 1];

  return percentages.map((pct) => {
    if (pct === most) return 'most';
    if (pct === least) return 'least';
    return null;
  });
}

const RANK_STYLES: Record<NonNullable<Rank>, string> = {
  'most': 'bg-buy-background text-buy-foreground border-transparent',
  'least': 'bg-sell-background text-sell-foreground border-transparent',
};

export function DigitDistribution() {
  const [symbol, setSymbol] = useState<string>('R_100');
  const [windowInput, setWindowInput] = useState(String(DEFAULT_WINDOW));
  const [windowSize, setWindowSize] = useState(DEFAULT_WINDOW);

  const [prices, setPrices] = useState<number[]>([]);
  const [pipSize, setPipSize] = useState(2);
  const [status, setStatus] = useState<'connecting' | 'loading' | 'live' | 'error'>('connecting');

  const pipRef = useRef(2);

  // Commit the window input after a pause. Typing "1000" would otherwise fire
  // a refetch at "1", "10" and "100" on the way through.
  useEffect(() => {
    const timer = setTimeout(() => {
      const n = parseInt(windowInput, 10);
      if (!isNaN(n)) {
        setWindowSize(Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, n)));
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [windowInput]);

  useEffect(() => {
    const ws = new DerivWS();
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    setPrices([]);
    setStatus('connecting');

    const load = async () => {
      setStatus('loading');

      const history = await ws.send<TicksHistoryLike>({
        ticks_history: symbol,
        end: 'latest',
        start: 1,
        count: windowSize,
        style: 'ticks',
      });
      if (disposed) return;

      const loaded = history.history?.prices ?? [];
      const pip = history.pip_size ?? inferPipSize(loaded);
      pipRef.current = pip;
      setPipSize(pip);
      setPrices(loaded);

      const sub = await ws.subscribe({ ticks: symbol }, (raw) => {
        const tick = (raw as { tick?: { quote: number; pip_size?: number } }).tick;
        if (!tick) return;

        if (tick.pip_size !== undefined && tick.pip_size !== pipRef.current) {
          pipRef.current = tick.pip_size;
          setPipSize(tick.pip_size);
        }
        // Slice from the end so the window stays pinned to the newest ticks.
        setPrices((prev) => [...prev, tick.quote].slice(-windowSize));
      });

      if (disposed) {
        sub.unsubscribe();
        return;
      }
      unsubscribe = sub.unsubscribe;
      setStatus('live');
    };

    // Fires on first connect and after every automatic reconnect, so the
    // stream restores itself without a hand-rolled retry loop.
    const unsubState = ws.onConnectionStateChange((connected) => {
      if (connected && !disposed) {
        load().catch(() => {
          if (!disposed) setStatus('error');
        });
      }
    });

    ws.connect().catch(() => {
      if (!disposed) setStatus('error');
    });

    return () => {
      disposed = true;
      unsubState();
      unsubscribe?.();
      ws.disconnect();
    };
  }, [symbol, windowSize]);

  const { percentages, counts, ranks, currentDigit, lastQuote } = useMemo(() => {
    const c: number[] = new Array(10).fill(0);
    for (const price of prices) c[getLastDigit(price, pipSize)]++;

    const total = prices.length;
    const pct = c.map((n) => (total > 0 ? (n / total) * 100 : 0));
    const last = prices.length > 0 ? prices[prices.length - 1] : null;

    return {
      counts: c,
      percentages: pct,
      ranks: rankDigits(pct, total),
      currentDigit: last === null ? null : getLastDigit(last, pipSize),
      lastQuote: last === null ? null : last.toFixed(pipSize),
    };
  }, [prices, pipSize]);

  return (
    <div className="w-full max-w-5xl mx-auto px-3 pt-8">
      <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
        {/* Market selector */}
        <label
          htmlFor="digit-dist-symbol"
          className="block text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1.5"
        >
          Select market
        </label>
        <select
          id="digit-dist-symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {SYMBOLS.map((s) => (
            <option key={s} value={s}>
              {SYMBOL_DISPLAY_NAMES[s] ?? s}
            </option>
          ))}
        </select>

        {/* Live quote, with the digit being counted picked out */}
        <div className="mt-3 flex items-center justify-between rounded-md bg-muted/50 px-4 py-3">
          {lastQuote === null ? (
            <span className="text-sm font-mono text-muted-foreground">
              {status === 'error' ? 'Connection failed' : 'Waiting for ticks...'}
            </span>
          ) : (
            <>
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {lastQuote.slice(0, -1)}
                <span className="text-primary">{lastQuote.slice(-1)}</span>
              </span>
              <span className="text-2xl font-bold tabular-nums text-primary">{currentDigit}</span>
            </>
          )}
        </div>

        {/* Window size */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <label
            htmlFor="digit-dist-window"
            className="text-xs font-mono uppercase tracking-widest text-muted-foreground"
          >
            Ticks window
          </label>
          <input
            id="digit-dist-window"
            type="number"
            inputMode="numeric"
            min={MIN_WINDOW}
            max={MAX_WINDOW}
            value={windowInput}
            onChange={(e) => setWindowInput(e.target.value)}
            onBlur={() => setWindowInput(String(windowSize))}
            className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm font-mono tabular-nums text-foreground text-center focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs font-mono text-muted-foreground">
            ({MIN_WINDOW}&ndash;{MAX_WINDOW})
          </span>
        </div>

        {/* Distribution */}
        <div className="mt-5 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium text-foreground">
            Last {windowSize.toLocaleString()} ticks digit distribution
          </h3>
          <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs font-mono tabular-nums text-muted-foreground">
            {prices.length.toLocaleString()}/{windowSize.toLocaleString()}
          </span>
        </div>

        {/* Five per row on narrow screens, ten across from sm up. */}
        <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10 sm:gap-1.5">
          {percentages.map((pct, digit) => {
            const rank = ranks[digit];
            const isCurrent = digit === currentDigit;

            return (
              <div key={digit} className="flex flex-col items-center">
                {/* Fixed-height slot so rows do not jump as the marker moves. */}
                <div className="h-2 flex items-end">
                  {isCurrent && (
                    <span
                      aria-hidden
                      className="h-0 w-0 border-x-4 border-x-transparent border-t-[6px] border-t-primary"
                    />
                  )}
                </div>

                <div
                  title={`${counts[digit].toLocaleString()} of ${prices.length.toLocaleString()} ticks`}
                  className={cn(
                    'mt-1 flex aspect-square w-full max-w-[3.5rem] flex-col items-center justify-center rounded-full border transition-colors',
                    rank ? RANK_STYLES[rank] : 'border-border bg-background text-foreground',
                    isCurrent && 'ring-2 ring-primary ring-offset-2 ring-offset-card'
                  )}
                >
                  <span className="text-base font-bold leading-none sm:text-lg">{digit}</span>
                  <span className="mt-0.5 text-[10px] font-mono leading-none tabular-nums opacity-80">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-buy-background" />
            Most frequent
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-sell-background" />
            Least frequent
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-0 border-x-[3px] border-x-transparent border-t-[5px] border-t-primary" />
            Current digit
          </span>
        </div>
      </div>
    </div>
  );
}
