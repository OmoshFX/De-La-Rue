/**
 * Prebuilt strategies, as Blockly XML.
 *
 * Equivalent to Deriv's "Quick strategy" wizard, but as a straight preset list:
 * loading one fills the canvas with real blocks the person can then edit, so it
 * doubles as a worked example of how the blocks fit together.
 */

export interface StrategyPreset {
  id: string;
  name: string;
  description: string;
  xml: string;
}

function wrap(params: string, condition: string, risk: string): string {
  return `<xml xmlns="https://developers.google.com/blockly/xml">
  <block type="trade_parameters" x="40" y="40">
    ${params}
    <statement name="SUBMARKET">
      <block type="purchase_conditions">
        <value name="CONDITION">${condition}</value>
        <next><block type="restart_conditions">${risk}</block></next>
      </block>
    </statement>
  </block>
</xml>`;
}

const FLAT_RISK = `
  <field name="TAKE_PROFIT">5</field>
  <field name="STOP_LOSS">10</field>
  <field name="MARTINGALE">1</field>
  <field name="MAX_TRADES">50</field>`;

const MARTINGALE_RISK = `
  <field name="TAKE_PROFIT">5</field>
  <field name="STOP_LOSS">20</field>
  <field name="MARTINGALE">2.1</field>
  <field name="MAX_TRADES">30</field>`;

export const PRESETS: StrategyPreset[] = [
  {
    id: 'streak-reversal',
    name: 'Streak reversal',
    description: 'After 3 odd digits in a row, buy Even — betting the streak breaks.',
    xml: wrap(
      `<field name="SYMBOL">R_100</field>
       <field name="CONTRACT_TYPE">DIGITEVEN</field>
       <field name="BARRIER">5</field>
       <field name="DURATION">1</field>
       <field name="STAKE">0.5</field>`,
      `<block type="consecutive_digits">
         <field name="COUNT">3</field>
         <field name="PARITY">ODD</field>
       </block>`,
      FLAT_RISK
    ),
  },
  {
    id: 'every-tick-even',
    name: 'Even, every tick',
    description: 'Buys Even on every tick. A baseline for comparing other strategies against.',
    xml: wrap(
      `<field name="SYMBOL">R_100</field>
       <field name="CONTRACT_TYPE">DIGITEVEN</field>
       <field name="BARRIER">5</field>
       <field name="DURATION">1</field>
       <field name="STAKE">0.5</field>`,
      `<block type="logic_boolean"><field name="BOOL">TRUE</field></block>`,
      FLAT_RISK
    ),
  },
  {
    id: 'rare-digit-over',
    name: 'Rare digit, Over',
    description: 'Buys Over 2 when digit 0 has appeared in under 8% of the last 100 ticks.',
    xml: wrap(
      `<field name="SYMBOL">R_100</field>
       <field name="CONTRACT_TYPE">DIGITOVER</field>
       <field name="BARRIER">2</field>
       <field name="DURATION">1</field>
       <field name="STAKE">0.5</field>`,
      `<block type="digit_compare">
         <field name="OP">LT</field>
         <value name="A">
           <block type="digit_percentage">
             <field name="DIGIT">0</field>
             <field name="WINDOW">100</field>
           </block>
         </value>
         <value name="B">
           <block type="math_number"><field name="NUM">8</field></block>
         </value>
       </block>`,
      FLAT_RISK
    ),
  },
  {
    id: 'martingale-odd',
    name: 'Martingale on Odd',
    description: 'Buys Odd every tick and doubles the stake after a loss. High risk — demo only.',
    xml: wrap(
      `<field name="SYMBOL">R_100</field>
       <field name="CONTRACT_TYPE">DIGITODD</field>
       <field name="BARRIER">5</field>
       <field name="DURATION">1</field>
       <field name="STAKE">0.5</field>`,
      `<block type="logic_boolean"><field name="BOOL">TRUE</field></block>`,
      MARTINGALE_RISK
    ),
  },
];
