'use client';

import { useEffect, useState, useRef } from 'react';

const SYMBOLS = [
  { value: 'R_100', label: 'Volatility 100' },
  { value: 'R_75',  label: 'Volatility 75'  },
  { value: 'R_50',  label: 'Volatility 50'  },
  { value: 'R_25',  label: 'Volatility 25'  },
  { value: 'R_10',  label: 'Volatility 10'  },
];

const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';

interface SymbolData {
  history: boolean[];
}

export function DigitAnalysis() {
  const [count, setCount] = useState(10);
  const [inputVal, setInputVal] = useState('10');
  const [data, setData] = useState<Record<string, SymbolData>>(() =>
    Object.fromEntries(SYMBOLS.map(s => [s.value, { history: [] }]))
  );
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let reconnectTimeout: NodeJS.Timeout;
    let ws: WebSocket;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        SYMBOLS.forEach(s => {
          ws.send(JSON.stringify({ ticks: s.value, subscribe: 1 }));
        });
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (!('tick' in msg)) return;

        const symbol = msg.tick.symbol;
        const quote = msg.tick.quote;
        const lastDigit = parseInt(String(quote).replace('.', '').slice(-1), 10);
        const isEven = lastDigit % 2 === 0;

        setData(prev => {
          const existing = prev[symbol]?.history ?? [];
          return {
            ...prev,
            [symbol]: {
              history: [isEven, ...existing].slice(0, 100),
            },
          };
        });
      };

      ws.onclose = () => {
        // Reconnect after 2 seconds
        reconnectTimeout = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      ws?.close();
    };
  }, []);

  const handleCountChange = (val: string) => {
    setInputVal(val);
    const n = parseInt(val);
    if (!isNaN(n) && n >= 1 && n <= 100) {
      setCount(n);
    }
  };

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
