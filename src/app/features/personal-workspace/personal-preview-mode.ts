import { InjectionToken } from '@angular/core';

/**
 * The preview shell is enabled only by the desktop preview launch marker
 * (`window.ea.isPreviewMode()`). It is never read from a project backup,
 * localStorage or a normal query parameter.
 */
export const PERSONAL_PREVIEW_MODE = new InjectionToken<boolean>(
  'PERSONAL_PREVIEW_MODE',
  {
    providedIn: 'root',
    factory: () =>
      typeof window !== 'undefined' &&
      !!window.ea &&
      typeof window.ea.isPreviewMode === 'function' &&
      window.ea.isPreviewMode() === true,
  },
);

export const PERSONAL_PREVIEW_NAME = '项目进展';
