'use client';

import { useEffect, useState } from 'react';
import { DerivWS } from '@deriv/core';
import { getLastDigit } from '@/lib/digit-stats';

const SYMBOLS = [
  { value: 'R_100', label: 'Volatility 100' },
  { value: 'R_75',  label: 'Volatility 75'  },
  { value: 'R_50',  label: 'Volatility 50'  },
  { value: 'R_25',  label: 'Volatility 25'  },
  { value: 'R_10',  label: 'Volatility 10'  },
];

interface SymbolData {
  history: boolean[];
}

export function DigitAnalysis() {
  const [count, setCount] = useState(10);
  const [inputVal, setInputVal] = useState('10');
  const [data, setData] = useState<Record<string, SymbolData>>({
    R_100: { history: [] },
    R_75: { history: [] },
    R_50: { history: [] },
    R_25: { history: [] },
    R_10: { history: [] },
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    // Uses the app's own DerivWS client, which reads its endpoint from
    // packages/core/src/config/urls.ts — so this runs under our registration
    // rather than the shared public app_id=1089.
    //
    // Deliberately a separate instance from DerivWSProvider's socket: the
    // trading panel on this page uses @deriv/core's useTicks, which fires
    // `forget_all: 'ticks'` whenever its symbol changes or it unmounts. Sharing
    // one socket would let that silently kill these five subscriptions.
    const ws = new DerivWS();
    let disposed = false;
    let unsubscribers: Array<() => void> = [];

    const handleTick = (raw: Record<string, unknown>) => {
      const tick = (raw as { tick?: { symbol: string; quote: number; pip_size?: number } }).tick;
      if (!tick) return;

      // pip_size matters: JS drops trailing zeros, so 1234.50 stringifies to
      // "1234.5" and the old slice(-1) read the digit as 5 instead of 0.
      const digit = getLastDigit(tick.quote, tick.pip_size ?? 2);
      const isEven = digit % 2 === 0;

      setData(prev => ({
        ...prev,
        [tick.symbol]: {
          history: [isEven, ...(prev[tick.symbol]?.history ?? [])].slice(0, 100),
        },
      }));
    };

    const subscribeAll = () => {
      unsubscribers = [];
      for (const s of SYMBOLS) {
        ws.subscribe({ ticks: s.value }, handleTick)
          .then(sub => {
            if (disposed) sub.unsubscribe();
            else unsubscribers.push(sub.unsubscribe);
          })
          .catch(() => {});
      }
    };

    // Fires on the first connect and again after each automatic reconnect,
    // so streams are restored without the hand-rolled 2s retry loop.
    const unsubState = ws.onConnectionStateChange(connected => {
      if (connected && !disposed) subscribeAll();
    });

    ws.connect().catch(() => {});

    return () => {
      disposed = true;
      unsubState();
      unsubscribers.forEach(u => u());
      ws.disconnect();
    };
  }, [mounted]);

  const handleCountChange = (val: string) => {
    setInputVal(val);
    const n = parseInt(val);
    if (!isNaN(n) && n >= 1 && n <= 100) {
      setCount(n);
    }
  };

  if (!mounted) return null;

  return (
    <div className="w-full max-w-5xl mx-auto mt-8 px-3 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-mono tracking-widest text-cyan-500 uppercase">
            Live Digit Analysis
          </h2>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            E = Even (green) · O = Odd (red)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
            Last
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={inputVal}
            onChange={e => handleCountChange(e.target.value)}
            className="w-16 bg-background border border-border rounded px-2 py-1 text-sm font-mono text-foreground text-center focus:outline-none focus:border-cyan-500"
          />
          <span className="text-xs font-mono text-muted-foreground">digits</span>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Table header */}
        <div className="grid bg-card px-4 py-2 border-b border-border"
          style={{ gridTemplateColumns: '140px 48px 1fr' }}>
          <span className="text-xs font-mono tracking-widest text-muted-foreground uppercase">Symbol</span>
          <span className="text-xs font-mono tracking-widest text-muted-foreground uppercase text-center">Now</span>
          <span className="text-xs font-mono tracking-widest text-muted-foreground uppercase pl-3">History (newest → oldest)</span>
        </div>

        {/* Rows */}
        {SYMBOLS.map((sym, idx) => {
          const history = data[sym.value]?.history ?? [];
          const latest = history[0];
          const displayed = history.slice(0, count);

          return (
            <div
              key={sym.value}
              className={`grid items-center px-4 py-3 ${idx % 2 === 0 ? 'bg-background' : 'bg-card'}`}
              style={{ gridTemplateColumns: '140px 48px 1fr' }}
            >
              <span className="text-xs font-mono text-foreground">{sym.label}</span>

              {/* Latest digit */}
              <div className="flex justify-center">
                {latest === undefined ? (
                  <span className="text-xs font-mono text-muted-foreground">—</span>
                ) : (
                  <span
                    className="text-sm font-mono font-bold w-7 h-7 flex items-center justify-center rounded"
                    style={{
                      color: '#fff',
                      background: latest ? '#16a34a' : '#dc2626',
                      border: `1px solid ${latest ? '#15803d' : '#b91c1c'}`,
                    }}
                  >
                    {latest ? 'E' : 'O'}
                  </span>
                )}
              </div>

              {/* History */}
              <div className="flex flex-wrap gap-1 pl-3">
                {displayed.length === 0 ? (
                  <span className="text-xs font-mono text-muted-foreground">Waiting...</span>
                ) : (
                  displayed.map((isEven, i) => (
                    <span
                      key={i}
                      className="text-[10px] font-mono font-bold w-5 h-5 flex items-center justify-center rounded"
                      style={{
                        color: '#fff',
                        background: isEven ? '#16a34a' : '#dc2626',
                        opacity: i === 0 ? 1 : Math.max(0.4, 1 - i * (0.6 / count)),
                      }}
                    >
                      {isEven ? 'E' : 'O'}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
