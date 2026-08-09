/**
 * The strategy catalogue.
 *
 * Adding a bot is two steps and touches nothing else:
 *   1. Drop the .xml export into public/strategies/
 *   2. Add an entry below
 *
 * Removing one is the same in reverse. The Trading Bots page renders whatever
 * is in this array, so the page itself never needs editing.
 *
 * The XML is Blockly's own export format — the file you get from Save in the
 * Bot Builder — so a strategy can be built, tested and exported there, then
 * dropped in here as-is.
 */

export type Risk = 'low' | 'medium' | 'high';

export type Strategy = {
  /** Stable identifier. Used as the React key and in the load handoff. */
  id: string;
  /** Shown as the card title. Name it the way a trader would say it. */
  name: string;
  /** Path under public/. Must be a real file or Load will fail. */
  file: string;
  /**
   * One line on what it actually does — the entry condition and the response
   * to a loss. Not a sales pitch: this is what someone reads to decide whether
   * to run it with their own money.
   */
  summary: string;
  /** Market it was built and tested against, e.g. 'Volatility 100 (1s)'. */
  market: string;
  /** Trade type, e.g. 'Even/Odd', 'Matches/Differs', 'Over/Under'. */
  tradeType: string;
  /**
   * How hard a losing run hits the balance.
   *
   * Judged on stake progression, not win rate: anything that multiplies the
   * stake after a loss is 'high' however often it wins, because the tail is
   * what empties an account.
   */
  risk: Risk;
};

/**
 * Placeholder entries so the page can be seen populated. Replace with the real
 * strategies — these XML files do not exist yet, so Load will not find them.
 */
export const STRATEGIES: Strategy[] = [
  {
    id: 'even-odd-alternator',
    name: 'Even Odd Alternator',
    file: '/strategies/even-odd-alternator.xml',
    summary: 'Buys the opposite of the last digit result, flat stake throughout.',
    market: 'Volatility 100 (1s)',
    tradeType: 'Even/Odd',
    risk: 'low',
  },
  {
    id: 'differs-recovery',
    name: 'Differs Recovery',
    file: '/strategies/differs-recovery.xml',
    summary:
      'Trades Differs on the least frequent digit, doubling the stake after each loss until it recovers.',
    market: 'Volatility 100 (1s)',
    tradeType: 'Matches/Differs',
    risk: 'high',
  },
  {
    id: 'over-under-threshold',
    name: 'Over Under Threshold',
    file: '/strategies/over-under-threshold.xml',
    summary:
      'Waits for three consecutive digits above the barrier, then takes the reversal at a fixed stake.',
    market: 'Volatility 75',
    tradeType: 'Over/Under',
    risk: 'medium',
  },
];
