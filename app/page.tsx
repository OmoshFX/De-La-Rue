'use client';

import { useState, useEffect } from 'react';
import { useDigitsTrading } from '../hooks/use-digits-trading';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { DigitsView } from '../components/digits-view';
import { SplashScreen } from '@/components/custom/splash-screen';
import { DigitAnalysis } from '@/components/custom/digit-analysis';

export default function DigitsPage() {
  // Starts false so a plain reload — or navigating back from /trade — does not
  // replay the animation. The effect below decides whether to run it.
  const [showSplash, setShowSplash] = useState(false);

  useEffect(() => {
    // Two cases deserve the splash:
    //   1. The OAuth return. Deriv sends the user back with ?code=... after a
    //      successful login. This runs before useAuth strips the parameter,
    //      because React fires child effects before the provider's above it.
    //   2. The first page view of a browser session, as a welcome.
    // sessionStorage is the right store for case 2: it survives reloads and
    // in-app navigation within the tab, but resets when the tab is closed —
    // which is exactly the lifetime of "this visit". localStorage would show
    // it once and then never again.
    const isLoginReturn = new URLSearchParams(window.location.search).has('code');

    let isNewSession = false;
    try {
      isNewSession = sessionStorage.getItem('splash_shown') !== '1';
      if (isNewSession) sessionStorage.setItem('splash_shown', '1');
    } catch {
      // Private modes and locked-down browsers can throw on sessionStorage.
      // Failing closed keeps the splash from replaying on every reload.
    }

    if (isLoginReturn || isNewSession) setShowSplash(true);
  }, []);

  const logoSrc = useLogoSrc();
  const { ws, isConnected, isExhausted, auth } = useDerivWSContext();
  const { authState, accounts, activeAccount, login, signUp, logout, switchAccount } = auth;

  const trading = useDigitsTrading({ ws, isConnected, isExhausted, isAuthenticated: !!auth.wsUrl, onAuthWSFailed: logout });

  return (
    <>
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      <DigitsView
        authState={authState}
        accounts={accounts}
        activeAccount={activeAccount}
        onLogin={login}
        onSignUp={signUp}
        onLogout={logout}
        onSwitchAccount={switchAccount}
        logoSrc={logoSrc}
        isConnected={trading.isConnected}
        isLoading={trading.isLoading}
        error={trading.error}
        symbols={trading.symbols}
        activeSymbol={trading.activeSymbol}
        selectSymbol={trading.selectSymbol}
        currentTick={trading.currentTick}
        lastDigit={trading.lastDigit}
        digitStats={trading.digitStats}
        pipSize={trading.pipSize}
        tradeType={trading.tradeType}
        setTradeType={trading.setTradeType}
        contractMode={trading.contractMode}
        setContractMode={trading.setContractMode}
        selectedDigit={trading.selectedDigit}
        setSelectedDigit={trading.setSelectedDigit}
        stake={trading.stake}
        setStake={trading.setStake}
        duration={trading.duration}
        setDuration={trading.setDuration}
        durationLimits={trading.durationLimits}
        proposal={trading.proposal}
        isProposalLoading={trading.isProposalLoading}
        buyContract={trading.buyContract}
        isBuying={trading.isBuying}
        buyResult={trading.buyResult}
        buyError={trading.buyError}
        clearBuyResult={trading.clearBuyResult}
      />
      <DigitAnalysis />
    </>
  );
}
