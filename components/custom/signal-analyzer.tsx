'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DerivWS } from '@deriv/core';
import { getLastDigit } from '@/lib/digit-stats';
import { SYMBOL_DISPLAY_NAMES } from '@/lib/active-symbols-display-names';
import { cn } from '@/lib/utils';

/**
 * Signal Analyzer — scans every volatility index at once and flags the ones
 * currently matching a rule.
 *
 * Distinct from the Analysis Tool, which inspects a single symbol in depth.
 * This watches all ten and answers "where is this happening right now".
 *
 * Owns its own DerivWS instance rather than sharing DerivWSProvider's socket.
 * @deriv/core's useTicks fires `forget_all: 'ticks'` on unmount, which would
 * tear down all ten subscriptions here — and this component's own teardown
 * would just as silently kill the trade screen's. Same reasoning as
 * DigitAnalysis and DigitDistribution.
 */

const SYMBOLS = [
  'R_100', '1HZ100V',
  'R_75', '1HZ75V',
  'R_50', '1HZ50V',
  'R_25', '1HZ25V',
  'R_10', '1HZ10V',
] as const;

const MIN_WINDOW = 30;
const MAX_WINDOW = 500;
const DEFAULT_WINDOW = 120;

type RuleKind = 'absent' | 'streak' | 'bias';

interface TicksHistoryLike {
  history?: { prices: number[] };
  pip_size?: number;
}

function inferPipSize(prices: number[]): number {
  let max = 2;
  for (const price of prices) {
    const str = String(price);
    const dot = str.indexOf('.');
    if (dot !== -1) max = Math.max(max, str.length - dot - 1);
  }
  return max;
}

/** How many ticks back the digit last appeared. Window length if never. */
function ticksSince(digits: number[], target: number): number {
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] === target) return digits.length - 1 - i;
  }
  return digits.length;
}

/** Length of the current run of the given parity, counting back from newest. */
function currentStreak(digits: number[], parity: 'even' | 'odd'): number {
  let n = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    const isEven = digits[i] % 2 === 0;
    if ((parity === 'even') !== isEven) break;
    n++;
  }
  return n;
}

export function SignalAnalyzer() {
  const [rule, setRule] = useState<RuleKind>('absent');
  const [digit, setDigit] = useState(5);
  const [minTicks, setMinTicks] = useState(20);
  const [parity, setParity] = useState<'even' | 'odd'>('even');
  const [minStreak, setMinStreak] = useState(5);
  const [barrier, setBarrier] = useState(4);
  const [direction, setDirection] = useState<'over' | 'under'>('over');
  const [minPct, setMinPct] = useState(60);

  const [windowInput, setWindowInput] = useState(String(DEFAULT_WINDOW));
  const [windowSize, setWindowSize] = useState(DEFAULT_WINDOW);

  const [prices, setPrices] = useState<Record<string, number[]>>({});
  const [pips, setPips] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);

  const pipsRef = useRef<Record<string, number>>({});

  // Commit the window after a pause, so typing "120" doesn't refetch at 1 and 12.
  useEffect(() => {
    const timer = setTimeout(() => {
      const n = parseInt(windowInput, 10);
      if (!isNaN(n)) setWindowSize(Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, n)));
    }, 600);
    return () => clearTimeout(timer);
  }, [windowInput]);

  useEffect(() => {
    const ws = new DerivWS();
    let disposed = false;
    const unsubs: Array<() => void> = [];

    setPrices({});
    setReady(false);

    const load = async () => {
      await Promise.all(
        SYMBOLS.map(async (symbol) => {
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
          pipsRef.current[symbol] = pip;

          setPips((prev) => ({ ...prev, [symbol]: pip }));
          setPrices((prev) => ({ ...prev, [symbol]: loaded }));

          const sub = await ws.subscribe({ ticks: symbol }, (raw) => {
            const tick = (raw as { tick?: { quote: number } }).tick;
            if (!tick) return;
            setPrices((prev) => ({
              ...prev,
              [symbol]: [...(prev[symbol] ?? []), tick.quote].slice(-windowSize),
            }));
          });

          if (disposed) {
            sub.unsubscribe();
            return;
          }
          unsubs.push(sub.unsubscribe);
        })
      );
      if (!disposed) setReady(true);
    };

    const unsubState = ws.onConnectionStateChange((connected) => {
      if (connected && !disposed) load().catch(() => undefined);
    });
    ws.connect().catch(() => undefined);

    return () => {
      disposed = true;
      unsubState();
      unsubs.forEach((u) => u());
      ws.disconnect();
    };
  }, [windowSize]);

  const rows = useMemo(() => {
    return SYMBOLS.map((symbol) => {
      const p = prices[symbol] ?? [];
      const pip = pips[symbol] ?? 2;
      const digits = p.map((q) => getLastDigit(q, pip));
      const current = digits.length > 0 ? digits[digits.length - 1] : null;

      let value = 0;
      let label = '';
      let matched = false;

      if (rule === 'absent') {
        value = ticksSince(digits, digit);
        label = `${value} ticks`;
        matched = digits.length > 0 && value >= minTicks;
      } else if (rule === 'streak') {
        value = currentStreak(digits, parity);
        label = `${value} in a row`;
        matched = value >= minStreak;
      } else {
        const hits = digits.filter((d) => (direction === 'over' ? d > barrier : d < barrier)).length;
        value = digits.length > 0 ? (hits / digits.length) * 100 : 0;
        label = `${value.toFixed(1)}%`;
        matched = digits.length > 0 && value >= minPct;
      }

      return { symbol, current, value, label, matched, loaded: digits.length };
    })
      // Matches first, then by strength, so the answer is at the top.
      .sort((a, b) => Number(b.matched) - Number(a.matched) || b.value - a.value);
  }, [prices, pips, rule, digit, minTicks, parity, minStreak, barrier, direction, minPct]);

  const matchCount = rows.filter((r) => r.matched).length;

  const selectCls =
    'rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';
  const numCls =
    'w-16 rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono tabular-nums text-center text-foreground focus:outline-none focus:ring-2 focus:ring-ring';
  const legendCls = 'text-[10px] font-mono uppercase tracking-widest text-muted-foreground';

  return (
    <main className="w-full max-w-5xl mx-auto px-3 py-6">
      <header className="mb-4">
        <h1 className="text-sm font-mono uppercase tracking-widest text-cyan-500">
          Signal Analyzer
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Watching all ten volatility indices for the condition below.
        </p>
      </header>

      {/* Rule builder */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className={cn(legendCls, 'mb-1 block')}>Condition</span>
            <select value={rule} onChange={(e) => setRule(e.target.value as RuleKind)} className={selectCls}>
              <option value="absent">Digit absent</option>
              <option value="streak">Even / odd run</option>
              <option value="bias">Over / under share</option>
            </select>
          </div>

          {rule === 'absent' && (
            <>
              <div>
                <span className={cn(legendCls, 'mb-1 block')}>Digit</span>
                <select value={digit} onChange={(e) => setDigit(Number(e.target.value))} className={selectCls}>
                  {Array.from({ length: 10 }, (_, i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
              <div>
                <span className={cn(legendCls, 'mb-1 block')}>For at least</span>
                <input
                  type="number" min={1} value={minTicks}
                  onChange={(e) => setMinTicks(Number(e.target.value))}
                  className={numCls}
                />
              </div>
            </>
          )}

          {rule === 'streak' && (
            <>
              <div>
                <span className={cn(legendCls, 'mb-1 block')}>Parity</span>
                <select
                  value={parity}
                  onChange={(e) => setParity(e.target.value as 'even' | 'odd')}
                  className={selectCls}
                >
                  <option value="even">Even</option>
                  <option value="odd">Odd</option>
                </select>
              </div>
              <div>
                <span className={cn(legendCls, 'mb-1 block')}>At least</span>
                <input
                  type="number" min={1} value={minStreak}
                  onChange={(e) => setMinStreak(Number(e.target.value))}
                  className={numCls}
                />
              </div>
            </>
          )}

          {rule === 'bias' && (
            <>
              <div>
                <span className={cn(legendCls, 'mb-1 block')}>Direction</span>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'over' | 'under')}
                  className={selectCls}
                >
                  <option value="over">Over</option>
                  <option value="under">Under</option>
                </select>
              </div>
              <div>
                <span className={cn(legendCls, 'mb-1 block')}>Barrier</span>
                <select value={barrier} onChange={(e) => setBarrier(Number(e.target.value))} className={selectCls}>
                  {Array.from({ length: 10 }, (_, i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
              <div>
                <span className={cn(legendCls, 'mb-1 block')}>At least %</span>
                <input
                  type="number" min={0} max={100} value={minPct}
                  onChange={(e) => setMinPct(Number(e.target.value))}
                  className={numCls}
                />
              </div>
            </>
          )}

          <div className="ml-auto">
            <span className={cn(legendCls, 'mb-1 block')}>Ticks</span>
            <input
              type="number"
              min={MIN_WINDOW}
              max={MAX_WINDOW}
              value={windowInput}
              onChange={(e) => setWindowInput(e.target.value)}
              onBlur={() => setWindowInput(String(windowSize))}
              className={numCls}
            />
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="mt-4 flex items-baseline justify-between">
        <h2 className={legendCls}>
          {matchCount} of {SYMBOLS.length} matching
        </h2>
        {!ready && <span className="text-xs text-muted-foreground">Loading ticks...</span>}
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border border-border">
        <div
          className={cn('grid items-center gap-2 px-3 py-2', legendCls)}
          style={{ gridTemplateColumns: '1fr 3.5rem 7rem 4.5rem' }}
        >
          <span>Symbol</span>
          <span className="text-center">Now</span>
          <span className="text-right">Reading</span>
          <span className="text-right">Signal</span>
        </div>

        {rows.map((r) => (
          <div
            key={r.symbol}
            className={cn(
              'grid items-center gap-2 border-t border-border px-3 py-2.5 text-sm transition-colors',
              r.matched && 'bg-buy-background/10'
            )}
            style={{ gridTemplateColumns: '1fr 3.5rem 7rem 4.5rem' }}
          >
            <span className="truncate text-foreground">
              {SYMBOL_DISPLAY_NAMES[r.symbol] ?? r.symbol}
            </span>
            <span className="text-center font-mono font-bold tabular-nums text-primary">
              {r.current ?? '-'}
            </span>
            <span className="text-right font-mono tabular-nums text-muted-foreground">
              {r.loaded === 0 ? '-' : r.label}
            </span>
            <span className="text-right">
              {r.matched ? (
                <span className="rounded bg-buy-background px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-buy-foreground">
                  Match
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        These readings describe the ticks that have already happened. Each tick on
        a volatility index is drawn independently, so a long absence or run does
        not change what the next digit will be.
      </p>
    </main>
  );
}
