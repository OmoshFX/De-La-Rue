'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { ExternalLink } from 'lucide-react';
import { SYMBOL_DISPLAY_NAMES } from '@/lib/active-symbols-display-names';

/**
 * TradingView chart for the volatility indices this app trades.
 *
 * Self-contained: no DerivWS, no auth, no shared state. The chart is
 * TradingView's own embed, fed by their Deriv data source, so nothing here
 * touches the app's sockets or the bot frame.
 *
 * Deriv's synthetics are listed on TradingView under the DERIV exchange
 * prefix (e.g. DERIV:VOLATILITY_100_1S_INDEX). Older guidance says they are
 * not — that predates the listing.
 */

/**
 * Deriv API symbol -> TradingView symbol.
 *
 * The naming is regular: VOLATILITY_<n>_INDEX for two-second ticks and
 * VOLATILITY_<n>_1S_INDEX for one-second. If TradingView renames any of
 * these the chart will report an invalid symbol rather than fail silently.
 */
const TV_SYMBOLS: Record<string, string> = {
  R_100: 'DERIV:VOLATILITY_100_INDEX',
  '1HZ100V': 'DERIV:VOLATILITY_100_1S_INDEX',
  R_75: 'DERIV:VOLATILITY_75_INDEX',
  '1HZ75V': 'DERIV:VOLATILITY_75_1S_INDEX',
  R_50: 'DERIV:VOLATILITY_50_INDEX',
  '1HZ50V': 'DERIV:VOLATILITY_50_1S_INDEX',
  R_25: 'DERIV:VOLATILITY_25_INDEX',
  '1HZ25V': 'DERIV:VOLATILITY_25_1S_INDEX',
  R_10: 'DERIV:VOLATILITY_10_INDEX',
  '1HZ10V': 'DERIV:VOLATILITY_10_1S_INDEX',
};

const SYMBOLS = Object.keys(TV_SYMBOLS);

const WIDGET_SRC =
  'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

export function TradingViewChart() {
  const [symbol, setSymbol] = useState('R_100');
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  // next-themes reports undefined until it has read the DOM. Waiting avoids
  // mounting the widget in the wrong theme and immediately rebuilding it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const tvSymbol = TV_SYMBOLS[symbol];

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !mounted) return;

    // The embed script writes into its own parent, so each rebuild gets a
    // fresh container rather than trying to reconfigure the live widget.
    container.innerHTML = '';

    // These class names are load-bearing: the embed script looks for
    // `.tradingview-widget-container__widget` and mounts its iframe inside it.
    // Without the class it injects a sibling instead, and this div stays as an
    // empty full-height block that pushes the chart below the fold.
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';
    widget.style.width = '100%';
    container.appendChild(widget);

    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: '1',
      timezone: 'Etc/UTC',
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      hide_side_toolbar: false,
      support_host: 'https://www.tradingview.com',
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [tvSymbol, resolvedTheme, mounted]);

  return (
    // 7.5rem is AppNav's height, matching NAV_HEIGHT in bot-frame.tsx.
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-3 py-2">
        <label
          htmlFor="tv-symbol"
          className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
        >
          Market
        </label>
        <select
          id="tv-symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {SYMBOLS.map((s) => (
            <option key={s} value={s}>
              {SYMBOL_DISPLAY_NAMES[s] ?? s}
            </option>
          ))}
        </select>

        <a
          href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Open on TradingView
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* The widget fills whatever is left below the toolbar. */}
      <div ref={containerRef} className="tradingview-widget-container min-h-0 flex-1">
        {!mounted && (
          <div className="flex h-full items-center justify-center text-xs font-mono text-muted-foreground">
            Loading chart...
          </div>
        )}
      </div>
    </div>
  );
}
