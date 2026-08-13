'use client';

import { useMemo, useState } from 'react';

/**
 * Martingale risk calculator.
 *
 * Fully self-contained: no WebSocket, no auth, no shared state. Pure arithmetic
 * on four inputs, so it cannot affect anything else in the app.
 *
 * Deliberately a dark instrument panel in both themes. It reads as a device
 * rather than a page, which suits a tool you consult before committing money,
 * and it borrows the mono/cyan vocabulary Bulk Trader already uses.
 */

/** Defaults mirror the app's own bot: lib/bot-presets.ts ships MARTINGALE 2.1. */
const DEFAULTS = {
  capital: '',
  stakePct: '2',
  multiplier: '2.1',
  payoutPct: '95',
};

const MAX_ROWS = 14;

/** Fixed panel palette. Not theme tokens — this surface stays dark in both modes. */
const C = {
  panel: '#0B1220',
  raised: '#111A2B',
  border: '#1E2D45',
  accent: '#22D3EE',
  text: '#E2ECF7',
  muted: '#7488A3',
  safe: '#00C390',
  danger: '#FF4D6A',
};

interface Rung {
  loss: number;
  stake: number;
  risked: number;
  left: number;
  /** 1-in-N chance of a losing run reaching this depth, at even odds. */
  odds: number;
  underwater: boolean;
}

function money(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RiskCalculator() {
  const [capital, setCapital] = useState(DEFAULTS.capital);
  const [stakePct, setStakePct] = useState(DEFAULTS.stakePct);
  const [multiplier, setMultiplier] = useState(DEFAULTS.multiplier);
  const [payoutPct, setPayoutPct] = useState(DEFAULTS.payoutPct);

  const model = useMemo(() => {
    const cap = parseFloat(capital);
    const pct = parseFloat(stakePct);
    const m = parseFloat(multiplier);
    const p = parseFloat(payoutPct) / 100;

    const valid =
      Number.isFinite(cap) && cap > 0 &&
      Number.isFinite(pct) && pct > 0 &&
      Number.isFinite(m) && Number.isFinite(p) && p > 0;

    if (!valid) return null;

    const base = (cap * pct) / 100;

    // A martingale only recovers if one win covers every prior loss plus the
    // stake itself. That needs m >= 1 + 1/payout — which is exactly why the
    // app's bot ships 2.1 against a ~95% payout.
    const minSafeMultiplier = 1 + 1 / p;

    // m <= 1 is not a martingale at all, so the ladder is meaningless.
    if (m <= 1) {
      return { base, minSafeMultiplier, rungs: [] as Rung[], survives: 0, invalidMultiplier: true };
    }

    const rungs: Rung[] = [];
    let survives = 0;

    for (let n = 1; n <= MAX_ROWS; n++) {
      const stake = base * Math.pow(m, n - 1);
      const risked = base * ((Math.pow(m, n) - 1) / (m - 1));
      const left = cap - risked;
      const underwater = left < 0;

      if (!underwater) survives = n;
      rungs.push({ loss: n, stake, risked, left, odds: Math.pow(2, n), underwater });

      // One row past the wipeout is enough to show where the wall is.
      if (underwater) break;
    }

    return { base, minSafeMultiplier, rungs, survives, invalidMultiplier: false };
  }, [capital, stakePct, multiplier, payoutPct]);

  const cap = parseFloat(capital);
  const m = parseFloat(multiplier);
  const multiplierIsSafe =
    model && !model.invalidMultiplier && m >= model.minSafeMultiplier;

  const fieldStyle = 'w-full rounded-md px-3 py-2.5 text-sm font-mono tabular-nums outline-none transition-shadow';

  return (
    <main className="flex justify-center px-3 py-10 sm:py-14">
      <section
        className="w-full max-w-3xl rounded-2xl border p-5 sm:p-8"
        style={{
          background: C.panel,
          borderColor: C.border,
          boxShadow: `0 0 0 1px rgba(34,211,238,0.06), 0 24px 60px -20px rgba(0,0,0,0.65)`,
        }}
      >
        {/* Title */}
        <header className="text-center">
          <p
            className="text-[10px] font-mono uppercase tracking-[0.35em]"
            style={{ color: C.muted }}
          >
            Position sizing
          </p>
          <h1
            className="mt-2 text-2xl font-bold uppercase tracking-[0.18em] sm:text-3xl"
            style={{ color: C.accent, textShadow: `0 0 24px rgba(34,211,238,0.45)` }}
          >
            Martingale Ladder
          </h1>
          <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed" style={{ color: C.muted }}>
            Set your capital and see how deep a losing run you can absorb before
            the stake outgrows the account.
          </p>
        </header>

        {/* Inputs */}
        <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label
              htmlFor="rc-capital"
              className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{ color: C.muted }}
            >
              Capital
            </label>
            <input
              id="rc-capital"
              type="number"
              inputMode="decimal"
              min={0}
              placeholder="Enter your account balance"
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              className={`${fieldStyle} text-center text-lg`}
              style={{
                background: C.raised,
                color: C.text,
                border: `1px solid ${C.accent}`,
                boxShadow: `0 0 22px rgba(34,211,238,0.22)`,
              }}
            />
          </div>

          {[
            { id: 'rc-stake', label: 'Base stake (% of capital)', value: stakePct, set: setStakePct, step: '0.1' },
            { id: 'rc-mult', label: 'Multiplier on loss', value: multiplier, set: setMultiplier, step: '0.1' },
            { id: 'rc-payout', label: 'Payout (%)', value: payoutPct, set: setPayoutPct, step: '1' },
          ].map((f) => (
            <div key={f.id}>
              <label
                htmlFor={f.id}
                className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.2em]"
                style={{ color: C.muted }}
              >
                {f.label}
              </label>
              <input
                id={f.id}
                type="number"
                inputMode="decimal"
                step={f.step}
                min={0}
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                className={fieldStyle}
                style={{ background: C.raised, color: C.text, border: `1px solid ${C.border}` }}
              />
            </div>
          ))}

          {/* Minimum viable multiplier, derived from the payout beside it. */}
          <div className="flex flex-col justify-end">
            <span
              className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{ color: C.muted }}
            >
              Break-even multiplier
            </span>
            <div
              className="rounded-md px-3 py-2.5 text-sm font-mono tabular-nums"
              style={{
                background: C.raised,
                border: `1px solid ${C.border}`,
                color: model ? (multiplierIsSafe ? C.safe : C.danger) : C.muted,
              }}
            >
              {model && !model.invalidMultiplier ? model.minSafeMultiplier.toFixed(2) : '—'}
              <span className="ml-2 text-[10px]" style={{ color: C.muted }}>
                {model && !model.invalidMultiplier
                  ? multiplierIsSafe
                    ? 'yours recovers'
                    : 'yours falls short'
                  : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Summary */}
        {model && !model.invalidMultiplier && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-lg px-4 py-3" style={{ background: C.raised, border: `1px solid ${C.border}` }}>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em]" style={{ color: C.muted }}>
                Opening stake
              </p>
              <p className="mt-1 text-xl font-mono tabular-nums" style={{ color: C.text }}>
                {money(model.base)}
              </p>
            </div>
            <div className="rounded-lg px-4 py-3" style={{ background: C.raised, border: `1px solid ${C.border}` }}>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em]" style={{ color: C.muted }}>
                Losses absorbed
              </p>
              <p
                className="mt-1 text-xl font-mono tabular-nums"
                style={{ color: model.survives >= 6 ? C.safe : C.danger }}
              >
                {model.survives}
                <span className="ml-2 text-[11px]" style={{ color: C.muted }}>
                  in a row
                </span>
              </p>
            </div>
          </div>
        )}

        {/* Ladder */}
        <div className="mt-7">
          {!model ? (
            <div
              className="rounded-lg px-4 py-12 text-center text-xs font-mono"
              style={{ background: C.raised, border: `1px dashed ${C.border}`, color: C.muted }}
            >
              Enter your capital to build the ladder.
            </div>
          ) : model.invalidMultiplier ? (
            <div
              className="rounded-lg px-4 py-8 text-center text-xs font-mono leading-relaxed"
              style={{ background: C.raised, border: `1px solid ${C.danger}`, color: C.danger }}
            >
              A multiplier of 1 or less never recovers a loss.
              <br />
              Raise it above {model.minSafeMultiplier.toFixed(2)} to break even on a win.
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-[10px] font-mono uppercase tracking-[0.2em]" style={{ color: C.muted }}>
                  Consecutive losses
                </h2>
                <span className="text-[10px] font-mono" style={{ color: C.muted }}>
                  bar = capital consumed
                </span>
              </div>

              <div className="overflow-hidden rounded-lg" style={{ border: `1px solid ${C.border}` }}>
                {/* Column heads */}
                <div
                  className="grid items-center px-3 py-2 text-[10px] font-mono uppercase tracking-[0.15em]"
                  style={{ background: C.raised, color: C.muted, gridTemplateColumns: '2rem 1fr 1fr 1fr 3.5rem' }}
                >
                  <span>#</span>
                  <span className="text-right">Stake</span>
                  <span className="text-right">Risked</span>
                  <span className="text-right">Left</span>
                  <span className="hidden text-right sm:block">Odds</span>
                </div>

                {model.rungs.map((r) => {
                  // Row fills left-to-right with the share of capital already
                  // committed, so the compounding is visible rather than implied.
                  const consumed = Math.min(100, (r.risked / cap) * 100);

                  return (
                    <div
                      key={r.loss}
                      className="grid items-center px-3 py-2.5 text-xs font-mono tabular-nums"
                      style={{
                        gridTemplateColumns: '2rem 1fr 1fr 1fr 3.5rem',
                        borderTop: r.underwater ? `1px solid ${C.danger}` : `1px solid ${C.border}`,
                        background: r.underwater
                          ? 'rgba(255,77,106,0.10)'
                          : `linear-gradient(to right, rgba(255,77,106,0.16) ${consumed}%, transparent ${consumed}%)`,
                        color: r.underwater ? C.danger : C.text,
                      }}
                    >
                      <span style={{ color: r.underwater ? C.danger : C.muted }}>{r.loss}</span>
                      <span className="text-right">{money(r.stake)}</span>
                      <span className="text-right">{money(r.risked)}</span>
                      <span className="text-right" style={{ color: r.underwater ? C.danger : C.safe }}>
                        {r.underwater ? `−${money(Math.abs(r.left))}` : money(r.left)}
                      </span>
                      <span className="hidden text-right sm:block" style={{ color: C.muted }}>
                        1:{r.odds}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="mt-3 text-[11px] leading-relaxed" style={{ color: C.muted }}>
                Odds assume an even chance per trade. Reaching loss {model.survives + 1} is
                unlikely on any given run — but across enough trades it arrives, and that
                is the row that closes the account.
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
