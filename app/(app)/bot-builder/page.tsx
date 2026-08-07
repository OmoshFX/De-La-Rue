'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useRef, useEffect } from 'react';
import { Play, Square, AlertTriangle } from 'lucide-react';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useDigitTicks } from '@/hooks/use-digit-ticks';
import {
  evaluateCondition, describeCondition,
  type ParseResult,
} from '@/lib/bot-strategy';
import type { DerivWS, ProposalResponse, BuyResponse } from '@deriv/core';

// Blockly reaches for `document` at import time, so it can never run on the
// server. Loading it dynamically keeps the rest of the page server-rendered.
const BlocklyWorkspace = dynamic(
  () => import('@/components/custom/blockly-workspace').then((m) => m.BlocklyWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-muted-foreground">
        Loading builder...
      </div>
    ),
  }
);

interface LogEntry {
  id: string;
  time: string;
  text: string;
  type: 'info' | 'win' | 'loss' | 'error';
}

interface Transaction {
  id: number;
  time: string;
  contractType: string;
  stake: number;
  payout: number;
  profit: number;
}

type PanelTab = 'summary' | 'transactions' | 'journal';

/** Subscribe, resolve on the first message `pick` accepts, then unsubscribe. */
function firstResponse<T>(
  ws: DerivWS,
  payload: Record<string, unknown>,
  pick: (data: Record<string, unknown>) => T | null,
  timeoutMs = 15000
): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    let unsub: (() => void) | null = null;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      unsub?.();
      reject(new Error('Request timed out'));
    }, timeoutMs);

    ws.subscribe(payload, (data) => {
      if (done) return;
      const value = pick(data);
      if (value === null) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => unsub?.());
      resolve(value);
    })
      .then((sub) => {
        unsub = sub.unsubscribe;
        if (done) sub.unsubscribe();
      })
      .catch((err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

/** Watch a contract until it settles and report the real profit. */
function awaitSettlement(ws: DerivWS, contractId: number): Promise<number> {
  return firstResponse<number>(
    ws,
    { proposal_open_contract: 1, contract_id: contractId },
    (data) => {
      const c = data.proposal_open_contract as Record<string, unknown> | undefined;
      if (!c) return null;
      const settled =
        Boolean(c.is_sold) || Boolean(c.is_expired) ||
        (typeof c.status === 'string' && c.status !== 'open');
      if (!settled) return null;
      return typeof c.profit === 'string' ? parseFloat(c.profit) : Number(c.profit ?? 0);
    },
    120000
  );
}

export default function BotBuilderPage() {
  const { ws, isConnected, auth } = useDerivWSContext();
  const { authState, activeAccount } = auth;
  const isAuthenticated = authState === 'authenticated';
  const currency = activeAccount?.currency ?? 'USD';

  const [parsed, setParsed] = useState<ParseResult>({ config: null, errors: [] });
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [profit, setProfit] = useState(0);
  const [trades, setTrades] = useState(0);
  const [wins, setWins] = useState(0);
  const [totalStake, setTotalStake] = useState(0);
  const [totalPayout, setTotalPayout] = useState(0);
  const [runs, setRuns] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [tab, setTab] = useState<PanelTab>('summary');

  const runningRef = useRef(false);
  const busyRef = useRef(false);
  const stateRef = useRef({ stake: 0, profit: 0, trades: 0, wins: 0, staked: 0, payout: 0 });

  const config = parsed.config;
  const ticks = useDigitTicks(config?.symbol ?? 'R_100', 1000);

  useEffect(() => () => { runningRef.current = false; }, []);

  const log = useCallback((text: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    setLogs((p) => [{ id: `${Date.now()}${Math.random()}`, time, text, type }, ...p].slice(0, 200));
  }, []);

  const stop = useCallback((reason?: string) => {
    runningRef.current = false;
    setRunning(false);
    if (reason) log(reason, 'info');
    if (ws?.isConnected) ws.send({ forget_all: 'proposal_open_contract' }).catch(() => {});
  }, [ws, log]);

  const start = useCallback(() => {
    if (!config) return;
    if (!ws || !isConnected) { log('Not connected to Deriv yet.', 'error'); return; }
    if (!isAuthenticated) { log('Log in before running a strategy.', 'error'); return; }

    stateRef.current = { stake: config.stake, profit: 0, trades: 0, wins: 0, staked: 0, payout: 0 };
    setProfit(0); setTrades(0); setWins(0);
    setTotalStake(0); setTotalPayout(0); setTransactions([]); setLogs([]);
    setRuns((r) => r + 1);
    runningRef.current = true;
    setRunning(true);
    log(`Running on ${config.symbol} — buying when ${describeCondition(config.condition)}.`);
  }, [config, ws, isConnected, isAuthenticated, log]);

  // Drives the strategy: each new tick re-tests the condition, and a match
  // places one trade. busyRef keeps a slow settlement from stacking trades.
  useEffect(() => {
    if (!running || !config || !ws || busyRef.current) return;
    if (ticks.digits.length === 0) return;

    const digits = ticks.digits.map((d) => d.digit);
    if (!evaluateCondition(config.condition, digits)) return;

    busyRef.current = true;

    (async () => {
      const s = stateRef.current;
      try {
        const payload: Record<string, unknown> = {
          proposal: 1,
          amount: Number(s.stake.toFixed(2)),
          basis: 'stake',
          contract_type: config.contractType,
          currency,
          duration: config.duration,
          duration_unit: 't',
          underlying_symbol: config.symbol,
        };
        if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(config.contractType)) {
          payload.barrier = config.barrier;
        }

        const proposal = await firstResponse(
          ws, payload, (d: Record<string, unknown>) => (d as unknown as ProposalResponse).proposal ?? null
        );
        if (!runningRef.current) return;

        const buy = await ws.send<BuyResponse>({
          buy: proposal.id,
          price: String(proposal.ask_price),
        });
        const contractId = buy.buy?.contract_id;
        if (!contractId) throw new Error('Buy did not return a contract id');

        const stakedNow = Number(s.stake.toFixed(2));
        s.trades += 1;
        s.staked = Math.round((s.staked + stakedNow) * 100) / 100;
        setTrades(s.trades);
        setTotalStake(s.staked);
        log(`Bought ${config.contractType} at ${stakedNow.toFixed(2)} ${currency}`);

        const settled = await awaitSettlement(ws, contractId);
        if (!runningRef.current) return;

        const won = settled > 0;
        // Payout is what came back, so a loss returns nothing rather than a
        // negative — that keeps "total payout" comparable to total stake.
        const payoutNow = won ? Math.round((stakedNow + settled) * 100) / 100 : 0;
        s.payout = Math.round((s.payout + payoutNow) * 100) / 100;
        setTotalPayout(s.payout);
        setTransactions((prev) => [
          {
            id: contractId,
            time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
            contractType: config.contractType,
            stake: stakedNow,
            payout: payoutNow,
            profit: settled,
          },
          ...prev,
        ].slice(0, 200));
        s.profit = Math.round((s.profit + settled) * 100) / 100;
        if (won) s.wins += 1;
        setProfit(s.profit);
        setWins(s.wins);
        log(
          `${won ? 'Won' : 'Lost'} ${settled >= 0 ? '+' : ''}${settled.toFixed(2)} — total ${s.profit.toFixed(2)}`,
          won ? 'win' : 'loss'
        );

        s.stake = won ? config.stake : Math.round(s.stake * config.martingale * 100) / 100;

        if (config.takeProfit > 0 && s.profit >= config.takeProfit) {
          stop('Take profit reached.'); return;
        }
        if (config.stopLoss > 0 && s.profit <= -Math.abs(config.stopLoss)) {
          stop('Stop loss reached.'); return;
        }
        if (s.trades >= config.maxTrades) {
          stop('Maximum trades reached.'); return;
        }
      } catch (err) {
        if (!runningRef.current) return;
        log(err instanceof Error ? err.message : 'Trade failed', 'error');
        stop();
      } finally {
        busyRef.current = false;
      }
    })();
  }, [ticks.digits, running, config, ws, currency, log, stop]);

  const blockers: string[] = [];
  if (!isAuthenticated) blockers.push('Log in to run a strategy.');
  if (!config) blockers.push('The strategy is incomplete.');

  return (
    <div className="flex flex-col gap-4 p-4 lg:h-[calc(100dvh-7.5rem)] lg:flex-row">
      <div className="min-h-[460px] flex-1 overflow-hidden rounded-xl border bg-background">
        <BlocklyWorkspace onChange={setParsed} />
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
        <div className="rounded-xl border bg-background p-4">
          <h2 className="text-sm font-semibold">Strategy</h2>
          {config ? (
            <dl className="mt-3 space-y-1.5 text-sm">
              {([
                ['Market', config.symbol],
                ['Contract', config.contractType],
                ['Stake', `${config.stake} ${currency}`],
                ['Buy when', describeCondition(config.condition)],
                ['Take profit', config.takeProfit || '\u2014'],
                ['Stop loss', config.stopLoss || '\u2014'],
                ['On loss', config.martingale > 1 ? `\u00d7${config.martingale}` : 'keep stake'],
              ] as [string, string | number][]).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Drag blocks onto the canvas to build a strategy.
            </p>
          )}

          {parsed.errors.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t pt-3">
              {parsed.errors.map((error) => (
                <li key={error} className="flex gap-2 text-xs text-amber-700 dark:text-amber-500">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-h-[320px] flex-1 flex-col rounded-xl border bg-background">
          <div className="flex border-b">
            {(['summary', 'transactions', 'journal'] as PanelTab[]).map((name) => (
              <button
                key={name}
                onClick={() => setTab(name)}
                className={`flex-1 px-3 py-2.5 text-sm capitalize transition-colors ${
                  tab === name
                    ? 'border-b-2 border-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {tab === 'summary' && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {([
                  ['Total stake', `${totalStake.toFixed(2)} ${currency}`],
                  ['Total payout', `${totalPayout.toFixed(2)} ${currency}`],
                  ['No. of runs', String(runs)],
                  ['Contracts won', String(wins)],
                  ['Contracts lost', String(trades - wins)],
                  ['Win rate', trades > 0 ? `${Math.round((wins / trades) * 100)}%` : '\u2014'],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
                    <p className="mt-0.5 tabular-nums text-sm font-semibold">{value}</p>
                  </div>
                ))}
                <div className="col-span-2 border-t pt-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Total profit / loss
                  </p>
                  <p
                    className={`mt-0.5 tabular-nums text-xl font-semibold ${
                      profit > 0 ? 'text-emerald-600 dark:text-emerald-400'
                      : profit < 0 ? 'text-red-600 dark:text-red-400'
                      : ''
                    }`}
                  >
                    {profit >= 0 ? '+' : ''}{profit.toFixed(2)} {currency}
                  </p>
                </div>
              </div>
            )}

            {tab === 'transactions' && (
              transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No trades yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Time</th>
                      <th className="pb-2 font-medium">Type</th>
                      <th className="pb-2 text-right font-medium">Stake</th>
                      <th className="pb-2 text-right font-medium">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id} className="border-t">
                        <td className="py-1.5 tabular-nums text-muted-foreground">{t.time}</td>
                        <td className="py-1.5">{t.contractType.replace('DIGIT', '')}</td>
                        <td className="py-1.5 text-right tabular-nums">{t.stake.toFixed(2)}</td>
                        <td
                          className={`py-1.5 text-right tabular-nums font-medium ${
                            t.profit > 0 ? 'text-emerald-600 dark:text-emerald-400'
                                         : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {t.profit >= 0 ? '+' : ''}{t.profit.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}

            {tab === 'journal' && (
              <div className="space-y-1 text-xs">
                {logs.length === 0 ? (
                  <p className="text-muted-foreground">Nothing yet.</p>
                ) : (
                  logs.map((entry) => (
                    <p
                      key={entry.id}
                      className={
                        entry.type === 'win' ? 'text-emerald-600 dark:text-emerald-400'
                        : entry.type === 'loss' ? 'text-red-600 dark:text-red-400'
                        : entry.type === 'error' ? 'text-destructive'
                        : 'text-muted-foreground'
                      }
                    >
                      <span className="tabular-nums opacity-60">{entry.time}</span> {entry.text}
                    </p>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="border-t p-4">
            {running ? (
              <button
                onClick={() => stop('Stopped.')}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-destructive px-4 py-2.5 text-sm font-medium text-destructive-foreground"
              >
                <Square className="h-4 w-4" /> Stop
              </button>
            ) : (
              <button
                onClick={start}
                disabled={blockers.length > 0}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:opacity-40"
              >
                <Play className="h-4 w-4" /> Run
              </button>
            )}
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {running ? 'Bot is running' : blockers[0] ?? 'Bot is not running'}
            </p>
            {activeAccount?.account_type === 'real' && (
              <p className="mt-1 text-center text-xs font-medium text-destructive">
                Real account &mdash; trades use real money.
              </p>
            )}
          </div>
        </div>

      </aside>
    </div>
  );
}
