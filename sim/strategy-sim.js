#!/usr/bin/env node
/**
 * Three-stage digit strategy simulator.
 *
 * Replays the cycle:
 *   Stage 1  scan all markets for a run of N identical digits -> one DIGITDIFF
 *   Stage 2  scan for a parity streak -> trade the opposite, martingale until a win
 *   Stage 3  scan for M consecutive digits on the wrong side of a barrier -> one OVER/UNDER
 * then repeats.
 *
 * Zero dependencies. Node 22+ (uses the built-in WebSocket).
 *
 *   node sim/strategy-sim.js --source=synthetic --ticks=200000
 *   node sim/strategy-sim.js --source=deriv --ticks=5000 --pages=3
 *
 * Two things it answers that are hard to see any other way:
 *
 *   1. Whether the triggers have predictive power. Every trade is scored twice:
 *      once at fair payout (1/P, zero house edge) and once at realistic payout.
 *      At fair payout an edgeless trigger returns ~0. Anything consistently
 *      above 0 there is a real effect; anything at 0 is not.
 *
 *   2. How deep stage 2's martingale actually goes, since it cannot advance
 *      until it wins. The depth histogram is the tail risk, measured instead
 *      of guessed.
 *
 * Running --source=synthetic gives the independent-RNG baseline. Running
 * --source=deriv gives the real feed. Comparing them is the honest test of
 * whether Deriv's digits behave like independent draws.
 */

'use strict';

const WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';

const SYMBOLS = [
  'R_100', '1HZ100V',
  'R_75', '1HZ75V',
  'R_50', '1HZ50V',
  'R_25', '1HZ25V',
  'R_10', '1HZ10V',
];

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    const m = /^--([^=]+)=?(.*)$/.exec(raw);
    if (m) args[m[1]] = m[2] === '' ? true : m[2];
  }
  return args;
}

const args = parseArgs(process.argv);

const CONFIG = {
  source: args.source || 'synthetic',
  ticks: parseInt(args.ticks || '200000', 10),
  pages: parseInt(args.pages || '1', 10),

  // Stage 1: a run of `runLen` identical digits, restricted to `watch`.
  runLen: parseInt(args['run-len'] || '4', 10),
  watch: (args.watch || '0,1,2,3,4,5,6,7,8,9').split(',').map(Number),

  // Stage 2: parity streak length that triggers the opposite-side trade.
  streak: parseInt(args.streak || '5', 10),

  // Stage 3: `lookback` digits all on the wrong side of `barrier`.
  barrier: parseInt(args.barrier || '8', 10),
  direction: args.direction || 'under',
  lookback: parseInt(args.lookback || '5', 10),

  martingale: parseFloat(args.martingale || '2.1'),
  base: parseFloat(args.base || '1'),
  duration: parseInt(args.duration || '1', 10),
  capital: parseFloat(args.capital || '1000'),

  depths: (args.depths || '5,6,7,8,9,10,11,12').split(',').map(Number),

  // House edge per contract family, as a fraction of the fair payout.
  // These are ESTIMATES. Replace them with real proposal payouts before
  // reading the "realistic" P&L as anything more than indicative.
  edgeDiffers: parseFloat(args['edge-differs'] || '0.04'),
  edgeParity: parseFloat(args['edge-parity'] || '0.025'),
  edgeBarrier: parseFloat(args['edge-barrier'] || '0.04'),
};

// ─── Data ───────────────────────────────────────────────────────────────────

/**
 * Derive decimal places from a batch of prices.
 * Only needed when the API omits pip_size; across a full batch the chance
 * that every price ends in a trailing zero is negligible.
 */
function inferPipSize(prices) {
  let max = 2;
  for (const p of prices) {
    const s = String(p);
    const dot = s.indexOf('.');
    if (dot !== -1) max = Math.max(max, s.length - dot - 1);
  }
  return max;
}

function lastDigit(price, pipSize) {
  const s = price.toFixed(pipSize);
  return Number(s[s.length - 1]);
}

/** Uniform independent digits — the null hypothesis, as data. */
function synthesize(n) {
  const digits = new Array(n);
  for (let i = 0; i < n; i++) digits[i] = Math.floor(Math.random() * 10);
  return digits;
}

/**
 * Pull tick history from Deriv over one socket.
 *
 * Pages backwards: each request ends just before the oldest tick already
 * seen, because a plain repeat of the same call returns the same window.
 */
function fetchFromDeriv(symbols, countPerPage, pages) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const out = Object.fromEntries(symbols.map((s) => [s, { prices: [], times: [], pip: null }]));
    const pending = new Map();
    let reqId = 0;
    let done = false;

    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        try { ws.close(); } catch { /* already closed */ }
        reject(new Error('Timed out waiting for Deriv. Check the network and try fewer pages.'));
      }
    }, 120000);

    function send(payload) {
      return new Promise((res, rej) => {
        const id = ++reqId;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ ...payload, req_id: id }));
      });
    }

    ws.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      const p = pending.get(data.req_id);
      if (!p) return;
      pending.delete(data.req_id);
      if (data.error) p.rej(new Error(data.error.message || 'API error'));
      else p.res(data);
    };

    ws.onerror = () => {
      if (!done) {
        done = true;
        clearTimeout(timeout);
        reject(new Error('WebSocket error reaching Deriv.'));
      }
    };

    ws.onopen = async () => {
      try {
        for (let page = 0; page < pages; page++) {
          for (const symbol of symbols) {
            const bucket = out[symbol];
            // Walk back from the oldest tick already collected.
            const end = bucket.times.length > 0 ? bucket.times[0] - 1 : 'latest';

            const res = await send({
              ticks_history: symbol,
              end: String(end),
              start: 1,
              count: countPerPage,
              style: 'ticks',
            });

            const hist = res.history || {};
            const prices = hist.prices || [];
            const times = hist.times || [];
            if (prices.length === 0) continue;

            if (bucket.pip === null) bucket.pip = res.pip_size ?? inferPipSize(prices);
            // Older page goes in front, preserving chronological order.
            bucket.prices = prices.concat(bucket.prices);
            bucket.times = times.concat(bucket.times);
          }
          process.stderr.write(`  page ${page + 1}/${pages} fetched\n`);
        }

        done = true;
        clearTimeout(timeout);
        try { ws.close(); } catch { /* already closed */ }

        const markets = {};
        for (const s of symbols) {
          const b = out[s];
          markets[s] = b.prices.map((p) => lastDigit(p, b.pip ?? 2));
        }
        resolve(markets);
      } catch (err) {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          try { ws.close(); } catch { /* already closed */ }
          reject(err);
        }
      }
    };
  });
}

// ─── Independence check ─────────────────────────────────────────────────────

/**
 * Test the "choppy / alternating" observation directly.
 *
 * Under independent draws, consecutive parities flip with probability 0.5.
 * The z-score says how far the observed flip rate sits from that, in standard
 * deviations. |z| above about 3 would be hard to explain by chance.
 */
function parityIndependence(markets) {
  const rows = [];
  let totalFlips = 0;
  let totalPairs = 0;

  for (const [symbol, digits] of Object.entries(markets)) {
    let flips = 0;
    for (let i = 1; i < digits.length; i++) {
      if (digits[i] % 2 !== digits[i - 1] % 2) flips++;
    }
    const pairs = digits.length - 1;
    const rate = pairs > 0 ? flips / pairs : 0;
    const z = pairs > 0 ? (flips - pairs / 2) / Math.sqrt(pairs / 4) : 0;
    rows.push({ symbol, pairs, rate, z });
    totalFlips += flips;
    totalPairs += pairs;
  }

  const rate = totalPairs > 0 ? totalFlips / totalPairs : 0;
  const z = totalPairs > 0 ? (totalFlips - totalPairs / 2) / Math.sqrt(totalPairs / 4) : 0;
  return { rows, combined: { pairs: totalPairs, rate, z } };
}

/** Observed parity run lengths against the 0.5^k baseline. */
function runLengthProfile(markets) {
  const observed = new Map();
  let runs = 0;

  for (const digits of Object.values(markets)) {
    let len = 1;
    for (let i = 1; i < digits.length; i++) {
      if (digits[i] % 2 === digits[i - 1] % 2) {
        len++;
      } else {
        observed.set(len, (observed.get(len) || 0) + 1);
        runs++;
        len = 1;
      }
    }
  }
  return { observed, runs };
}

// ─── Strategy ───────────────────────────────────────────────────────────────

/** True win probability for each contract this strategy uses. */
function winProb(kind, param) {
  if (kind === 'differs') return 0.9;
  if (kind === 'parity') return 0.5;
  if (kind === 'under') return param / 10;
  if (kind === 'over') return (9 - param) / 10;
  throw new Error(`unknown contract ${kind}`);
}

function payout(kind, param, edge) {
  return (1 / winProb(kind, param)) * (1 - edge);
}

/**
 * Replay the three-stage cycle across all markets in parallel.
 *
 * Markets are stepped by index, i.e. tick i of every market is treated as
 * concurrent. Real feeds tick at different rates, so this is an approximation
 * of wall-clock alignment — it does not affect per-trade probabilities, only
 * which market happens to trigger first.
 */
function simulate(markets, cfg, maxDepth) {
  const symbols = Object.keys(markets);
  const length = Math.min(...symbols.map((s) => markets[s].length));

  const watch = new Set(cfg.watch);
  const state = {
    stage: 1,
    depth: 0,
    pnlFair: 0,
    pnlReal: 0,
    trades: 0,
    wins: 0,
    cycles: 0,
    abandons: 0,
    depthHist: new Array(maxDepth + 2).fill(0),
    worstDepth: 0,
    peakStake: 0,
    equityMin: 0,
    equityFair: 0,
  };

  // Enough history behind i for the longest lookback any stage uses.
  const warmup = Math.max(cfg.runLen, cfg.streak, cfg.lookback);
  let i = warmup;

  const settle = (kind, param, entryIdx, symbol, stake) => {
    const digits = markets[symbol];
    const settleIdx = entryIdx + cfg.duration;
    if (settleIdx >= digits.length) return null;

    const d = digits[settleIdx];
    let won;
    if (kind === 'differs') won = d !== param;
    else if (kind === 'parity') won = (d % 2 === 0) === (param === 'even');
    else if (kind === 'under') won = d < param;
    else won = d > param;

    const edge =
      kind === 'differs' ? cfg.edgeDiffers : kind === 'parity' ? cfg.edgeParity : cfg.edgeBarrier;
    const probParam = kind === 'parity' ? null : param;

    const fairMult = 1 / winProb(kind, probParam);
    const realMult = payout(kind, probParam, edge);

    state.trades++;
    if (won) state.wins++;

    const fairDelta = won ? stake * (fairMult - 1) : -stake;
    const realDelta = won ? stake * (realMult - 1) : -stake;
    state.pnlFair += fairDelta;
    state.pnlReal += realDelta;
    state.equityFair += fairDelta;
    if (state.pnlReal < state.equityMin) state.equityMin = state.pnlReal;
    if (stake > state.peakStake) state.peakStake = stake;

    return { won, settleIdx };
  };

  while (i < length - cfg.duration - 1) {
    let acted = false;

    if (state.stage === 1) {
      for (const symbol of symbols) {
        const d = markets[symbol];
        const target = d[i];
        if (!watch.has(target)) continue;
        let run = true;
        for (let k = 1; k < cfg.runLen; k++) {
          if (d[i - k] !== target) { run = false; break; }
        }
        if (!run) continue;

        const r = settle('differs', target, i, symbol, cfg.base);
        if (!r) { i = length; break; }
        // One trade only, win or lose.
        state.stage = 2;
        i = r.settleIdx;
        acted = true;
        break;
      }
    } else if (state.stage === 2) {
      for (const symbol of symbols) {
        const d = markets[symbol];
        const parity = d[i] % 2 === 0 ? 'even' : 'odd';
        let streak = true;
        for (let k = 1; k < cfg.streak; k++) {
          const p = d[i - k] % 2 === 0 ? 'even' : 'odd';
          if (p !== parity) { streak = false; break; }
        }
        if (!streak) continue;

        const bet = parity === 'even' ? 'odd' : 'even';
        const stake = cfg.base * Math.pow(cfg.martingale, state.depth);
        const r = settle('parity', bet, i, symbol, stake);
        if (!r) { i = length; break; }

        if (r.won) {
          state.depthHist[state.depth]++;
          if (state.depth > state.worstDepth) state.worstDepth = state.depth;
          state.depth = 0;
          state.stage = 3;
        } else {
          state.depth++;
          if (state.depth > state.worstDepth) state.worstDepth = state.depth;
          if (state.depth >= maxDepth) {
            // Cap reached: abandon the ladder and move on rather than
            // compounding without limit.
            state.abandons++;
            state.depthHist[maxDepth + 1]++;
            state.depth = 0;
            state.stage = 3;
          }
        }
        i = r.settleIdx;
        acted = true;
        break;
      }
    } else {
      const dir = cfg.direction;
      for (const symbol of symbols) {
        const d = markets[symbol];
        // Trigger looks for the barrier being missed repeatedly: for
        // "under 8", digits at or above 8.
        let ok = true;
        for (let k = 0; k < cfg.lookback; k++) {
          const v = d[i - k];
          const wrongSide = dir === 'under' ? v >= cfg.barrier : v <= cfg.barrier;
          if (!wrongSide) { ok = false; break; }
        }
        if (!ok) continue;

        const r = settle(dir, cfg.barrier, i, symbol, cfg.base);
        if (!r) { i = length; break; }
        state.stage = 1;
        state.cycles++;
        i = r.settleIdx;
        acted = true;
        break;
      }
    }

    if (!acted) i++;
  }

  return state;
}

// ─── Report ─────────────────────────────────────────────────────────────────

const pad = (s, n) => String(s).padStart(n);
const padr = (s, n) => String(s).padEnd(n);

function reportIndependence(markets) {
  const { rows, combined } = parityIndependence(markets);
  console.log('\n── Parity independence ──────────────────────────────────────');
  console.log('Under independent draws the flip rate is 0.5000.\n');
  console.log(`${padr('Symbol', 22)}${pad('Pairs', 10)}${pad('Flip rate', 12)}${pad('z', 9)}`);
  for (const r of rows) {
    console.log(
      padr(r.symbol, 22) + pad(r.pairs.toLocaleString(), 10) +
      pad(r.rate.toFixed(4), 12) + pad(r.z.toFixed(2), 9)
    );
  }
  console.log('-'.repeat(53));
  console.log(
    padr('COMBINED', 22) + pad(combined.pairs.toLocaleString(), 10) +
    pad(combined.rate.toFixed(4), 12) + pad(combined.z.toFixed(2), 9)
  );

  const az = Math.abs(combined.z);
  console.log(
    az > 3
      ? `\n  |z| = ${az.toFixed(2)} — larger than chance comfortably explains. Worth a closer look.`
      : `\n  |z| = ${az.toFixed(2)} — consistent with independent draws. No alternation effect.`
  );

  const { observed, runs } = runLengthProfile(markets);
  console.log('\n── Parity run lengths ───────────────────────────────────────');
  console.log(`${padr('Length', 10)}${pad('Observed', 12)}${pad('Expected', 12)}${pad('Obs %', 10)}${pad('Exp %', 10)}`);
  for (let k = 1; k <= 8; k++) {
    const obs = observed.get(k) || 0;
    const expPct = Math.pow(0.5, k);
    console.log(
      padr(k, 10) + pad(obs.toLocaleString(), 12) +
      pad(Math.round(runs * expPct).toLocaleString(), 12) +
      pad(((obs / runs) * 100).toFixed(2), 10) +
      pad((expPct * 100).toFixed(2), 10)
    );
  }
}

function reportSweep(markets, cfg) {
  console.log('\n── Strategy, by martingale cap ──────────────────────────────');
  console.log('Fair P&L prices every contract at 1/P (no house edge). A trigger');
  console.log('with no predictive power returns ~0 there, whatever it does at');
  console.log('realistic payouts.\n');

  console.log(
    padr('Cap', 6) + pad('Cycles', 9) + pad('Trades', 9) + pad('Win %', 9) +
    pad('Fair P&L', 12) + pad('Real P&L', 12) + pad('Peak stake', 12) +
    pad('Worst run', 11) + pad('Abandons', 10)
  );

  for (const cap of cfg.depths) {
    const s = simulate(markets, cfg, cap);
    const winPct = s.trades > 0 ? (s.wins / s.trades) * 100 : 0;
    console.log(
      padr(cap, 6) + pad(s.cycles.toLocaleString(), 9) + pad(s.trades.toLocaleString(), 9) +
      pad(winPct.toFixed(1), 9) + pad(s.pnlFair.toFixed(1), 12) +
      pad(s.pnlReal.toFixed(1), 12) + pad(s.peakStake.toFixed(1), 12) +
      pad(s.worstDepth, 11) + pad(s.abandons.toLocaleString(), 10)
    );
  }

  // Depth histogram from the deepest cap, where the tail is least truncated.
  const deepest = Math.max(...cfg.depths);
  const s = simulate(markets, cfg, deepest);
  console.log(`\n── Stage 2 ladder depth (cap ${deepest}) ────────────────────────────`);
  console.log('How many losses stage 2 sat through before it won.\n');
  console.log(`${padr('Losses first', 14)}${pad('Count', 10)}${pad('Share', 10)}${pad('Stake', 12)}`);
  const total = s.depthHist.reduce((a, b) => a + b, 0);
  for (let d = 0; d <= deepest; d++) {
    const c = s.depthHist[d];
    if (c === 0 && d > s.worstDepth) continue;
    console.log(
      padr(d, 14) + pad(c.toLocaleString(), 10) +
      pad(total > 0 ? ((c / total) * 100).toFixed(2) + '%' : '-', 10) +
      pad((cfg.base * Math.pow(cfg.martingale, d)).toFixed(2), 12)
    );
  }
  if (s.depthHist[deepest + 1] > 0) {
    console.log(padr('abandoned', 14) + pad(s.depthHist[deepest + 1].toLocaleString(), 10));
  }
  console.log(`\n  Worst drawdown at realistic payouts: ${s.equityMin.toFixed(1)} units`);
  console.log(`  Largest single stake reached:        ${s.peakStake.toFixed(1)} units`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const cfg = CONFIG;

  console.log('Three-stage digit strategy simulator');
  console.log('='.repeat(61));
  console.log(`  source        ${cfg.source}`);
  console.log(`  stage 1       run of ${cfg.runLen} from {${cfg.watch.join(',')}} -> DIGITDIFF`);
  console.log(`  stage 2       parity streak ${cfg.streak} -> opposite, martingale ${cfg.martingale}x`);
  console.log(`  stage 3       ${cfg.lookback} digits wrong-side of ${cfg.direction} ${cfg.barrier}`);
  console.log(`  base stake    ${cfg.base}`);
  console.log(`  duration      ${cfg.duration} tick(s)`);

  let markets;
  if (cfg.source === 'deriv') {
    console.log(`\nFetching ${cfg.ticks} ticks x ${cfg.pages} page(s) for ${SYMBOLS.length} symbols...`);
    markets = await fetchFromDeriv(SYMBOLS, cfg.ticks, cfg.pages);
  } else {
    const per = cfg.ticks;
    console.log(`\nGenerating ${per.toLocaleString()} independent digits per symbol...`);
    markets = Object.fromEntries(SYMBOLS.map((s) => [s, synthesize(per)]));
  }

  const counts = Object.values(markets).map((d) => d.length);
  console.log(`Ticks per symbol: ${Math.min(...counts).toLocaleString()} - ${Math.max(...counts).toLocaleString()}`);

  reportIndependence(markets);
  reportSweep(markets, cfg);

  console.log('\n' + '='.repeat(61));
  console.log('Payout edges used are estimates (differs ' + cfg.edgeDiffers +
    ', parity ' + cfg.edgeParity + ', barrier ' + cfg.edgeBarrier + ').');
  console.log('Replace them with real proposal payouts before treating the');
  console.log('realistic P&L column as anything but indicative.');
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
