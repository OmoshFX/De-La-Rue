/**
 * Charts.
 *
 * Deriv's chart is not a component we can lift out — it is wired into the bot's
 * MobX stores, its socket and its symbol state. So this route renders nothing
 * and lets BotFrame, in the layout, show the bot's own Charts tab: full price
 * chart, symbol picker, drawing tools, granularity, the digit distribution
 * strip, and the Run / Summary / Transactions / Journal panel beside it.
 *
 * The mapping lives in BOT_TAB_BY_PATH in components/custom/bot-frame.tsx.
 */
export default function ChartsPage() {
  return null;
}
