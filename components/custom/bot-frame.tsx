'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';

/**
 * One bot frame, shared by every page that needs it.
 *
 * The bot is a ~47MB SPA. Giving each page its own iframe would reload all of
 * it — canvaskit wasm included — on every switch between Charts and Bot
 * Builder. So a single frame lives here in the layout and stays mounted; the
 * pages themselves render nothing and simply steer it.
 *
 * Steering works because the bot is served from our own origin, so its document
 * is reachable. Its tabs are not routes — they are indices 0-3 in a MobX store
 * with no URL handling — but each tab header renders as `<li id={...} onClick>`,
 * so a synthetic click on the right id switches the view.
 */

type BotRoute = {
  /** Tab to select, from the bot's TAB_IDS. */
  tabId: string;
  /**
   * Whether to hide the bot's own tab row on this route.
   *
   * On Bot Builder we keep it: Dashboard and Tutorials live there and have no
   * equivalent in our nav, so hiding it would strand them. On Charts we hide it
   * — the page is meant to be the chart and nothing else, and leaving the row
   * would offer a second Bot Builder link that navigates the frame while our
   * URL still said /charts.
   */
  hideBotTabs: boolean;
};

/**
 * Which bot view each of our routes shows.
 *
 * Adding a route here is all it takes to give it the bot: map it to a tab id
 * (id-dbot-dashboard, id-bot-builder, id-charts, id-tutorials) and have the
 * page render null.
 */
const BOT_ROUTES: Record<string, BotRoute> = {
  '/bot-builder': { tabId: 'id-bot-builder', hideBotTabs: false },
  '/charts': { tabId: 'id-charts', hideBotTabs: true },
};

/**
 * Height of AppNav — the logo row plus the tab strip.
 *
 * The frame is positioned rather than laid out in flow, so it needs this as a
 * number. If the nav's height changes, this changes with it.
 */
const NAV_HEIGHT = '7.5rem';

/** How long to keep looking for the tab before giving up, and how often. */
const TAB_POLL_TIMEOUT_MS = 20_000;
const TAB_POLL_INTERVAL_MS = 150;

/**
 * When to nudge the chart into re-measuring, in ms after the tab is selected.
 *
 * Spread out because we cannot see when SmartCharts finishes mounting: the
 * first nudge catches a chart that is already up, the later ones catch one that
 * was still starting. Nudging a chart that does not need it is harmless.
 */
const LAYOUT_NUDGE_DELAYS_MS = [0, 250, 1000, 2500];

export function BotFrame() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const pathname = usePathname();
  const { auth } = useDerivWSContext();
  const { activeAccount, authState } = auth;

  const route = BOT_ROUTES[pathname];
  const isActive = Boolean(route);

  // Mount lazily, then never unmount. Rendering the frame from the start would
  // pull the whole bot down on the Dashboard, where nobody asked for it;
  // unmounting when you navigate away would throw away the thing we are trying
  // to keep. So: nothing until the first visit, then it stays for the session.
  const [hasBeenRequested, setHasBeenRequested] = useState(false);
  useEffect(() => {
    if (isActive) setHasBeenRequested(true);
  }, [isActive]);

  // The bot resolves its account by reading `active_loginid` from localStorage
  // once, as it opens its socket, and never re-reads it. Keying on the account
  // id remounts the frame on a switch so it reconnects as the new account;
  // authState is in there so logging in or out reloads it too.
  const frameKey = `${authState}:${activeAccount?.account_id ?? 'anon'}`;

  const hideBotTabs = route?.hideBotTabs ?? false;

  // Same-origin, so we can reach in and restyle the bot.
  //
  // One <style> element, reused: the rules depend on which route you are on, so
  // appending a fresh one per navigation would stack them and the earliest
  // would never stop applying. Rewriting textContent keeps exactly one source
  // of truth. The element is re-created if the frame reloaded out from under us
  // (an account switch), which is why we check it is still in the document.
  const applyChrome = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.head) return;

    if (!styleRef.current || !doc.contains(styleRef.current)) {
      styleRef.current = doc.createElement('style');
      doc.head.appendChild(styleRef.current);
    }

    styleRef.current.textContent = `
      /* The bot's own logo and account row would stack a second header
         under ours. */
      .app-header { display: none !important; }
      .layout { padding-top: 0 !important; }
      ${
        hideBotTabs
          ? `/* The bot's page tabs — Dashboard, Bot Builder, Charts, Tutorials.
                Class comes from <Tabs className='main__tabs'>, which the
                component expands into dc-tabs__list--header--main__tabs. */
             .dc-tabs__list--header--main__tabs { display: none !important; }`
          : ''
      }
    `;
  }, [hideBotTabs]);

  /**
   * Make SmartCharts re-measure by genuinely resizing the frame.
   *
   * The chart comes up stalled inside this frame — price line and digit strip
   * both frozen — and dragging the browser window revives it instantly.
   *
   * Dispatching a synthetic 'resize' event at the frame does nothing, which is
   * the tell: a fired event changes no geometry, and a ResizeObserver only
   * reacts to real size changes. Dragging the window worked because the iframe
   * actually got wider. So this shrinks it by a pixel and puts it back, two
   * frames later to be sure the browser lays out in between rather than
   * collapsing both writes into one.
   *
   * A pixel is invisible but real, which is exactly what the observer needs.
   */
  const nudgeLayout = useCallback(() => {
    LAYOUT_NUDGE_DELAYS_MS.forEach(delay => {
      window.setTimeout(() => {
        // Re-read the ref each time: an account switch may have replaced the
        // frame between scheduling and firing.
        const frame = frameRef.current;
        if (!frame) return;

        frame.style.width = 'calc(100% - 1px)';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (frameRef.current) frameRef.current.style.width = '100%';
          });
        });
      }, delay);
    });
  }, []);

  // Drive the frame to the tab this route wants, restyle it, then unstick it.
  //
  // Polling rather than firing once on load: the effect can run before the bot
  // has rendered its tabs, and onLoad only tells us the document arrived, not
  // that React inside it has mounted. Re-runs when the route changes, so the
  // chrome rules follow you between Charts and Bot Builder, and on frameKey so
  // an account switch re-applies everything to the fresh frame.
  useEffect(() => {
    if (!route) return;

    let cancelled = false;
    const deadline = Date.now() + TAB_POLL_TIMEOUT_MS;

    const selectTab = () => {
      if (cancelled) return;

      const doc = frameRef.current?.contentDocument;
      // The id gains a `--disabled` suffix while a chart or TradingView modal
      // is open, so match both rather than missing the tab entirely.
      const tab = doc?.querySelector<HTMLElement>(
        `#${route.tabId}, #${route.tabId}--disabled`
      );

      if (tab) {
        tab.click();
        applyChrome();
        nudgeLayout();
        return;
      }

      if (Date.now() < deadline) {
        window.setTimeout(selectTab, TAB_POLL_INTERVAL_MS);
      }
    };

    selectTab();
    return () => {
      cancelled = true;
    };
  }, [route, frameKey, applyChrome, nudgeLayout]);

  if (!hasBeenRequested) return null;

  return (
    <div
      aria-hidden={!isActive}
      // Parked off to the side rather than display:none when inactive.
      // SmartCharts sizes its canvas to the container; collapsing that to zero
      // and restoring it tends to bring the chart back blank or mis-scaled.
      // Translating keeps the box its full size, so nothing has to re-measure.
      className={[
        'fixed inset-x-0 bottom-0',
        isActive ? '' : 'pointer-events-none -translate-x-[200vw]',
      ].join(' ')}
      style={{ top: NAV_HEIGHT }}
    >
      <iframe
        key={frameKey}
        ref={frameRef}
        src="/bot/preview"
        title="Deriv Bot"
        onLoad={applyChrome}
        className="h-full border-0"
        // Width is driven from nudgeLayout, so it is set here rather than with
        // a w-full class an inline style would have to fight.
        style={{ width: '100%' }}
        // Same-origin needs no sandbox relaxation; clipboard is for block copy/paste.
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
