'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DerivWS, getWebSocketOTP, getAuthInfo } from '@deriv/core';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { getLastDigit } from '@/lib/digit-stats';
import { SYMBOL_DISPLAY_NAMES } from '@/lib/active-symbols-display-names';
import { cn } from '@/lib/utils';

/**
 * Three-stage cycle bot.
 *
 * Stage 1  a run of N identical digits -> one DIGITDIFF on that digit
 * Stage 2  a parity streak of S -> trade the opposite, martingale until a win
 * Stage 3  L digits on the wrong side of a barrier -> one OVER/UNDER
 * then back to stage 1.
 *
 * Scanning runs on its own public DerivWS, so it works logged out and cannot
 * disturb the shared provider socket or the single-symbol Bulk Trader bot.
 * Buying opens a separate authenticated socket, and only in live mode.
 *
 * Two limits bound the downside, because stage 2 cannot advance until it wins:
 *   - ladder cap: after N consecutive losses, reset the stake and move on
 *   - session loss limit: total loss at which the bot stops itself
 *
 * Paper mode is the default. It runs identical scanning and staking and
 * settles against the next real tick, but places no orders.
 */

const SYMBOLS = [
  'R_100', '1HZ100V',
  'R_75', '1HZ75V',
  'R_50', '1HZ50V',
  'R_25', '1HZ25V',
  'R_10', '1HZ10V',
];

/** Enough history for the longest lookback any stage uses. */
const HISTORY = 40;

type Stage = 1 | 2 | 3;
type Status = 'idle' | 'scanning' | 'stopped';

interface LogRow {
  id: number;
  time: string;
  stage: Stage;
  text: string;
  kind: 'info' | 'win' | 'loss' | 'stop';
}

interface Pending {
  symbol: string;
  stage: Stage;
  kind: 'differs' | 'parity' | 'under' | 'over';
  param: number | 'even' | 'odd';
  stake: number;
}

interface Config {
  runLen: number;
  watch: number[];
  streak: number;
  barrier: number;
  direction: 'under' | 'over';
  lookback: number;
  martingale: number;
  base: number;
  ladderCap: number;
  sessionLoss: number;
  paper: boolean;
}

const DEFAULTS: Config = {
  runLen: 4,
  watch: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  streak: 5,
  barrier: 8,
  direction: 'under',
  lookback: 5,
  martingale: 2.1,
  base: 1,
  ladderCap: 6,
  sessionLoss: 50,
  paper: true,
};

/** True win probability, used for paper P&L at Deriv's approximate payouts. */
function winProb(kind: Pending['kind'], param: Pending['param']): number {
  if (kind === 'differs') return 0.9;
  if (kind === 'parity') return 0.5;
  if (kind === 'under') return (param as number) / 10;
  return (9 - (param as number)) / 10;
}

/** Approximate payout multiple. Paper mode only; live mode uses real profit. */
function paperPayout(kind: Pending['kind'], param: Pending['param']): number {
  const edge = kind === 'parity' ? 0.025 : 0.04;
  return (1 / winProb(kind, param)) * (1 - edge);
}

export function CycleBot() {
  const { auth } = useDerivWSContext();
  const { authState, accounts, activeAccount } = auth;

  const [cfg, setCfg] = useState<Config>(DEFAULTS);
  const [status, setStatus] = useState<Status>('idle');
  const [stage, setStage] = useState<Stage>(1);
  const [depth, setDepth] = useState(0);
  const [pnl, setPnl] = useState(0);
  const [trades, setTrades] = useState(0);
  const [wins, setWins] = useState(0);
  const [log, setLog] = useState<LogRow[]>([]);
  const [digits, setDigits] = useState<Record<string, number[]>>({});
  const [error, setError] = useState<string | null>(null);

  const digitsRef = useRef<Record<string, number[]>>({});
  const cfgRef = useRef(cfg);
  const runningRef = useRef(false);
  const stageRef = useRef<Stage>(1);
  const depthRef = useRef(0);
  const pnlRef = useRef(0);
  const pendingRef = useRef<Pending | null>(null);
  const logIdRef = useRef(0);
  const scanWsRef = useRef<DerivWS | null>(null);
  const tradeWsRef = useRef<WebSocket | null>(null);
  const tradeQueueRef = useRef<Array<(d: Record<string, unknown>) => void>>([]);

  useEffect(() => { cfgRef.current = cfg; }, [cfg]);

  const addLog = useCallback((text: string, kind: LogRow['kind'], atStage: Stage) => {
    setLog((prev) => [
      { id: ++logIdRef.current, time: new Date().toLocaleTimeString(), stage: atStage, text, kind },
      ...prev,
    ].slice(0, 200));
  }, []);

  // ─── Live trading socket ──────────────────────────────────────────────────

  const openTradeSocket = useCallback(async (): Promise<WebSocket> => {
    const account = accounts.find((a) => a.account_id === activeAccount?.account_id) ?? accounts[0];
    if (!account) throw new Error('No account available.');

    const url = await getWebSocketOTP(
      account.account_id,
      getAuthInfo()!,
      process.env.NEXT_PUBLIC_DERIV_APP_ID ?? ''
    );

    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not open the trading connection.'));
    });

    ws.onmessage = (ev) => {
      let data: Record<string, unknown>;
      try { data = JSON.parse(ev.data); } catch { return; }
      const next = tradeQueueRef.current.shift();
      if (next) next(data);
    };

    return ws;
  }, [accounts, activeAccount]);

  const tradeSend = useCallback((payload: object): Promise<Record<string, unknown>> => {
    return new Promise((resolve) => {
      tradeQueueRef.current.push(resolve);
      tradeWsRef.current?.send(JSON.stringify(payload));
    });
  }, []);

  /** Proposal then buy. Returns realised profit once the contract settles. */
  const placeLiveTrade = useCallback(async (p: Pending): Promise<number> => {
    const contractType =
      p.kind === 'differs' ? 'DIGITDIFF'
      : p.kind === 'parity' ? (p.param === 'even' ? 'DIGITEVEN' : 'DIGITODD')
      : p.kind === 'under' ? 'DIGITUNDER' : 'DIGITOVER';

    const needsBarrier = p.kind !== 'parity';
    const currency = activeAccount?.currency ?? 'USD';

    const proposal = await tradeSend({
      proposal: 1,
      amount: p.stake,
      basis: 'stake',
      contract_type: contractType,
      currency,
      duration: 1,
      duration_unit: 't',
      underlying_symbol: p.symbol,
      ...(needsBarrier ? { barrier: String(p.param) } : {}),
    }) as { proposal?: { id?: string }; error?: { message?: string } };

    if (proposal.error) throw new Error(proposal.error.message ?? 'Proposal rejected.');
    const id = proposal.proposal?.id;
    if (!id) throw new Error('No proposal id returned.');

    const bought = await tradeSend({ buy: id, price: p.stake }) as {
      buy?: { contract_id?: number };
      error?: { message?: string };
    };
    if (bought.error) throw new Error(bought.error.message ?? 'Buy rejected.');
    const contractId = bought.buy?.contract_id;
    if (!contractId) throw new Error('No contract id returned.');

    // Read the settled profit from Deriv rather than inferring it from a
    // balance diff, which cannot tell a settled contract from a slow one.
    const settled = await tradeSend({
      proposal_open_contract: 1,
      contract_id: contractId,
    }) as { proposal_open_contract?: { profit?: string | number } };

    return Number(settled.proposal_open_contract?.profit ?? 0);
  }, [tradeSend, activeAccount]);

  // ─── Settlement ───────────────────────────────────────────────────────────

  const settlePaper = useCallback((p: Pending, digit: number): number => {
    let won: boolean;
    if (p.kind === 'differs') won = digit !== p.param;
    else if (p.kind === 'parity') won = (digit % 2 === 0) === (p.param === 'even');
    else if (p.kind === 'under') won = digit < (p.param as number);
    else won = digit > (p.param as number);

    return won ? p.stake * (paperPayout(p.kind, p.param) - 1) : -p.stake;
  }, []);

  const stopBot = useCallback((reason: string) => {
    runningRef.current = false;
    pendingRef.current = null;
    setStatus('stopped');
    addLog(reason, 'stop', stageRef.current);
    tradeWsRef.current?.close();
    tradeWsRef.current = null;
  }, [addLog]);

  const applyResult = useCallback((p: Pending, profit: number) => {
    const c = cfgRef.current;
    const won = profit > 0;

    pnlRef.current = Math.round((pnlRef.current + profit) * 100) / 100;
    setPnl(pnlRef.current);
    setTrades((t) => t + 1);
    if (won) setWins((w) => w + 1);

    addLog(
      `${p.kind.toUpperCase()} ${String(p.param)} on ${SYMBOL_DISPLAY_NAMES[p.symbol] ?? p.symbol} ` +
      `@ ${p.stake.toFixed(2)} -> ${won ? 'win' : 'loss'} ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`,
      won ? 'win' : 'loss',
      p.stage
    );

    // Session limit first: it outranks everything, including an open ladder.
    if (pnlRef.current <= -Math.abs(c.sessionLoss)) {
      stopBot(`Session loss limit reached at ${pnlRef.current.toFixed(2)}. Bot stopped.`);
      return;
    }

    if (p.stage === 1) {
      stageRef.current = 2;
      setStage(2);
    } else if (p.stage === 2) {
      if (won) {
        depthRef.current = 0;
        setDepth(0);
        stageRef.current = 3;
        setStage(3);
      } else {
        depthRef.current += 1;
        setDepth(depthRef.current);
        if (depthRef.current >= c.ladderCap) {
          addLog(
            `Ladder cap ${c.ladderCap} hit. Stake reset, moving to stage 3.`,
            'stop',
            2
          );
          depthRef.current = 0;
          setDepth(0);
          stageRef.current = 3;
          setStage(3);
        }
      }
    } else {
      stageRef.current = 1;
      setStage(1);
    }
  }, [addLog, stopBot]);

  // ─── Trigger evaluation ───────────────────────────────────────────────────

  const evaluate = useCallback((symbol: string): Pending | null => {
    const c = cfgRef.current;
    const d = digitsRef.current[symbol] ?? [];
    const n = d.length;
    const at = (back: number) => d[n - 1 - back];

    if (stageRef.current === 1) {
      if (n < c.runLen) return null;
      const target = at(0);
      if (!c.watch.includes(target)) return null;
      for (let k = 1; k < c.runLen; k++) if (at(k) !== target) return null;
      return { symbol, stage: 1, kind: 'differs', param: target, stake: c.base };
    }

    if (stageRef.current === 2) {
      if (n < c.streak) return null;
      const parity = at(0) % 2 === 0 ? 'even' : 'odd';
      for (let k = 1; k < c.streak; k++) {
        const p = at(k) % 2 === 0 ? 'even' : 'odd';
        if (p !== parity) return null;
      }
      const stake = Math.round(c.base * Math.pow(c.martingale, depthRef.current) * 100) / 100;
      return { symbol, stage: 2, kind: 'parity', param: parity === 'even' ? 'odd' : 'even', stake };
    }

    if (n < c.lookback) return null;
    for (let k = 0; k < c.lookback; k++) {
      const v = at(k);
      const wrongSide = c.direction === 'under' ? v >= c.barrier : v <= c.barrier;
      if (!wrongSide) return null;
    }
    return { symbol, stage: 3, kind: c.direction, param: c.barrier, stake: c.base };
  }, []);

  // ─── Tick handling ────────────────────────────────────────────────────────

  const onTick = useCallback(async (symbol: string, quote: number, pip: number) => {
    const digit = getLastDigit(quote, pip);
    const prev = digitsRef.current[symbol] ?? [];
    const next = [...prev, digit].slice(-HISTORY);
    digitsRef.current[symbol] = next;
    setDigits((s) => ({ ...s, [symbol]: next }));

    if (!runningRef.current) return;

    // A pending paper trade settles on the next tick of its own symbol.
    const pending = pendingRef.current;
    if (pending) {
      if (cfgRef.current.paper && pending.symbol === symbol) {
        pendingRef.current = null;
        applyResult(pending, settlePaper(pending, digit));
      }
      return;
    }

    const trigger = evaluate(symbol);
    if (!trigger) return;

    pendingRef.current = trigger;
    addLog(
      `Stage ${trigger.stage}: ${trigger.kind} ${String(trigger.param)} on ` +
      `${SYMBOL_DISPLAY_NAMES[symbol] ?? symbol} @ ${trigger.stake.toFixed(2)}`,
      'info',
      trigger.stage
    );

    if (cfgRef.current.paper) return; // settles on the next tick above

    try {
      const profit = await placeLiveTrade(trigger);
      pendingRef.current = null;
      applyResult(trigger, profit);
    } catch (err) {
      pendingRef.current = null;
      stopBot(`Trade failed: ${(err as Error).message}`);
    }
  }, [addLog, applyResult, evaluate, placeLiveTrade, settlePaper, stopBot]);

  // The socket effect must mount once and stay. Depending on onTick directly
  // would tear the connection down every time the callback's identity changed
  // (auth resolving, React's dev double-mount), and the cleanup's disconnect
  // rejects the in-flight connect promise — which looked like a feed failure.
  const onTickRef = useRef(onTick);
  useEffect(() => { onTickRef.current = onTick; }, [onTick]);

  // ─── Scanning socket ──────────────────────────────────────────────────────

  useEffect(() => {
    const ws = new DerivWS();
    scanWsRef.current = ws;
    let disposed = false;
    const unsubs: Array<() => void> = [];

    const load = async () => {
      for (const symbol of SYMBOLS) {
        const hist = await ws.send<{ history?: { prices: number[] }; pip_size?: number }>({
          ticks_history: symbol,
          end: 'latest',
          start: 1,
          count: HISTORY,
          style: 'ticks',
        });
        if (disposed) return;

        const prices = hist.history?.prices ?? [];
        const pip = hist.pip_size ?? 2;
        const seed = prices.map((p) => getLastDigit(p, pip));
        digitsRef.current[symbol] = seed;
        setDigits((s) => ({ ...s, [symbol]: seed }));

        const sub = await ws.subscribe({ ticks: symbol }, (raw) => {
          const tick = (raw as { tick?: { quote: number; pip_size?: number } }).tick;
          if (!tick) return;
          void onTickRef.current(symbol, tick.quote, tick.pip_size ?? pip);
        });
        if (disposed) { sub.unsubscribe(); return; }
        unsubs.push(sub.unsubscribe);
      }
    };

    const off = ws.onConnectionStateChange((connected) => {
      if (disposed) return;
      if (connected) {
        // Clear any error from a previous attempt, including the aborted
        // first mount in development.
        setError(null);
        load().catch(() => {
          if (!disposed) setError('Could not load tick history.');
        });
      }
    });

    ws.connect().catch(() => {
      if (!disposed) setError('Could not connect to the tick feed.');
    });

    return () => {
      disposed = true;
      off();
      unsubs.forEach((u) => u());
      ws.disconnect();
    };
  }, []);

  // ─── Controls ─────────────────────────────────────────────────────────────

  const start = async () => {
    setError(null);
    if (!cfg.paper && authState !== 'authenticated') {
      setError('Log in before running in live mode.');
      return;
    }

    if (!cfg.paper) {
      try {
        tradeWsRef.current = await openTradeSocket();
      } catch (err) {
        setError((err as Error).message);
        return;
      }
    }

    pnlRef.current = 0;
    depthRef.current = 0;
    stageRef.current = 1;
    pendingRef.current = null;
    setPnl(0); setDepth(0); setStage(1); setTrades(0); setWins(0); setLog([]);
    runningRef.current = true;
    setStatus('scanning');
    addLog(cfg.paper ? 'Started in paper mode. No orders will be placed.' : 'Started in LIVE mode.', 'info', 1);
  };

  const stop = () => stopBot('Stopped by user.');

  useEffect(() => () => { tradeWsRef.current?.close(); }, []);

  // ─── UI ───────────────────────────────────────────────────────────────────

  const running = status === 'scanning';
  const worstCase = cfg.base * ((Math.pow(cfg.martingale, cfg.ladderCap) - 1) / (cfg.martingale - 1));
  const numCls = 'w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-ring';
  const lbl = 'mb-1 block text-[10px] font-mono uppercase tracking-widest text-muted-foreground';

  return (
    <div className="w-full max-w-5xl mx-auto px-3 py-4">
      {/* Mode */}
      <div className={cn(
        'mb-4 flex flex-wrap items-center gap-3 rounded-lg border p-3',
        cfg.paper ? 'border-border bg-card' : 'border-sell-background bg-sell-background/10'
      )}>
        <button
          onClick={() => !running && setCfg({ ...cfg, paper: !cfg.paper })}
          disabled={running}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-mono uppercase tracking-widest transition-colors disabled:opacity-50',
            cfg.paper ? 'bg-buy-background text-buy-foreground' : 'bg-sell-background text-sell-foreground'
          )}
        >
          {cfg.paper ? 'Paper' : 'Live'}
        </button>
        <span className="text-xs text-muted-foreground">
          {cfg.paper
            ? 'Scanning and staking run for real; no orders are placed.'
            : 'Real orders on your account. Worst case per ladder: ' + worstCase.toFixed(2) + '.'}
        </span>
      </div>

      {/* Config */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><span className={lbl}>Run length</span>
            <input type="number" min={2} max={8} value={cfg.runLen} disabled={running}
              onChange={(e) => setCfg({ ...cfg, runLen: Number(e.target.value) })} className={numCls} /></div>
          <div><span className={lbl}>Parity streak</span>
            <input type="number" min={2} max={12} value={cfg.streak} disabled={running}
              onChange={(e) => setCfg({ ...cfg, streak: Number(e.target.value) })} className={numCls} /></div>
          <div><span className={lbl}>Direction</span>
            <select value={cfg.direction} disabled={running}
              onChange={(e) => setCfg({ ...cfg, direction: e.target.value as 'under' | 'over' })}
              className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              <option value="under">Under</option><option value="over">Over</option></select></div>
          <div><span className={lbl}>Barrier</span>
            <input type="number" min={0} max={9} value={cfg.barrier} disabled={running}
              onChange={(e) => setCfg({ ...cfg, barrier: Number(e.target.value) })} className={numCls} /></div>
          <div><span className={lbl}>Lookback</span>
            <input type="number" min={1} max={10} value={cfg.lookback} disabled={running}
              onChange={(e) => setCfg({ ...cfg, lookback: Number(e.target.value) })} className={numCls} /></div>
          <div><span className={lbl}>Base stake</span>
            <input type="number" min={0.35} step={0.01} value={cfg.base} disabled={running}
              onChange={(e) => setCfg({ ...cfg, base: Number(e.target.value) })} className={numCls} /></div>
          <div><span className={lbl}>Martingale</span>
            <input type="number" min={1} step={0.1} value={cfg.martingale} disabled={running}
              onChange={(e) => setCfg({ ...cfg, martingale: Number(e.target.value) })} className={numCls} /></div>
          <div><span className={lbl}>Ladder cap</span>
            <input type="number" min={1} max={15} value={cfg.ladderCap} disabled={running}
              onChange={(e) => setCfg({ ...cfg, ladderCap: Number(e.target.value) })} className={numCls} /></div>
          <div><span className={lbl}>Session loss limit</span>
            <input type="number" min={1} value={cfg.sessionLoss} disabled={running}
              onChange={(e) => setCfg({ ...cfg, sessionLoss: Number(e.target.value) })} className={numCls} /></div>
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          A full ladder to the cap commits {worstCase.toFixed(2)} in total, with a largest
          single stake of {(cfg.base * Math.pow(cfg.martingale, cfg.ladderCap - 1)).toFixed(2)}.
        </p>

        <div className="mt-4 flex items-center gap-3">
          {!running ? (
            <button onClick={start}
              className="rounded-md bg-buy-background px-5 py-2 text-sm font-medium text-buy-foreground">
              Start
            </button>
          ) : (
            <button onClick={stop}
              className="rounded-md bg-sell-background px-5 py-2 text-sm font-medium text-sell-foreground">
              Stop
            </button>
          )}
          {error && <span className="text-xs text-sell-background">{error}</span>}
        </div>
      </div>

      {/* Status */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { k: 'Stage', v: running ? String(stage) : '-' },
          { k: 'Ladder', v: `${depth}/${cfg.ladderCap}` },
          { k: 'Trades', v: String(trades) },
          { k: 'Wins', v: trades > 0 ? `${((wins / trades) * 100).toFixed(0)}%` : '-' },
          { k: 'P&L', v: pnl.toFixed(2) },
        ].map((s) => (
          <div key={s.k} className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{s.k}</p>
            <p className={cn('mt-0.5 font-mono text-lg tabular-nums',
              s.k === 'P&L' && pnl > 0 && 'text-buy-background',
              s.k === 'P&L' && pnl < 0 && 'text-sell-background')}>{s.v}</p>
          </div>
        ))}
      </div>

      {/* Log */}
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border bg-card px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Activity
        </div>
        <div className="max-h-80 overflow-y-auto">
          {log.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              Not started. Paper mode places no orders.
            </p>
          ) : log.map((r) => (
            <div key={r.id} className="flex gap-3 border-b border-border px-3 py-1.5 text-xs last:border-0">
              <span className="shrink-0 font-mono text-muted-foreground">{r.time}</span>
              <span className={cn('shrink-0 font-mono', 'text-muted-foreground')}>S{r.stage}</span>
              <span className={cn(
                r.kind === 'win' && 'text-buy-background',
                r.kind === 'loss' && 'text-sell-background',
                r.kind === 'stop' && 'font-medium'
              )}>{r.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
