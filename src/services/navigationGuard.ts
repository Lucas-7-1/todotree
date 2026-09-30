type Guard = () => Promise<boolean | void> | boolean | void;
type NavigationEvent = CustomEvent<{ waitUntil: (work: Promise<boolean | void>) => void }>;
let preparing = false;

/** Editors persist their current draft before a mode switch or notification deep link. */
export function registerNavigationGuard(guard: Guard): () => void {
  const listener = (event: Event) => {
    (event as NavigationEvent).detail.waitUntil(Promise.resolve().then(guard));
  };
  window.addEventListener('todotree:prepare-navigation', listener);
  return () => window.removeEventListener('todotree:prepare-navigation', listener);
}

export async function prepareNavigation(): Promise<boolean> {
  if (preparing) return false;
  preparing = true;
  try {
    const work: Promise<boolean | void>[] = [];
    window.dispatchEvent(new CustomEvent('todotree:prepare-navigation', {
      detail: { waitUntil: (promise: Promise<boolean | void>) => work.push(promise) },
    }));
    const results = await Promise.allSettled(work);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
    return results.every(result => result.status === 'fulfilled' && result.value !== false);
  } finally {
    preparing = false;
  }
}
