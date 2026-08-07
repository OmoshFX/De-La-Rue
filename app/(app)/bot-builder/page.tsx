'use client';

import { useRef, useCallback } from 'react';

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

  // Same-origin, so the frame's document is reachable. Hiding the bot's own
  // header avoids a second logo, nav and account switcher stacked under ours.
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
