import * as Blockly from 'blockly/core';

/**
 * Block definitions for digit-trading strategies.
 *
 * The four-section shape (trade parameters → purchase → restart) follows the
 * structure Deriv's own bot uses, so strategies read the same way. The blocks
 * themselves are ours: scoped to digit contracts, and emitting a declarative
 * config rather than JavaScript for an interpreter to run.
 */

export const SYMBOLS: [string, string][] = [
  ['Volatility 10 Index', 'R_10'],
  ['Volatility 25 Index', 'R_25'],
  ['Volatility 50 Index', 'R_50'],
  ['Volatility 75 Index', 'R_75'],
  ['Volatility 100 Index', 'R_100'],
  ['Volatility 10 (1s)', '1HZ10V'],
  ['Volatility 25 (1s)', '1HZ25V'],
  ['Volatility 50 (1s)', '1HZ50V'],
  ['Volatility 75 (1s)', '1HZ75V'],
  ['Volatility 100 (1s)', '1HZ100V'],
];

export const CONTRACT_TYPES: [string, string][] = [
  ['Even', 'DIGITEVEN'],
  ['Odd', 'DIGITODD'],
  ['Over', 'DIGITOVER'],
  ['Under', 'DIGITUNDER'],
  ['Matches', 'DIGITMATCH'],
  ['Differs', 'DIGITDIFF'],
];

const COLOURS = {
  trade: '#1a73e8',
  purchase: '#00897b',
  restart: '#e8710a',
  analysis: '#8e24aa',
};

let registered = false;

/**
 * Registers every custom block. Safe to call more than once — React strict mode
 * mounts effects twice in development, and re-registering throws.
 */
export function defineBlocks() {
  if (registered) return;
  registered = true;

  // ── 1. Trade parameters ─────────────────────────────────────────────────────
  Blockly.Blocks['trade_parameters'] = {
    init(this: Blockly.Block) {
      this.jsonInit({
        type: 'trade_parameters',
        message0: 'Trade parameters',
        message1: 'Market %1',
        args1: [{ type: 'field_dropdown', name: 'SYMBOL', options: SYMBOLS }],
        message2: 'Contract type %1',
        args2: [{ type: 'field_dropdown', name: 'CONTRACT_TYPE', options: CONTRACT_TYPES }],
        message3: 'Barrier (digit) %1',
        args3: [{ type: 'field_number', name: 'BARRIER', value: 5, min: 0, max: 9, precision: 1 }],
        message4: 'Duration (ticks) %1',
        args4: [{ type: 'field_number', name: 'DURATION', value: 1, min: 1, max: 10, precision: 1 }],
        message5: 'Stake %1',
        args5: [{ type: 'field_number', name: 'STAKE', value: 0.5, min: 0.35 }],
        message6: 'then %1',
        args6: [{ type: 'input_statement', name: 'SUBMARKET' }],
        colour: COLOURS.trade,
        tooltip: 'The market, contract and stake every trade in this strategy uses.',
      });
      // Root of the strategy: nothing may attach above or below it.
      this.setDeletable(false);
      this.setMovable(true);
    },
  };

  // ── 2. Purchase conditions ──────────────────────────────────────────────────
  Blockly.Blocks['purchase_conditions'] = {
    init(this: Blockly.Block) {
      this.jsonInit({
        type: 'purchase_conditions',
        message0: 'Purchase when %1',
        args0: [{ type: 'input_value', name: 'CONDITION', check: 'Boolean' }],
        previousStatement: null,
        nextStatement: null,
        colour: COLOURS.purchase,
        tooltip: 'Buy a contract whenever this condition is true. Leave empty to trade every tick.',
      });
    },
  };

  // ── 3. Restart / risk ───────────────────────────────────────────────────────
  Blockly.Blocks['restart_conditions'] = {
    init(this: Blockly.Block) {
      this.jsonInit({
        type: 'restart_conditions',
        message0: 'Risk limits',
        message1: 'Take profit %1',
        args1: [{ type: 'field_number', name: 'TAKE_PROFIT', value: 5, min: 0 }],
        message2: 'Stop loss %1',
        args2: [{ type: 'field_number', name: 'STOP_LOSS', value: 10, min: 0 }],
        message3: 'On loss, multiply stake by %1',
        args3: [{ type: 'field_number', name: 'MARTINGALE', value: 1, min: 1, max: 5 }],
        message4: 'Max trades %1',
        args4: [{ type: 'field_number', name: 'MAX_TRADES', value: 50, min: 1 }],
        previousStatement: null,
        nextStatement: null,
        colour: COLOURS.restart,
        tooltip: 'Stop the bot when any of these limits is reached. Multiply by 1 to keep the stake flat.',
      });
    },
  };

  // ── Analysis blocks (value blocks used inside conditions) ───────────────────

  Blockly.Blocks['last_digit'] = {
    init(this: Blockly.Block) {
      this.jsonInit({
        type: 'last_digit',
        message0: 'last digit',
        output: 'Number',
        colour: COLOURS.analysis,
        tooltip: 'The last digit of the most recent tick.',
      });
    },
  };

  Blockly.Blocks['digit_parity'] = {
    init(this: Blockly.Block) {
      this.jsonInit({
        type: 'digit_parity',
        message0: 'last digit is %1',
        args0: [
          {
            type: 'field_dropdown',
            name: 'PARITY',
            options: [
              ['even', 'EVEN'],
              ['odd', 'ODD'],
            ],
          },
        ],
        output: 'Boolean',
        colour: COLOURS.analysis,
        tooltip: 'True when the most recent digit is even or odd.',
      });
    },
  };

  Blockly.Blocks['consecutive_digits'] = {
    init(this: Blockly.Block) {
      this.jsonInit({
        type: 'consecutive_digits',
        message0: '%1 consecutive %2 digits',
        args0: [
          { type: 'field_number', name: 'COUNT', value: 3, min: 2, max: 20, precision: 1 },
          {
            type: 'field_dropdown',
            name: 'PARITY',
            options: [
              ['even', 'EVEN'],
              ['odd', 'ODD'],
            ],
          },
        ],
        output: 'Boolean',
        colour: COLOURS.analysis,
        tooltip: 'True when the last N digits all share the same parity — a streak.',
      });
    },
  };

  Blockly.Blocks['digit_percentage'] = {
    init(this: Blockly.Block) {
      this.jsonInit({
        type: 'digit_percentage',
        message0: '%% of digit %1 over last %2 ticks',
        args0: [
          { type: 'field_number', name: 'DIGIT', value: 0, min: 0, max: 9, precision: 1 },
          { type: 'field_number', name: 'WINDOW', value: 100, min: 10, max: 1000, precision: 1 },
        ],
        output: 'Number',
        colour: COLOURS.analysis,
        tooltip: 'How often a digit appeared recently, as a percentage.',
      });
    },
  };

  Blockly.Blocks['digit_compare'] = {
    init(this: Blockly.Block) {
      this.jsonInit({
        type: 'digit_compare',
        message0: '%1 %2 %3',
        args0: [
          { type: 'input_value', name: 'A', check: 'Number' },
          {
            type: 'field_dropdown',
            name: 'OP',
            options: [
              ['=', 'EQ'],
              ['\u2260', 'NEQ'],
              ['<', 'LT'],
              ['\u2264', 'LTE'],
              ['>', 'GT'],
              ['\u2265', 'GTE'],
            ],
          },
          { type: 'input_value', name: 'B', check: 'Number' },
        ],
        inputsInline: true,
        output: 'Boolean',
        colour: COLOURS.analysis,
        tooltip: 'Compare two numbers.',
      });
    },
  };
}

/**
 * Toolbox definition. Categories mirror the order a strategy is built in, so
 * working top to bottom produces a valid strategy.
 */
export const TOOLBOX: Blockly.utils.toolbox.ToolboxDefinition = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Trade parameters',
      colour: COLOURS.trade,
      contents: [{ kind: 'block', type: 'trade_parameters' }],
    },
    {
      kind: 'category',
      name: 'Purchase conditions',
      colour: COLOURS.purchase,
      contents: [{ kind: 'block', type: 'purchase_conditions' }],
    },
    {
      kind: 'category',
      name: 'Risk limits',
      colour: COLOURS.restart,
      contents: [{ kind: 'block', type: 'restart_conditions' }],
    },
    {
      kind: 'category',
      name: 'Analysis',
      colour: COLOURS.analysis,
      contents: [
        { kind: 'block', type: 'digit_parity' },
        { kind: 'block', type: 'consecutive_digits' },
        { kind: 'block', type: 'digit_compare' },
        { kind: 'block', type: 'last_digit' },
        { kind: 'block', type: 'digit_percentage' },
      ],
    },
    {
      kind: 'category',
      name: 'Logic',
      colour: '#5b67a5',
      contents: [
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
      ],
    },
    {
      kind: 'category',
      name: 'Math',
      colour: '#5b80a5',
      contents: [
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic' },
      ],
    },
  ],
};

/** The workspace a new user starts from — a valid strategy, ready to run. */
export const STARTER_XML = `
<xml xmlns="https://developers.google.com/blockly/xml">
  <block type="trade_parameters" x="40" y="40">
    <field name="SYMBOL">R_100</field>
    <field name="CONTRACT_TYPE">DIGITEVEN</field>
    <field name="BARRIER">5</field>
    <field name="DURATION">1</field>
    <field name="STAKE">0.5</field>
    <statement name="SUBMARKET">
      <block type="purchase_conditions">
        <value name="CONDITION">
          <block type="consecutive_digits">
            <field name="COUNT">3</field>
            <field name="PARITY">ODD</field>
          </block>
        </value>
        <next>
          <block type="restart_conditions">
            <field name="TAKE_PROFIT">5</field>
            <field name="STOP_LOSS">10</field>
            <field name="MARTINGALE">1</field>
            <field name="MAX_TRADES">50</field>
          </block>
        </next>
      </block>
    </statement>
  </block>
</xml>`.trim();
