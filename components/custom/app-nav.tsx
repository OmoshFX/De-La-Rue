'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard, Settings2, LineChart, Layers, Bot, FlaskConical,
  Calculator, Copy, CircleDot, Eye, Activity, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/custom/theme-toggle';

/**
 * Every destination in the app, in the order they appear in the tab strip.
 * Adding a page means adding one entry here and one route file — the active
 * state and mobile scrolling follow automatically.
 */
export const NAV_ITEMS = [
  { href: '/',                label: 'Dashboard',       icon: LayoutDashboard },
  { href: '/bot-builder',     label: 'Bot Builder',     icon: Settings2 },
  { href: '/charts',          label: 'Charts',          icon: LineChart },
  { href: '/bulk-trader',     label: 'Bulk Trader',     icon: Layers },
  { href: '/trading-bots',    label: 'Trading Bots',    icon: Bot },
  { href: '/analysis-tool',   label: 'Analysis Tool',   icon: FlaskConical },
  { href: '/risk-calculator', label: 'Risk Calculator', icon: Calculator },
  { href: '/copy-trading',    label: 'Copy Trading',    icon: Copy },
  { href: '/dtrader',         label: 'DTrader',         icon: CircleDot },
  { href: '/tradingview',     label: 'TradingView',     icon: Eye },
  { href: '/signal-analyzer', label: 'Signal Analyzer', icon: Activity },
] as const;

function formatBalance(balance: string): string {
  return Number(balance).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function AccountSwitcher() {
  const { auth } = useDerivWSContext();
  const { authState, accounts, activeAccount, login, signUp, logout, switchAccount } = auth;
  const [open, setOpen] = useState(false);

  const isAuthenticated = authState === 'authenticated';
  const isAuthenticating = authState === 'authenticating';

  if (!isAuthenticated || !activeAccount) {
    return (
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Button variant="ghost" size="sm" onClick={() => login()} disabled={isAuthenticating}>
          {isAuthenticating ? 'Logging in...' : 'Log in'}
        </Button>
        <Button size="sm" onClick={() => signUp()} disabled={isAuthenticating}>
          Sign up
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <ThemeToggle />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted transition-colors">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                activeAccount.account_type === 'demo' ? 'bg-orange-500' : 'bg-emerald-500'
              )}
            />
            <span className="text-base font-semibold tabular-nums">
              {formatBalance(activeAccount.balance)} {activeAccount.currency}
            </span>
            <ChevronDown
              className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2">
          <p className="px-2 pb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Switch account
          </p>
          <div className="space-y-1">
            {accounts.map((account) => (
              <button
                key={account.account_id}
                onClick={() => {
                  switchAccount(account.account_id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted transition-colors',
                  account.account_id === activeAccount.account_id && 'bg-muted'
                )}
              >
                <span>
                  <span className="block font-medium">
                    {account.account_type === 'demo' ? 'Demo' : 'Real'}
                  </span>
                  <span className="block text-xs text-muted-foreground">{account.account_id}</span>
                </span>
                <span className="tabular-nums text-sm">
                  {formatBalance(account.balance)} {account.currency}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-2 border-t pt-2">
            <button
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="w-full rounded-md px-2 py-2 text-left text-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              Log out
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function AppNav() {
  const pathname = usePathname();
  const logoSrc = useLogoSrc();
  const [logoError, setLogoError] = useState(false);
  const appName = process.env.NEXT_PUBLIC_DERIV_APP_NAME ?? 'Deriv Trading';

  return (
    <header className="sticky top-0 z-40">
      {/* Utility row: brand, cashier, account */}
      <div className="flex h-14 items-center justify-between gap-4 border-b bg-background px-4">
        <div className="flex items-center">
          <Link href="/" className="flex items-center gap-2">
            {!logoSrc || logoError ? (
              <span className="flex h-7 w-7 items-center justify-center rounded bg-foreground text-xs font-bold text-background">
                {appName.trim().charAt(0).toUpperCase() || 'D'}
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- next/image errors in the optimizer when /logo.png is absent locally
              <img
                src={logoSrc}
                alt=""
                className="h-7 w-auto object-contain"
                onError={() => setLogoError(true)}
              />
            )}
            <span className="hidden text-sm font-semibold sm:block">{appName}</span>
          </Link>
        </div>
        <AccountSwitcher />
      </div>

      {/* Tab strip. Scrolls horizontally on narrow screens rather than wrapping,
          so the row height stays fixed and the active tab can be scrolled to. */}
      <nav className="border-b bg-foreground">
        <div className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 px-4 py-3 text-sm whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-background text-foreground font-semibold'
                    : 'text-background/60 hover:text-background hover:bg-background/10'
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
