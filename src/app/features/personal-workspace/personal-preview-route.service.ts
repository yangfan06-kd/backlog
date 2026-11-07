import { inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { PERSONAL_PREVIEW_MODE } from './personal-preview-mode';

const PREVIEW_ROUTES = [
  '/personal-overview',
  '/personal-search',
  '/personal-review',
  '/personal-progress',
  '/personal-routine',
  '/personal-archive',
  '/personal-memo',
  '/personal-backup',
  '/personal-about',
  '/personal-settings',
];

/**
 * Keeps the preview shell on a supported entry point. It runs after normal
 * route guards, so an editor's save/discard/continue decision is never skipped:
 * leaving an editor already has to pass its own guard before this sees a URL.
 */
@Injectable({ providedIn: 'root' })
export class PersonalPreviewRouteService {
  private readonly _router = inject(Router);
  private readonly _isPreviewMode = inject(PERSONAL_PREVIEW_MODE);

  constructor() {
    if (!this._isPreviewMode) return;
    this._router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const path = event.urlAfterRedirects.split('?')[0];
        if (!PREVIEW_ROUTES.some((route) => path === route)) {
          void this._router.navigate(['/personal-progress'], { replaceUrl: true });
        }
      });
  }
}
