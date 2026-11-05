import { Task } from '../tasks/task.model';
import { PersonalCompletionReceipt, personalTaskData } from './personal-progress.model';

/** Include archived tasks when choosing the latest fact; never skip an edited
 * or locked entry to make an older completion appear eligible. */
export const latestProjectCompletion = (
  tasks: readonly Task[],
  projectId: string,
): { task: Task; completion: PersonalCompletionReceipt } | null => {
  let latest: { task: Task; completion: PersonalCompletionReceipt } | null = null;
  for (const task of tasks) {
    if (task.projectId !== projectId || task.parentId) continue;
    for (const completion of personalTaskData(task).completions) {
      if (completion.undoneAt) continue;
      if (
        !latest ||
        completion.sequence > latest.completion.sequence ||
        (completion.sequence === latest.completion.sequence &&
          completion.id > latest.completion.id)
      )
        latest = { task, completion };
    }
  }
  return latest;
};
