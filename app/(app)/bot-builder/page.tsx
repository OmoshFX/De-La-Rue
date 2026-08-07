'use client';

import { useRef, useCallback } from 'react';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';

/**
 * Deriv's bot builder, mounted in place.
 *
 * The bot is a separate Rsbuild SPA built into public/bot/preview, so it is
 * served from this same origin. That matters: localStorage is scoped to the
 * origin, not the path, and the bot reads the session from the same `auth_info`
 * key this app writes (its vendored deriv-core/auth/storage.ts is byte-identical
 * to packages/core's). Logging in here therefore logs in there too — no second
 * sign-in, and no token passed across the frame boundary.
 */
export default function BotBuilderPage() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { auth } = useDerivWSContext();
  const { activeAccount, authState } = auth;

  // The bot resolves its account by reading `active_loginid` from localStorage
  // once, as it opens its socket:
  //
  //   const activeLoginId = localStorage.getItem('active_loginid');
  //   const targetAccount = accounts.find(a => a.account_id === activeLoginId) ?? accounts[0];
  //
  // It never re-reads that key, so switching account in our header would leave
  // the frame connected as the old one. Keying the iframe on the account id
  // remounts it on every switch, which makes the bot reconnect and pick up the
  // new selection. authState is included so logging in or out reloads it too.
  const frameKey = `${authState}:${activeAccount?.account_id ?? 'anon'}`;

  // Same-origin, so the frame's document is reachable. Hiding the bot's own
  // logo and account row avoids stacking a second one under ours; its page tabs
  // (Dashboard, Bot Builder, Charts, Tutorials) are left alone.
  const hideDuplicateChrome = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const style = doc.createElement('style');
    style.textContent = `
      .app-header { display: none !important; }
      .layout { padding-top: 0 !important; }
    `;
    doc.head.appendChild(style);
  }, []);

  return (
    <iframe
      key={frameKey}
      ref={frameRef}
      src="/bot/preview"
      title="Bot Builder"
      onLoad={hideDuplicateChrome}
      className="h-[calc(100dvh-7.5rem)] w-full border-0"
      // Same-origin needs no sandbox relaxation; clipboard is for block copy/paste.
      allow="clipboard-read; clipboard-write"
    />
  );
}
