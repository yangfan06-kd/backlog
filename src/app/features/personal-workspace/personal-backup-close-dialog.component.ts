import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'personal-backup-close-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ 'PERSONAL_BACKUP.AUTO_FAILED' | translate }}</h2>
    <mat-dialog-content>{{
      'PERSONAL_BACKUP.AUTO_CLOSE_SAVED' | translate
    }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        mat-dialog-close="return"
        data-testid="pb-close-return"
      >
        {{ 'PERSONAL_BACKUP.AUTO_CLOSE_RETURN' | translate }}
      </button>
      <button
        mat-button
        mat-dialog-close="retry"
        data-testid="pb-close-retry"
      >
        {{ 'PERSONAL_BACKUP.AUTO_CLOSE_RETRY' | translate }}
      </button>
      <button
        mat-button
        mat-dialog-close="exit"
        data-testid="pb-close-exit"
      >
        {{ 'PERSONAL_BACKUP.AUTO_CLOSE_EXIT' | translate }}
      </button>
    </mat-dialog-actions>
  `,
})
export class PersonalBackupCloseDialogComponent {}
