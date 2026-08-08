/**
 * ui/useNow.ts — a ticking clock for the SEC 5.6 countdowns.
 *
 * "All keys cooling → Toast: 'All keys are rate-limited — ready again in 00:47.' Countdown, retry
 *  button." A countdown that does not count down is worse than a static timestamp, so the key
 * manager and the popup subscribe to this.
 *
 * The interval is torn down when nothing needs it (`active === false`), which matters in the popup:
 * a 1 Hz timer running for the twenty seconds a popup is open is fine, one running forever is not.
 */

import { useEffect, useState } from 'react';

export function useNow(intervalMs = 1_000, active = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, active]);

  return now;
}
