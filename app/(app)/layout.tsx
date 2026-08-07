'use client';

import { useState, useEffect } from 'react';
import { AppNav } from '@/components/custom/app-nav';
import { SplashScreen } from '@/components/custom/splash-screen';

/**
 * Shell for every page in the app.
 *
 * Next.js keeps this layout mounted while the page below it swaps, so moving
 * between tabs re-renders only the content area — the nav bar never reloads or
 * flashes. That is what makes the tabs feel like panels rather than page loads.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Starts false so a reload, or moving between tabs, does not replay it.
  const [showSplash, setShowSplash] = useState(false);

  useEffect(() => {
    // Two cases deserve the splash:
    //   1. The OAuth return. Deriv sends the user back with ?code=... after a
    //      successful login, and this runs before useAuth strips the parameter.
    //   2. The first page view of a browser session, as a welcome.
    // sessionStorage suits case 2: it survives reloads and in-app navigation
    // but resets when the tab closes, which is the lifetime of "this visit".
    const isLoginReturn = new URLSearchParams(window.location.search).has('code');

    let isNewSession = false;
    try {
      isNewSession = sessionStorage.getItem('splash_shown') !== '1';
      if (isNewSession) sessionStorage.setItem('splash_shown', '1');
    } catch {
      // Private modes can throw on sessionStorage. Failing closed keeps the
      // splash from replaying on every reload.
    }

    if (isLoginReturn || isNewSession) setShowSplash(true);
  }, []);

  return (
    <div className="min-h-dvh bg-muted/40">
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      <AppNav />
      <main>{children}</main>
    </div>
  );
}
