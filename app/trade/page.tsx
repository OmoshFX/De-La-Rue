'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { useDigitsTrading } from '@/hooks/use-digits-trading';
import { Header } from '@/components/custom/header';
import { ThemeToggle } from '@/components/custom/theme-toggle';
import { Footer } from '@/components/custom/footer';
import Link from 'next/link';
import { getWebSocketOTP, getAuthInfo } from '@deriv/core';

// ─── Types ───────────────────────────────────────────────────────────────────

type BotStatus = 'idle' | 'connecting' | 'running' | 'stopped';

interface LogEntry {
  id: number;
  time: string;
  text: string;
  type: 'info' | 'win' | 'loss' | 'error';
}

interface BotStats {
  balance: string;
  currency: string;
  pnl: number;
  trades: number;
  wins: number;
}

interface DigitHistoryItem {
  digit: number;
  isEven: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';

const SYMBOLS = [
  { value: 'R_100', label: 'Volatility 100' },
  { value: 'R_75', label: 'Volatility 75' },
  { value: 'R_50', label: 'Volatility 50' },
  { value: 'R_25', label: 'Volatility 25' },
  { value: 'R_10', label: 'Volatility 10' },
  { value: '1HZ100V', label: 'Volatility 100 (1s)' },
  { value: '1HZ10V', label: 'Volatility 10 (1s)' },
];

// ─── Bot Logic (runs in-browser via Deriv WS) ────────────────────────────────

class DerivBotClient {
  private ws: WebSocket | null = null;
  private running = false;
  private onMessage: (msg: object) => void;

  constructor(onMessage: (msg: object) => void) {
    this.onMessage = onMessage;
  }

  private emit(msg: object) {
    this.onMessage(msg);
  }

  private messageQueue: ((data: any) => void)[] = [];

  private setupMessageRouter() {
    this.ws!.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      // Ticks go to the tick handler, everything else to the queue
      if ('tick' in data) {
        this.tickHandler?.(data);
        return;
      }
      // Skip pure subscription confirmations
      if ('subscription' in data && !('balance' in data) && !('buy' in data)) {
        return;
      }
      const resolver = this.messageQueue.shift();
      if (resolver) resolver(data);
    };
  }

  private tickHandler: ((data: any) => void) | null = null;

  private async sendAndReceive(msg: object): Promise<object> {
    return new Promise((resolve) => {
      this.messageQueue.push(resolve);
      this.ws?.send(JSON.stringify(msg));
    });
  }

  async start(config: {
    api_token: string;
    symbol: string;
    mode: string;
    barrier: number;
    stake: number;
    take_profit: number;
    stop_loss: number;
  }) {
    if (this.running) return;
    this.running = true;

    const {
      api_token, symbol, mode, barrier,
      stake: initialStake, take_profit, stop_loss,
    } = config;

    try {
      this.ws = new WebSocket(api_token);

      await new Promise<void>((resolve, reject) => {
        this.ws!.onopen = () => resolve();
        this.ws!.onerror = () => reject(new Error('WebSocket connection failed'));
      });

      this.emit({ type: 'status', status: 'connecting' });

      // Setup message router
      this.setupMessageRouter();

      // Get balance
      const balResp: any = await this.sendAndReceive({ balance: 1, subscribe: 0 });
      const balance = balResp.balance.balance;
      const currency = balResp.balance.currency;

      this.emit({ type: 'status', status: 'running', balance, currency });

      // Determine contract types
      let contractTypes: string[];
      if (mode === 'EVEN_ODD') {
        contractTypes = ['DIGITEVEN', 'DIGITODD'];
      } else {
        contractTypes = [`DIGITOVER ${barrier}`, `DIGITUNDER ${barrier}`];
      }

      let tradeTypeIndex = 0;
      let stake = initialStake;
      let totalProfit = 0;
      let tradeCount = 0;
      let wins = 0;
      let referenceBalance = balance;
      let firstTick = true;
      let pendingTrade = false;
      let pendingContractId: string | null = null;

      // Subscribe to ticks
      this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));

      const placeTrade = async (tradeType: string, tradeStake: number) => {
        // For OVER/UNDER we need the barrier
        const contractType = tradeType;

        const tradeMsg: any = {
          buy: 1,
          price: tradeStake,
          parameters: {
            amount: tradeStake,
            basis: 'stake',
            contract_type: contractType,
            currency,
            duration: 1,
            duration_unit: 't',
            symbol,
          },
        };

        

        const resp: any = await this.sendAndReceive(tradeMsg);
        if ('buy' in resp) {
          return { contractId: resp.buy.contract_id, error: null };
        } else {
          return { contractId: null, error: resp.error?.message ?? 'Unknown error' };
        }
      };

      const getLastProfit = async (): Promise<{ profit: number | null; newBalance: number | null }> => {
        const resp: any = await this.sendAndReceive({
          statement: 1,
          description: 1,
          limit: 1,
          offset: 0,
          action_type: 'sell',
        });
        const txns = resp?.statement?.transactions ?? [];
        if (!txns.length) return { profit: null, newBalance: null };
        const balanceAfter = txns[0].balance_after ?? referenceBalance;
        return {
          profit: Math.round((balanceAfter - referenceBalance) * 100) / 100,
          newBalance: balanceAfter,
        };
      };

      // Main tick loop
      await new Promise<void>((resolve) => {
        this.tickHandler = async (data: any) => {
          if (!this.running) { resolve(); return; }

          const quote = data.tick.quote;
          const lastDigit = parseInt(String(quote).replace('.', '').slice(-1), 10);

          this.emit({ type: 'tick', quote, last_digit: lastDigit });

          if (firstTick) {
            firstTick = false;
            const tradeType = contractTypes[tradeTypeIndex];
            const { contractId, error } = await placeTrade(tradeType, stake);
            if (error) {
              this.emit({ type: 'error', message: error });
              this.running = false; resolve(); return;
            }
            pendingTrade = true;
            pendingContractId = contractId;
            tradeCount++;
            this.emit({ type: 'trade', contract_id: contractId, trade_type: tradeType, stake, status: 'placed' });
            return;
          }

          if (pendingTrade) {
            const { profit, newBalance } = await getLastProfit();
            if (profit === null) return; // Wait another tick

            const won = profit > 0;
            totalProfit = Math.round((totalProfit + profit) * 100) / 100;
            if (won) wins++;
            referenceBalance = newBalance!;
            pendingTrade = false;

            this.emit({ type: 'result', won, profit, total_profit: totalProfit, balance: newBalance, wins, trade_count: tradeCount });

            if (totalProfit >= take_profit) {
              this.emit({ type: 'status', status: 'stopped', reason: 'take_profit', total_profit: totalProfit });
              this.running = false; resolve(); return;
            }
            if (totalProfit <= -Math.abs(stop_loss)) {
              this.emit({ type: 'status', status: 'stopped', reason: 'stop_loss', total_profit: totalProfit });
              this.running = false; resolve(); return;
            }

            // Martingale
            if (won) {
              stake = initialStake;
            } else {
              stake = Math.round(stake * 2.1 * 100) / 100;
              tradeTypeIndex = 1 - tradeTypeIndex;
            }
          }

          // Place next trade
          const tradeType = contractTypes[tradeTypeIndex];
          const { contractId, error } = await placeTrade(tradeType, stake);
          if (error) {
            this.emit({ type: 'error', message: error });
            this.running = false; resolve(); return;
          }
          pendingTrade = true;
          pendingContractId = contractId;
          tradeCount++;
          this.emit({ type: 'trade', contract_id: contractId, trade_type: tradeType, stake, status: 'placed' });
        };

        this.ws!.onclose = () => resolve();
        this.ws!.onerror = () => { this.emit({ type: 'error', message: 'WebSocket error' }); resolve(); };
      });
      this.tickHandler = null;

    } catch (err: any) {
      this.emit({ type: 'error', message: err.message });
    } finally {
      this.running = false;
      this.ws?.close();
      this.emit({ type: 'status', status: 'stopped' });
    }
  }

  stop() {
    this.running = false;
    this.ws?.close();
  }
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function TradePage() {
  const logoSrc = useLogoSrc();
  const router = useRouter();
  const { ws, isConnected, isExhausted, auth } = useDerivWSContext();
  const { authState, accounts, activeAccount, login, signUp, logout, switchAccount } = auth;
  const trading = useDigitsTrading({ ws, isConnected, isExhausted, isAuthenticated: !!auth.wsUrl, onAuthWSFailed: logout });

  // ── Bot state ──
  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [stats, setStats] = useState<BotStats>({ balance: '—', currency: '', pnl: 0, trades: 0, wins: 0 });
  const [log, setLog] = useState<LogEntry[]>([]);
  const [digitHistory, setDigitHistory] = useState<DigitHistoryItem[]>([]);
  const [lastDigit, setLastDigit] = useState<number | null>(null);
  const [lastQuote, setLastQuote] = useState<string>('Waiting for ticks...');
  const [pulseKey, setPulseKey] = useState(0);
  const botRef = useRef<DerivBotClient | null>(null);
  const logIdRef = useRef(0);

  // ── Config state ──
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [symbol, setSymbol] = useState('R_100');
  const [mode, setMode] = useState('EVEN_ODD');
  const [barrier, setBarrier] = useState(5);
  const [stake, setStake] = useState(0.5);
  const [takeProfit, setTakeProfit] = useState(1.0);
  const [stopLoss, setStopLoss] = useState(4.0);

  // Redirect if not authenticated
  useEffect(() => {
    if (authState === 'unauthenticated' || authState === 'error') {
      router.replace('/');
    }
  }, [authState, router]);

  // Default selected account to active account
  useEffect(() => {
    if (activeAccount && !selectedAccountId) {
      setSelectedAccountId(activeAccount.account_id);
    }
  }, [activeAccount, selectedAccountId]);

  const addLog = useCallback((text: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    setLog(prev => [{ id: logIdRef.current++, time, text, type }, ...prev].slice(0, 200));
  }, []);

  const handleBotMessage = useCallback((msg: any) => {
    if (msg.type === 'status') {
      setBotStatus(msg.status === 'connecting' ? 'connecting' : msg.status === 'running' ? 'running' : msg.status === 'stopped' ? 'stopped' : 'idle');
      if (msg.balance !== undefined) {
        setStats(prev => ({ ...prev, balance: parseFloat(msg.balance).toFixed(2), currency: msg.currency ?? prev.currency }));
      }
      if (msg.reason) {
        const reasons: Record<string, string> = { take_profit: '✅ Take Profit Hit', stop_loss: '⛔ Stop Loss Hit' };
        addLog(reasons[msg.reason] ?? 'Bot stopped', msg.reason === 'take_profit' ? 'win' : 'loss');
      }
    } else if (msg.type === 'tick') {
      setLastDigit(msg.last_digit);
      setLastQuote(String(msg.quote));
      setPulseKey(k => k + 1);
      setDigitHistory(prev => [{ digit: msg.last_digit, isEven: msg.last_digit % 2 === 0 }, ...prev].slice(0, 20));
    } else if (msg.type === 'trade') {
      addLog(`PLACED ${msg.trade_type} | Stake: $${msg.stake}`, 'info');
    } else if (msg.type === 'result') {
      const pnl = msg.total_profit;
      setStats(prev => ({
        ...prev,
        balance: parseFloat(msg.balance).toFixed(2),
        pnl,
        trades: msg.trade_count,
        wins: msg.wins,
      }));
      const profitStr = (msg.profit >= 0 ? '+' : '') + msg.profit.toFixed(2);
      addLog(`${msg.won ? '✅ WIN' : '❌ LOSS'} | P&L: $${profitStr} | Total: $${pnl.toFixed(2)}`, msg.won ? 'win' : 'loss');
    } else if (msg.type === 'error') {
      addLog(`ERROR: ${msg.message}`, 'error');
    }
  }, [addLog]);

  const getApiToken = useCallback(async () => {
    const account = accounts.find(a => a.account_id === selectedAccountId) ?? activeAccount;
    if (!account) return null;
    try {
      const wsUrl = await getWebSocketOTP(account.account_id, getAuthInfo()!, process.env.NEXT_PUBLIC_DERIV_APP_ID ?? '');
      return wsUrl;
    } catch {
      return null;
    }
  }, [accounts, activeAccount, selectedAccountId]);

  const startBot = useCallback(async () => {
    const token = await getApiToken();
    if (!token) {
      addLog('Could not retrieve API token. Please log in again.', 'error');
      return;
    }

    const account = accounts.find(a => a.account_id === selectedAccountId) ?? activeAccount;
    const isLive = account?.account_type === 'real';

    if (isLive) {
      const confirmed = window.confirm('⚠️ LIVE MODE\n\nYou are about to trade with REAL MONEY.\n\nAre you sure you want to continue?');
      if (!confirmed) return;
    }

    const bot = new DerivBotClient(handleBotMessage);
    botRef.current = bot;
    setStats({ balance: '—', currency: '', pnl: 0, trades: 0, wins: 0 });
    setLog([]);
    setDigitHistory([]);
    setLastDigit(null);
    addLog('Starting bot...', 'info');

    bot.start({ api_token: token, symbol, mode, barrier, stake, take_profit: takeProfit, stop_loss: stopLoss });
  }, [getApiToken, accounts, activeAccount, selectedAccountId, handleBotMessage, symbol, mode, barrier, stake, takeProfit, stopLoss, addLog]);

  const stopBot = useCallback(() => {
    botRef.current?.stop();
    addLog('Stop requested...', 'info');
  }, [addLog]);

  // ── Loading state ──
  if (authState !== 'authenticated') {
    return (
      <main className="flex flex-col bg-background items-center justify-center min-h-dvh">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  const selectedAccount = accounts.find(a => a.account_id === selectedAccountId) ?? activeAccount;
  const isLive = selectedAccount?.account_type === 'real';
  const winRate = stats.trades > 0 ? Math.round((stats.wins / stats.trades) * 100) : null;
  const isRunning = botStatus === 'running' || botStatus === 'connecting';

  const statusConfig = {
    idle:       { label: 'IDLE',       color: 'text-muted-foreground border-muted-foreground' },
    connecting: { label: 'CONNECTING', color: 'text-yellow-400 border-yellow-400' },
    running:    { label: 'RUNNING',    color: 'text-emerald-400 border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.3)]' },
    stopped:    { label: 'STOPPED',    color: 'text-red-400 border-red-400' },
  }[botStatus];

  return (
    <main className="flex flex-col bg-background min-h-dvh">
      <Header
        authState={authState}
        accounts={accounts}
        activeAccount={activeAccount}
        onLogin={login}
        onSignUp={signUp}
        onLogout={logout}
        onSwitchAccount={switchAccount}
        logoSrc={logoSrc}
        actions={<ThemeToggle />}
      />

      {/* Spacer below fixed header */}
      <div className="h-[76px] shrink-0" />

      <div className="flex-1 w-full max-w-7xl mx-auto px-3 py-4 sm:px-4 sm:py-6 pb-16">
        {/* Back + page title row */}
        <div className="flex items-center justify-between mb-4">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <span className="text-base leading-none">←</span>
            <span>Back</span>
          </Link>
          <div className="flex items-center gap-3">
            {/* Account type badge */}
            <span className={`text-xs font-mono tracking-widest px-3 py-1 rounded border ${isLive ? 'text-red-400 border-red-400 bg-red-400/10' : 'text-cyan-400 border-cyan-400 bg-cyan-400/10'}`}>
              {isLive ? 'LIVE ⚠' : 'DEMO'}
            </span>
            {/* Bot status badge */}
            <span className={`text-xs font-mono tracking-widest px-3 py-1 rounded border transition-all ${statusConfig.color}`}>
              {statusConfig.label}
            </span>
          </div>
        </div>

        {/* ── Main Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-3">

          {/* ── LEFT: Config Panel ── */}
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">

            {/* Account selector */}
            <div>
              <p className="text-xs font-mono tracking-widest text-cyan-500 uppercase mb-3 pb-2 border-b border-border">Account</p>
              <div className="flex gap-1">
                {accounts.map(acc => (
                  <button
                    key={acc.account_id}
                    onClick={() => setSelectedAccountId(acc.account_id)}
                    disabled={isRunning}
                    className={`flex-1 py-2 text-xs font-mono tracking-widest uppercase rounded border transition-all disabled:opacity-50 ${
                      selectedAccountId === acc.account_id
                        ? acc.account_type === 'real'
                          ? 'bg-red-400/10 border-red-400 text-red-400'
                          : 'bg-cyan-400/10 border-cyan-400 text-cyan-400'
                        : 'border-border text-muted-foreground hover:border-muted-foreground'
                    }`}
                  >
                    {acc.account_type === 'real' ? '◈ REAL' : '⬡ DEMO'}
                  </button>
                ))}
              </div>
              {isLive && (
                <div className="mt-2 p-2 rounded border border-red-400/40 bg-red-400/5 text-red-400 text-xs font-mono leading-relaxed">
                  ⚠ REAL MONEY MODE<br />
                  Trades use your real balance.
                </div>
              )}
              {selectedAccount && (
                <p className="mt-2 text-xs text-muted-foreground font-mono">
                  {selectedAccount.account_id} · {parseFloat(selectedAccount.balance).toFixed(2)} {selectedAccount.currency}
                </p>
              )}
            </div>

            {/* Symbol */}
            <div>
              <p className="text-xs font-mono tracking-widest text-cyan-500 uppercase mb-3 pb-2 border-b border-border">Trade Settings</p>
              <label className="block text-xs font-mono tracking-widest text-muted-foreground uppercase mb-1">Symbol</label>
              <select
                value={symbol}
                onChange={e => setSymbol(e.target.value)}
                disabled={isRunning}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-cyan-500 disabled:opacity-50"
              >
                {SYMBOLS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>

              <label className="block text-xs font-mono tracking-widest text-muted-foreground uppercase mt-3 mb-1">Mode</label>
              <select
                value={mode}
                onChange={e => setMode(e.target.value)}
                disabled={isRunning}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-cyan-500 disabled:opacity-50"
              >
                <option value="EVEN_ODD">Even / Odd</option>
                <option value="OVER_UNDER">Over / Under</option>
              </select>

              {mode === 'OVER_UNDER' && (
                <>
                  <label className="block text-xs font-mono tracking-widest text-muted-foreground uppercase mt-3 mb-1">Barrier (0–9)</label>
                  <input
                    type="number" min={0} max={9} value={barrier}
                    onChange={e => setBarrier(parseInt(e.target.value))}
                    disabled={isRunning}
                    className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                  />
                </>
              )}

              <label className="block text-xs font-mono tracking-widest text-muted-foreground uppercase mt-3 mb-1">Stake (USD)</label>
              <input
                type="number" min={0.35} step={0.01} value={stake}
                onChange={e => setStake(parseFloat(e.target.value))}
                disabled={isRunning}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-cyan-500 disabled:opacity-50"
              />
            </div>

            {/* Risk management */}
            <div>
              <p className="text-xs font-mono tracking-widest text-cyan-500 uppercase mb-3 pb-2 border-b border-border">Risk Management</p>
              <label className="block text-xs font-mono tracking-widest text-muted-foreground uppercase mb-1">Take Profit (USD)</label>
              <input
                type="number" min={0.01} step={0.01} value={takeProfit}
                onChange={e => setTakeProfit(parseFloat(e.target.value))}
                disabled={isRunning}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-cyan-500 disabled:opacity-50"
              />
              <label className="block text-xs font-mono tracking-widest text-muted-foreground uppercase mt-3 mb-1">Stop Loss (USD)</label>
              <input
                type="number" min={0.01} step={0.01} value={stopLoss}
                onChange={e => setStopLoss(parseFloat(e.target.value))}
                disabled={isRunning}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-cyan-500 disabled:opacity-50"
              />
            </div>

            {/* Buttons */}
            <div className="flex flex-col gap-2 mt-auto">
              <button
                onClick={startBot}
                disabled={isRunning}
                className="w-full py-3 text-sm font-mono tracking-widest uppercase rounded border border-emerald-500 text-emerald-400 hover:bg-emerald-400/10 hover:shadow-[0_0_20px_rgba(52,211,153,0.2)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ▶ START BOT
              </button>
              <button
                onClick={stopBot}
                disabled={!isRunning}
                className="w-full py-3 text-sm font-mono tracking-widest uppercase rounded border border-red-500 text-red-400 hover:bg-red-400/10 hover:shadow-[0_0_20px_rgba(255,51,85,0.2)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ■ STOP BOT
              </button>
            </div>

            {/* Martingale info */}
            <div className="text-xs font-mono text-muted-foreground leading-relaxed pt-3 border-t border-border">
              Martingale: 2.1× on loss<br />
              Type switches on loss<br />
              Resets to base stake on win
            </div>
          </div>

          {/* ── RIGHT: Stats + Tick + Log ── */}
          <div className="flex flex-col gap-3">

            {/* Stats bar */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-px rounded-lg overflow-hidden border border-border bg-border">
              {[
                { label: 'Balance', value: stats.balance ? `${stats.balance} ${stats.currency}`.trim() : '—' },
                { label: 'Total P&L', value: stats.trades > 0 ? (stats.pnl >= 0 ? '+' : '') + stats.pnl.toFixed(2) : '—', color: stats.trades > 0 ? (stats.pnl > 0 ? 'text-emerald-400' : stats.pnl < 0 ? 'text-red-400' : '') : '' },
                { label: 'Trades', value: String(stats.trades) },
                { label: 'Wins', value: String(stats.wins) },
                { label: 'Win Rate', value: winRate !== null ? `${winRate}%` : '—' },
              ].map(stat => (
                <div key={stat.label} className="bg-card px-4 py-4 text-center">
                  <p className="text-xs font-mono tracking-widest text-muted-foreground uppercase mb-2">{stat.label}</p>
                  <p className={`text-xl font-mono text-cyan-400 ${stat.color ?? ''}`}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Tick + Log */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">

              {/* Live Tick */}
              <div className="rounded-lg border border-border bg-card p-5 flex flex-col min-h-[300px]">
                <p className="text-xs font-mono tracking-widest text-cyan-500 uppercase mb-3 pb-2 border-b border-border">Live Tick</p>
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <div
                    key={pulseKey}
                    className={`text-8xl font-mono leading-none transition-all animate-[pulse_0.15s_ease] ${
                      lastDigit === null ? 'text-muted-foreground' :
                      lastDigit % 2 === 0
                        ? 'text-emerald-400 drop-shadow-[0_0_30px_rgba(52,211,153,0.5)]'
                        : 'text-yellow-400 drop-shadow-[0_0_30px_rgba(250,204,21,0.5)]'
                    }`}
                  >
                    {lastDigit ?? '—'}
                  </div>
                  <p className="text-sm font-mono text-muted-foreground tracking-widest">{lastQuote}</p>
                </div>
                {/* Digit history */}
                <div className="flex flex-wrap gap-1 mt-3">
                  {digitHistory.map((d, i) => (
                    <div
                      key={i}
                      className={`w-7 h-7 flex items-center justify-center text-xs font-mono border rounded transition-all ${
                        i === 0
                          ? 'border-cyan-400 text-cyan-400'
                          : d.isEven
                          ? 'border-emerald-400/50 text-emerald-400'
                          : 'border-yellow-400/50 text-yellow-400'
                      }`}
                    >
                      {d.digit}
                    </div>
                  ))}
                </div>
              </div>

              {/* Trade Log */}
              <div className="rounded-lg border border-border bg-card p-5 flex flex-col min-h-[300px]">
                <p className="text-xs font-mono tracking-widest text-cyan-500 uppercase mb-3 pb-2 border-b border-border">Trade Log</p>
                <div className="flex-1 overflow-y-auto flex flex-col gap-1 scrollbar-thin">
                  {log.length === 0 && (
                    <p className="text-xs font-mono text-muted-foreground">No activity yet...</p>
                  )}
                  {log.map(entry => (
                    <div
                      key={entry.id}
                      className={`text-xs font-mono py-1.5 px-2.5 border-l-2 leading-relaxed ${
                        entry.type === 'win'   ? 'border-emerald-400 text-foreground' :
                        entry.type === 'loss'  ? 'border-red-400 text-foreground' :
                        entry.type === 'error' ? 'border-red-400 text-red-400' :
                                                 'border-cyan-500/40 text-muted-foreground'
                      }`}
                    >
                      [{entry.time}] {entry.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed footer */}
      <div className="fixed bottom-0 left-0 right-0 py-2 text-center bg-background/80 backdrop-blur-sm">
        <Footer />
      </div>
    </main>
  );
}
