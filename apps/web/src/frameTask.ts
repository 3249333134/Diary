/** Coalesce pointer work into a paint; flush the last position before releasing. */
export function createFrameTask(run: () => void) {
  let frame: number | undefined;
  const cancel = () => { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined; };
  return {
    schedule() { if (frame === undefined) frame = requestAnimationFrame(() => { frame = undefined; run(); }); },
    flush() { if (frame !== undefined) { cancel(); run(); } },
    cancel,
  };
}
