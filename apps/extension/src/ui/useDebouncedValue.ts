/**
 * ui/useDebouncedValue.ts — keeps search boxes from hammering the service worker.
 *
 * The tracker and Answer Bank searches are full scans over IndexedDB behind a bus round-trip. Typed
 * straight through, "engineer" is nine of them. This holds the value still until the user pauses.
 */

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
