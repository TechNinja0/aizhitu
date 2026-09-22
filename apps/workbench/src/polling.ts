// Schedule after completion, so slow/offline requests never overlap.
export function startPolling(
  task: () => void | Promise<void>,
  interval: number,
  {
    background = null,
    immediate = true,
  }: { background?: number | null; immediate?: boolean } = {},
) {
  let stopped = false,
    inFlight = false,
    wakePending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const delay = () =>
    document.visibilityState === "hidden" ? background : interval;
  const schedule = () => {
    clearTimeout(timer);
    const ms = delay();
    if (!stopped && ms !== null) timer = setTimeout(run, ms);
  };
  const run = async () => {
    if (stopped || inFlight) return;
    if (delay() === null) return;
    inFlight = true;
    try {
      await task();
    } finally {
      inFlight = false;
      if (wakePending && !stopped) {
        wakePending = false;
        timer = setTimeout(run, 0);
      } else schedule();
    }
  };
  const visible = () => {
    clearTimeout(timer);
    if (document.visibilityState === "hidden") {
      schedule();
      return;
    }
    if (inFlight) wakePending = true;
    else void run();
  };
  document.addEventListener("visibilitychange", visible);
  if (immediate) void run();
  else schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", visible);
  };
}
