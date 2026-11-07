import { Project } from '../project/project.model';
import { Task } from '../tasks/task.model';
import { Note } from '../note/note.model';
import {
  personalProjectData,
  personalProjectKind,
  personalTaskData,
} from '../personal-progress/personal-progress.model';

export type PersonalSearchKind = 'project' | 'routine' | 'step' | 'record' | 'memo';

export interface PersonalSearchResult {
  id: string;
  kind: PersonalSearchKind;
  title: string;
  subtitle: string;
  route: string;
  queryParams?: Record<string, string>;
  score: number;
  projectId?: string;
  day?: string;
  archived?: boolean;
}

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

const scoreText = (value: string, query: string): number => {
  const text = normalize(value);
  if (!text || !query) return 0;
  if (text === query) return 100;
  if (text.startsWith(query)) return 80;
  const index = text.indexOf(query);
  if (index < 0) return 0;
  return 50 - Math.min(20, index);
};

const result = (
  value: Omit<PersonalSearchResult, 'score'>,
  score: number,
): PersonalSearchResult => ({ ...value, score });

/**
 * Pure, local-only search projection. It deliberately does not index archived
 * or deleted data; search is a navigation aid, not a second database.
 */
export const buildPersonalSearchResults = (
  projects: readonly Project[],
  tasks: readonly Task[],
  notes: readonly Note[],
  rawQuery: string,
  limit = 24,
): PersonalSearchResult[] => {
  const query = normalize(rawQuery);
  if (!query) return [];

  const activeProjects = projects.filter(
    (project) => !project.isArchived && personalProjectKind(project) !== 'routine',
  );
  const projectTitles = new Map(
    activeProjects.map((project) => [project.id, project.title]),
  );
  const results: PersonalSearchResult[] = [];

  for (const project of projects) {
    if (project.personalProgress?.trash?.deletedAt) continue;
    const kind = personalProjectKind(project);
    const score = scoreText(project.title, query);
    if (score > 0) {
      const archived = project.isArchived;
      results.push(
        result(
          {
            id: `project:${project.id}`,
            kind: kind === 'routine' ? 'routine' : 'project',
            title: project.title,
            subtitle: archived
              ? kind === 'routine'
                ? '已归档 · 常态事项'
                : '已归档 · 项目'
              : kind === 'routine'
                ? '常态事项'
                : '项目',
            route: archived
              ? '/personal-archive'
              : kind === 'routine'
                ? '/personal-routine'
                : '/personal-progress',
            ...(!archived && kind === 'project'
              ? { queryParams: { projectId: project.id } }
              : {}),
            projectId: project.id,
            archived,
          },
          score,
        ),
      );
    }
  }

  for (const task of tasks) {
    if (task.isDone || task.parentId) continue;
    const projectTitle = projectTitles.get(task.projectId);
    if (!projectTitle) continue;
    const score = scoreText(task.title, query);
    if (score > 0) {
      results.push(
        result(
          {
            id: `step:${task.id}`,
            kind: 'step',
            title: task.title,
            subtitle: projectTitle,
            route: '/personal-progress',
            queryParams: { projectId: task.projectId },
            projectId: task.projectId,
          },
          score,
        ),
      );
    }
  }

  for (const project of activeProjects) {
    for (const entry of personalProjectData(project).entries) {
      const score = scoreText(entry.body, query);
      if (score > 0) {
        results.push(
          result(
            {
              id: `record:${entry.id}`,
              kind: 'record',
              title: entry.body,
              subtitle: `${project.title} · 记录`,
              route: '/personal-progress',
              queryParams: { projectId: project.id },
              projectId: project.id,
              day: entry.recordDay,
            },
            score,
          ),
        );
      }
    }
  }

  for (const task of tasks) {
    if (task.parentId) continue;
    const projectTitle = projectTitles.get(task.projectId);
    if (!projectTitle) continue;
    for (const entry of personalTaskData(task).entries) {
      const score = scoreText(entry.body, query);
      if (score > 0) {
        results.push(
          result(
            {
              id: `record:${entry.id}`,
              kind: 'record',
              title: entry.body,
              subtitle: `${projectTitle} · 记录`,
              route: '/personal-progress',
              queryParams: { projectId: task.projectId },
              projectId: task.projectId,
              day: entry.recordDay,
            },
            score,
          ),
        );
      }
    }
  }

  for (const note of notes) {
    if (!note.personalMemo || note.personalMemo.deletedAt) continue;
    const score = scoreText(note.content, query);
    if (score > 0) {
      results.push(
        result(
          {
            id: `memo:${note.id}`,
            kind: 'memo',
            title: note.content,
            subtitle: '备忘',
            route: '/personal-memo',
          },
          score,
        ),
      );
    }
  }

  return results
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'))
    .slice(0, limit);
};
