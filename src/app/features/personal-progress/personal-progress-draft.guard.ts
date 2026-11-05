import { Injectable } from '@angular/core';
import { CanDeactivate } from '@angular/router';

interface DraftHost {
  canDeactivate(): Promise<boolean>;
}

/**
 * The page owns one business edit draft. A route change must not silently
 * discard it, so the component resolves save/discard/continue before Angular
 * deactivates the page.
 */
@Injectable({ providedIn: 'root' })
export class PersonalProgressDraftGuard implements CanDeactivate<DraftHost> {
  canDeactivate(component: DraftHost): Promise<boolean> {
    return component.canDeactivate();
  }
}
