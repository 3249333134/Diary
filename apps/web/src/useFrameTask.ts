import { useEffect, useRef } from 'react';
import { createFrameTask } from './frameTask';

export function useFrameTask(run: () => void) {
  const callback = useRef(run); callback.current = run;
  const task = useRef<ReturnType<typeof createFrameTask> | undefined>(undefined);
  if (!task.current) task.current = createFrameTask(() => callback.current());
  useEffect(() => () => task.current!.cancel(), []);
  return task.current;
}
