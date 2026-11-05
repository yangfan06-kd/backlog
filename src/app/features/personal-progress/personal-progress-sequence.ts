import type { Task } from '../tasks/task.model';
import { personalTaskData } from './personal-progress.model';

export const nextPersonalSequence = (
  tasks: readonly Task[],
  archived: readonly Task[],
  projectId: string,
): number => {
  const all = [...tasks, ...archived].filter((task) => task.projectId === projectId);
  let max = 0;
  for (const task of all) {
    for (const completion of personalTaskData(task).completions) {
      if (completion.sequence > max) max = completion.sequence;
    }
  }
  return max + 1;
};
