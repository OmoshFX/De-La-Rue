'use client';

import { Bot } from 'lucide-react';
import { STRATEGIES, type Risk } from '@/lib/strategies';

/**
 * Trading Bots — the strategy library.
 *
 * Each card is a saved Bot Builder strategy. Loading one hands it to the Bot
 * Builder with its blocks already in place, ready to run.
 *
 * The page is driven entirely by STRATEGIES in lib/strategies.ts; adding or
 * removing a bot never touches this file.
 */

/**
 * Risk is the one thing on a card worth colouring.
 *
 * It is the only field that should change someone's mind before they press
 * Load Bot, so it gets the same badge treatment as the demo/real marker on the
 * dashboard. Everything else on the card stays quiet.
 */
const RISK_STYLES: Record<Risk, string> = {
  low: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-orange-100 text-orange-700',
  high: 'bg-red-100 text-red-700',
};

export default function TradingBotsPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <div className="text-center">
        <h1 className="text-2xl font-semibold sm:text-3xl">Trading bots</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Load a saved strategy into the Bot Builder, then run it from there.
        </p>
      </div>

      {STRATEGIES.length === 0 ? (
        // An empty library should say what to do about it rather than sit blank.
        <div className="mt-12 rounded-xl border border-dashed bg-background p-10 text-center">
          <Bot className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-4 text-sm font-medium">No strategies yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Build one in the Bot Builder, save it, then add the exported file to
            the catalogue.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-12 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Strategies
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STRATEGIES.map(strategy => (
              <div
                key={strategy.id}
                // Column so the button can be pushed to the bottom with mt-auto,
                // keeping every button on a row aligned however long the
                // summaries run.
                className="flex flex-col rounded-xl border bg-background p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{strategy.name}</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      RISK_STYLES[strategy.risk]
                    }`}
                  >
                    {strategy.risk} risk
                  </span>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {strategy.summary}
                </p>

                {/* Market and trade type: the two facts that decide whether a
                    strategy is relevant at all.

                    mt-auto sits here rather than on the button so the gap opens
                    above this block. A summary that runs long pushes the card
                    taller and every button on the row still lines up. */}
                <dl className="mt-auto space-y-1 pt-4 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Market</dt>
                    <dd className="text-right">{strategy.market}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Trade type</dt>
                    <dd className="text-right">{strategy.tradeType}</dd>
                  </div>
                </dl>

                <button
                  type="button"
                  // TODO: hand off to the Bot Builder. Blocked on choosing
                  // between driving the bot's file input from outside and
                  // patching a postMessage listener into its source. Disabled
                  // rather than silently inert so nobody presses it expecting
                  // something to happen.
                  disabled
                  className="mt-5 w-full rounded-lg border bg-background px-4 py-2 text-sm font-medium transition-colors hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Load Bot
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
