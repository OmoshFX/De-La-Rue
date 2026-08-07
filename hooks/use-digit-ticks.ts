'use client';

import { useState, useEffect, useRef } from 'react';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { getLastDigit } from '@/lib/digit-stats';

export interface DigitTick {
  digit: number;
  even: boolean;
  timestamp: number;
  quote: number;
}

interface UseDigitTicksReturn {
  digits: DigitTick[];
  connected: boolean;
  hasData: boolean;
  pipSize: number;
  lastQuote: string;
}

/**
 * Infer decimal places from a batch of prices.
 *
 * Fallback for when ticks_history omits pip_size. Across a full history batch
 * the odds of every price having a trailing zero in the final place are
 * negligible, so the observed maximum is reliable.
 */
function inferPipSize(prices: number[]): number {
  let max = 0;
  for (const price of prices) {
    const str = String(price);
    const dot = str.indexOf('.');
    if (dot !== -1) max = Math.max(max, str.length - dot - 1);
  }
  return max;
}

interface TicksHistoryLike {
  history?: { prices: number[]; times: number[] };
  pip_size?: number;
}

/**
 * Stream last-digit data for a symbol over the app's shared DerivWS connection.
 *
 * Runs under this app's own registration, and is automatically authenticated
 * whenever the user is logged in, because the provider connects to the OTP URL
 * in that case.
 */
export function useDigitTicks(symbol: string, historySize = 100): UseDigitTicksReturn {
  const { ws, isConnected } = useDerivWSContext();
  const [digits, setDigits] = useState<DigitTick[]>([]);
  const [pipSize, setPipSize] = useState(2);
  const [lastQuote, setLastQuote] = useState('');
  const pipRef = useRef(2);

  useEffect(() => {
    if (!ws || !isConnected || !symbol) return;

    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    setDigits([]);
    setLastQuote('');

    async function stream() {
      const history = await ws!.send<TicksHistoryLike>({
        ticks_history: symbol,
        end: 'latest',
        start: 1,
        count: historySize,
        style: 'ticks',
      });
      if (disposed) return;

      const prices = history.history?.prices ?? [];
      const times = history.history?.times ?? [];
      const pip = history.pip_size ?? inferPipSize(prices);
      pipRef.current = pip;
      setPipSize(pip);

      setDigits(
        prices.map((price, i) => {
          const digit = getLastDigit(price, pip);
          return { digit, even: digit % 2 === 0, timestamp: times[i], quote: price };
        })
      );

      const sub = await ws!.subscribe({ ticks: symbol }, (data) => {
        const tick = (data as { tick?: { quote: number; epoch: number; pip_size?: number } }).tick;
        if (!tick) return;

        const pipNow = tick.pip_size ?? pipRef.current;
        if (pipNow !== pipRef.current) {
          pipRef.current = pipNow;
          setPipSize(pipNow);
        }

        const digit = getLastDigit(tick.quote, pipNow);
        setLastQuote(tick.quote.toFixed(pipNow));
        setDigits((prev) =>
          [
            ...prev,
            { digit, even: digit % 2 === 0, timestamp: tick.epoch, quote: tick.quote },
          ].slice(-historySize)
        );
      });

      if (disposed) {
        sub.unsubscribe();
        return;
      }
      unsubscribe = sub.unsubscribe;
    }

    stream().catch(() => {});

    return () => {
      disposed = true;
      unsubscribe?.();
      // Clear the server-side stream so remounting does not hit AlreadySubscribed.
      if (ws?.isConnected) {
        ws.send({ forget_all: 'ticks' }).catch(() => {});
      }
    };
  }, [ws, isConnected, symbol, historySize]);

  return {
    digits,
    connected: isConnected,
    hasData: digits.length > 0,
    pipSize,
    lastQuote,
  };
}
