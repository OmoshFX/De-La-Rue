'use client';

import Link from 'next/link';
import { ArrowRight, CircleDot, FlaskConical, Layers, Bot } from 'lucide-react';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';

/**
 * Only tabs that actually do something are listed here. Adding a card for a
 * placeholder page would send people to a dead end from the first screen.
 */
const QUICK_ACTIONS = [
  {
    href: '/dtrader',
    label: 'DTrader',
    blurb: 'Place a digits trade by hand',
    icon: CircleDot,
  },
  {
    href: '/analysis-tool',
    label: 'Analysis Tool',
    blurb: 'Live even/odd across symbols',
    icon: FlaskConical,
  },
  {
    href: '/bulk-trader',
    label: 'Bulk Trader',
    blurb: 'Run the bot with stake and limits',
    icon: Layers,
  },
  {
    href: '/trading-bots',
    label: 'Trading Bots',
    blurb: 'Ready-made strategies',
    icon: Bot,
  },
];

export default function DashboardPage() {
  const { auth } = useDerivWSContext();
  const { authState, activeAccount } = auth;
  const isAuthenticated = authState === 'authenticated';

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <div className="text-center">
        <h1 className="text-2xl font-semibold sm:text-3xl">
          {isAuthenticated && activeAccount ? (
            <>
              Hello{' '}
              <span className="tabular-nums">{activeAccount.account_id}</span>
              <span
                className={`ml-3 inline-block rounded-full px-3 py-1 align-middle text-xs font-semibold uppercase tracking-wider ${
                  activeAccount.account_type === 'demo'
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {activeAccount.account_type}
              </span>
            </>
          ) : (
            'Welcome'
          )}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {isAuthenticated
            ? 'Pick a tool below, or use the tabs above.'
            : 'Log in to trade. You can browse the analysis tools without an account.'}
        </p>
      </div>

      <p className="mt-12 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Quick actions
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_ACTIONS.map(({ href, label, blurb, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border bg-background p-5 transition-colors hover:border-foreground/30"
          >
            <Icon className="h-5 w-5 text-muted-foreground" />
            <p className="mt-4 font-medium">{label}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{blurb}</p>
            <ArrowRight className="mt-4 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </Link>
        ))}
      </div>
    </div>
  );
}
