import { afterEach, expect, it, vi } from 'vitest';
import { createFrameTask } from './frameTask';

afterEach(() => vi.unstubAllGlobals());

it('coalesces moves using the latest position and flushes the last move before release', () => {
  let frame: FrameRequestCallback | undefined, position = 0;
  const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; });
  const cancel = vi.fn(() => { frame = undefined; });
  vi.stubGlobal('requestAnimationFrame', request); vi.stubGlobal('cancelAnimationFrame', cancel);
  const painted: number[] = [], task = createFrameTask(() => painted.push(position));
  position = 10; task.schedule(); position = 20; task.schedule(); position = 30; task.schedule();
  expect(request).toHaveBeenCalledTimes(1); expect(painted).toEqual([]);
  frame!(16); expect(painted).toEqual([30]);
  position = 40; task.schedule(); task.flush();
  expect(cancel).toHaveBeenCalledWith(7); expect(painted).toEqual([30,40]);
  task.flush(); expect(painted).toEqual([30,40]);
});

it('cancels queued work on Escape or unmount without changing the next gesture', () => {
  const pending = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
  const run = vi.fn(), task = createFrameTask(run);
  task.schedule(); task.cancel(); task.flush(); expect(pending.size).toBe(0); expect(run).not.toHaveBeenCalled();
  task.schedule(); expect(pending.size).toBe(1); pending.get(2)!(32); expect(run).toHaveBeenCalledTimes(1);
});
