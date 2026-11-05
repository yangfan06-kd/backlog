import { inject, Injectable, signal } from '@angular/core';
import { CanDeactivate } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class PersonalBackupActivityService {
  readonly isBusy = signal(false);
}

@Injectable({ providedIn: 'root' })
export class PersonalBackupGuard implements CanDeactivate<unknown> {
  private readonly _activity = inject(PersonalBackupActivityService);

  canDeactivate(): boolean {
    return !this._activity.isBusy();
  }
}
