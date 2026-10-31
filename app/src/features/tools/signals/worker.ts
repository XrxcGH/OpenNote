// The signals kit's worker: runs the long engines (shared/tasks.ts) off the main thread for useTask.
import { serveTasks, type TaskFn, type WorkerScope } from '../subjects/num/worker';
import { SIGNAL_TASKS } from './shared/tasks';

serveTasks(SIGNAL_TASKS as unknown as Record<string, TaskFn<never, unknown>>, self as unknown as WorkerScope);
