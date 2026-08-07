'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDigitsTrading } from '@/hooks/use-digits-trading';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import Link from 'next/link';
import { PositionsTable } from '@/components/custom/positions-table';

const DIGIT_CONTRACT_LABELS: Record<string, string> = {
  DIGITMATCH: 'Digit Match',
  DIGITDIFF: 'Digit Differs',
  DIGITOVER: 'Digit Over',
  DIGITUNDER: 'Digit Under',
  DIGITEVEN: 'Digit Even',
  DIGITODD: 'Digit Odd',
};

export default function ReportsPage() {
  const router = useRouter();
  const { ws, isConnected, isExhausted, auth } = useDerivWSContext();
  const { authState, accounts, activeAccount, login, signUp, logout, switchAccount } = auth;
  const trading = useDigitsTrading({ ws, isConnected, isExhausted, isAuthenticated: !!auth.wsUrl, onAuthWSFailed: logout });

  useEffect(() => {
    if (authState === 'unauthenticated' || authState === 'error') {
      router.replace('/');
    }
  }, [authState, router]);

  if (authState !== 'authenticated') {
    return (
      <main className="flex flex-col bg-background items-center justify-center min-h-dvh">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="flex flex-col">
      <div className="flex-1 w-full max-w-7xl mx-auto px-3 py-4 sm:px-4 sm:py-6 pb-14">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <span className="text-base leading-none">←</span>
          <span>Back</span>
        </Link>
        <PositionsTable
          openPositions={trading.openPositions.filter((p) => Object.keys(DIGIT_CONTRACT_LABELS).includes(p.contract_type))}
          closedPositions={trading.closedPositions.filter((p) => Object.keys(DIGIT_CONTRACT_LABELS).includes(p.contract_type))}
          onSell={trading.sellContract}
          sellingId={trading.sellingId}
          sellError={trading.sellError}
          onClearSellError={trading.clearSellError}
          contractTypeLabels={DIGIT_CONTRACT_LABELS}
          className="mt-0"
        />
      </div>
    </main>
  );
}
