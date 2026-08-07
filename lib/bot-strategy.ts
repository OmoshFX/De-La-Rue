import * as Blockly from 'blockly/core';

/**
 * Reads a block workspace into a plain config object, and evaluates that config
 * against live digits.
 *
 * Deriv's bot compiles blocks to JavaScript and runs it through an interpreter.
 * This takes a narrower route: blocks describe a fixed set of conditions, so the
 * output is data rather than code. That rules out arbitrary strategies, but it
 * also means nothing here can execute anything a user typed.
 */

export type Comparison = 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE';

export type Condition =
  | { kind: 'always' }
  | { kind: 'parity'; parity: 'EVEN' | 'ODD' }
  | { kind: 'streak'; count: number; parity: 'EVEN' | 'ODD' }
  | { kind: 'compare'; op: Comparison; left: NumericTerm; right: NumericTerm }
  | { kind: 'and'; left: Condition; right: Condition }
  | { kind: 'or'; left: Condition; right: Condition }
  | { kind: 'not'; inner: Condition }
  | { kind: 'literal'; value: boolean };

export type NumericTerm =
  | { kind: 'lastDigit' }
  | { kind: 'percentage'; digit: number; window: number }
  | { kind: 'number'; value: number };

export interface StrategyConfig {
  symbol: string;
  contractType: string;
  barrier: number;
  duration: number;
  stake: number;
  condition: Condition;
  takeProfit: number;
  stopLoss: number;
  martingale: number;
  maxTrades: number;
}

export interface ParseResult {
  config: StrategyConfig | null;
  errors: string[];
}

function readNumericTerm(block: Blockly.Block | null): NumericTerm | null {
  if (!block) return null;
  switch (block.type) {
    case 'last_digit':
      return { kind: 'lastDigit' };
    case 'digit_percentage':
      return {
        kind: 'percentage',
        digit: Number(block.getFieldValue('DIGIT')),
        window: Number(block.getFieldValue('WINDOW')),
      };
    case 'math_number':
      return { kind: 'number', value: Number(block.getFieldValue('NUM')) };
    default:
      return null;
  }
}

function readCondition(block: Blockly.Block | null, errors: string[]): Condition | null {
  if (!block) return null;

  switch (block.type) {
    case 'digit_parity':
      return { kind: 'parity', parity: block.getFieldValue('PARITY') as 'EVEN' | 'ODD' };

    case 'consecutive_digits':
      return {
        kind: 'streak',
        count: Number(block.getFieldValue('COUNT')),
        parity: block.getFieldValue('PARITY') as 'EVEN' | 'ODD',
      };

    case 'logic_boolean':
      return { kind: 'literal', value: block.getFieldValue('BOOL') === 'TRUE' };

    case 'digit_compare': {
      const left = readNumericTerm(block.getInputTargetBlock('A'));
      const right = readNumericTerm(block.getInputTargetBlock('B'));
      if (!left || !right) {
        errors.push('A comparison block is missing one of its two values.');
        return null;
      }
      return { kind: 'compare', op: block.getFieldValue('OP') as Comparison, left, right };
    }

    case 'logic_operation': {
      const left = readCondition(block.getInputTargetBlock('A'), errors);
      const right = readCondition(block.getInputTargetBlock('B'), errors);
      if (!left || !right) {
        errors.push('An and/or block is missing one of its two conditions.');
        return null;
      }
      return block.getFieldValue('OP') === 'AND'
        ? { kind: 'and', left, right }
        : { kind: 'or', left, right };
    }

    case 'logic_negate': {
      const inner = readCondition(block.getInputTargetBlock('BOOL'), errors);
      if (!inner) {
        errors.push('A "not" block is empty.');
        return null;
      }
      return { kind: 'not', inner };
    }

    default:
      return null;
  }
}

export function parseWorkspace(workspace: Blockly.Workspace): ParseResult {
  const errors: string[] = [];

  const roots = workspace.getTopBlocks(false).filter((b) => b.type === 'trade_parameters');
  if (roots.length === 0) {
    return { config: null, errors: ['Add a Trade parameters block to start the strategy.'] };
  }
  if (roots.length > 1) {
    errors.push('There is more than one Trade parameters block. Only the first will run.');
  }

  const root = roots[0];
  const contractType = root.getFieldValue('CONTRACT_TYPE') as string;

  let condition: Condition = { kind: 'always' };
  let takeProfit = 0;
  let stopLoss = 0;
  let martingale = 1;
  let maxTrades = 50;
  let sawPurchase = false;
  let sawRisk = false;

  let statement = root.getInputTargetBlock('SUBMARKET');
  while (statement) {
    if (statement.type === 'purchase_conditions') {
      sawPurchase = true;
      const parsed = readCondition(statement.getInputTargetBlock('CONDITION'), errors);
      if (parsed) condition = parsed;
    } else if (statement.type === 'restart_conditions') {
      sawRisk = true;
      takeProfit = Number(statement.getFieldValue('TAKE_PROFIT'));
      stopLoss = Number(statement.getFieldValue('STOP_LOSS'));
      martingale = Number(statement.getFieldValue('MARTINGALE'));
      maxTrades = Number(statement.getFieldValue('MAX_TRADES'));
    }
    statement = statement.getNextBlock();
  }

  if (!sawPurchase) {
    errors.push('No Purchase block found — the bot would never place a trade.');
  }
  if (!sawRisk) {
    errors.push('No Risk limits block — without a stop loss the bot runs until you stop it.');
  }

  const config: StrategyConfig = {
    symbol: root.getFieldValue('SYMBOL'),
    contractType,
    barrier: Number(root.getFieldValue('BARRIER')),
    duration: Number(root.getFieldValue('DURATION')),
    stake: Number(root.getFieldValue('STAKE')),
    condition,
    takeProfit,
    stopLoss,
    martingale,
    maxTrades,
  };

  return { config, errors };
}

// ── Evaluation ────────────────────────────────────────────────────────────────

/** `digits` is oldest-first, matching the shape useDigitTicks returns. */
function evalTerm(term: NumericTerm, digits: number[]): number {
  switch (term.kind) {
    case 'number':
      return term.value;
    case 'lastDigit':
      return digits[digits.length - 1] ?? -1;
    case 'percentage': {
      const window = digits.slice(-term.window);
      if (window.length === 0) return 0;
      const hits = window.filter((d) => d === term.digit).length;
      return (hits / window.length) * 100;
    }
  }
}

export function evaluateCondition(condition: Condition, digits: number[]): boolean {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'literal':
      return condition.value;
    case 'parity': {
      const last = digits[digits.length - 1];
      if (last === undefined) return false;
      return condition.parity === 'EVEN' ? last % 2 === 0 : last % 2 === 1;
    }
    case 'streak': {
      if (digits.length < condition.count) return false;
      const recent = digits.slice(-condition.count);
      return recent.every((d) => (condition.parity === 'EVEN' ? d % 2 === 0 : d % 2 === 1));
    }
    case 'compare': {
      const a = evalTerm(condition.left, digits);
      const b = evalTerm(condition.right, digits);
      switch (condition.op) {
        case 'EQ':  return a === b;
        case 'NEQ': return a !== b;
        case 'LT':  return a < b;
        case 'LTE': return a <= b;
        case 'GT':  return a > b;
        case 'GTE': return a >= b;
      }
      return false;
    }
    case 'and':
      return evaluateCondition(condition.left, digits) && evaluateCondition(condition.right, digits);
    case 'or':
      return evaluateCondition(condition.left, digits) || evaluateCondition(condition.right, digits);
    case 'not':
      return !evaluateCondition(condition.inner, digits);
  }
}

/** Plain-English rendering of a condition, for the summary panel. */
export function describeCondition(condition: Condition): string {
  switch (condition.kind) {
    case 'always':   return 'every tick';
    case 'literal':  return condition.value ? 'every tick' : 'never';
    case 'parity':   return `last digit is ${condition.parity.toLowerCase()}`;
    case 'streak':   return `${condition.count} consecutive ${condition.parity.toLowerCase()} digits`;
    case 'and':      return `${describeCondition(condition.left)} and ${describeCondition(condition.right)}`;
    case 'or':       return `${describeCondition(condition.left)} or ${describeCondition(condition.right)}`;
    case 'not':      return `not (${describeCondition(condition.inner)})`;
    case 'compare': {
      const ops: Record<Comparison, string> = {
        EQ: '=', NEQ: '\u2260', LT: '<', LTE: '\u2264', GT: '>', GTE: '\u2265',
      };
      return `${describeTerm(condition.left)} ${ops[condition.op]} ${describeTerm(condition.right)}`;
    }
  }
}

function describeTerm(term: NumericTerm): string {
  switch (term.kind) {
    case 'number':     return String(term.value);
    case 'lastDigit':  return 'last digit';
    case 'percentage': return `% of digit ${term.digit} in last ${term.window}`;
  }
}
