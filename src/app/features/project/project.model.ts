import { IssueIntegrationCfgs, IssueProviderKey } from '../issue/issue.model';
import {
  WorkContextAdvancedCfgKey,
  WorkContextCommon,
} from '../work-context/work-context.model';
import { EntityState } from '@ngrx/entity';
// Import the unified Project type from plugin-api
import { Project as PluginProject } from '@super-productivity/plugin-api';
import type { PersonalProgressOnProject } from '../personal-progress/personal-progress.model';

// Lives in util/ so pure rounding helpers (round-time, round-duration) can
// consume it without importing from features/ (layer boundary). Re-exported
// here to keep the canonical import site stable for feature code.
export type { RoundTimeOption } from '../../util/round-time-option.model';

export interface ProjectBasicCfg {
  title: string;
  // TODO remove maybe
  isArchived?: boolean;
  // Completed projects are a celebrated finish; completing also sets isArchived
  // (so the project hides from the active menu), but isDone stays distinct so a
  // finish can be told apart from a quietly-shelved archive.
  isDone?: boolean;
  doneOn?: number | null;
  isHiddenFromMenu?: boolean;
  isEnableBacklog?: boolean;
  taskIds: string[];
  backlogTaskIds: string[];
  noteIds: string[];
}

// Omit conflicting properties from PluginProject when extending
export interface ProjectCopy
  extends
    Omit<PluginProject, 'advancedCfg' | 'theme'>,
    ProjectBasicCfg,
    WorkContextCommon {
  // Additional app-specific fields
  issueIntegrationCfgs?: IssueIntegrationCfgs;

  /**
   * Manual daily entries for this project. Optional for data written before
   * this feature; read it through `personalProjectData()`. Completion entries
   * live on the completed Task instead, so a completion stays one Task update.
   */
  personalProgress?: PersonalProgressOnProject;
}

export type Project = Readonly<ProjectCopy>;

export type ProjectCfgFormKey =
  | WorkContextAdvancedCfgKey
  | IssueProviderKey
  | 'basic'
  | 'theme';

export type ProjectState = EntityState<Project>;
