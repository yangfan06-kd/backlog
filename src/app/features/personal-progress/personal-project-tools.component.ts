import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatMenuModule } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { Project } from '../project/project.model';
import { RenameProjectInput } from './personal-project-management.service';
import { personalProjectKind, personalProjectQuadrant } from './personal-progress.model';
import { PERSONAL_OVERVIEW_GROUPS } from '../personal-overview/personal-overview.view';

@Component({
  standalone: true,
  imports: [MatDialogModule, FormsModule],
  template: `
    <h2 mat-dialog-title>重命名</h2>
    <mat-dialog-content
      ><label class="project1-date-field"
        >名称<input
          type="text"
          data-testid="pm-rename-title"
          aria-label="名称"
          [(ngModel)]="title"
          (keyup.enter)="save()" /></label
    ></mat-dialog-content>
    <mat-dialog-actions align="end"
      ><button
        type="button"
        mat-dialog-close
      >
        取消</button
      ><button
        type="button"
        class="project1-primary"
        data-testid="pm-rename-save"
        [disabled]="!title.trim()"
        (click)="save()"
      >
        保存
      </button></mat-dialog-actions
    >
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalProjectRenameDialogComponent {
  private _dialog = inject(MatDialogRef<PersonalProjectRenameDialogComponent>);
  title = inject<string>(MAT_DIALOG_DATA);
  save(): void {
    if (this.title.trim()) this._dialog.close(this.title.trim());
  }
}

@Component({
  standalone: true,
  imports: [MatDialogModule],
  template: `
    <h2 mat-dialog-title>删除“{{ title }}”？</h2>
    <mat-dialog-content>内容会移入回收站，可以恢复。</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        type="button"
        mat-dialog-close
      >
        取消
      </button>
      <button
        type="button"
        class="project1-danger"
        data-testid="pm-confirm-trash"
        [mat-dialog-close]="true"
      >
        移入回收站
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalProjectDeleteDialogComponent {
  readonly title = inject<string>(MAT_DIALOG_DATA);
}

@Component({
  standalone: true,
  imports: [MatDialogModule, FormsModule],
  template: `
    <h2 mat-dialog-title>计划日期</h2>
    <mat-dialog-content>
      <label class="project1-date-field"
        >{{ data.title
        }}<input
          type="date"
          data-testid="pm-plan-day"
          aria-label="计划日期"
          [(ngModel)]="day"
      /></label>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        type="button"
        mat-dialog-close
      >
        取消
      </button>
      <button
        type="button"
        data-testid="pm-clear-plan"
        [mat-dialog-close]="{ day: null }"
      >
        清除日期
      </button>
      <button
        type="button"
        class="project1-primary"
        data-testid="pm-save-plan"
        [disabled]="!day"
        [mat-dialog-close]="{ day }"
      >
        保存
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalProjectPlanDialogComponent {
  readonly data = inject<{ title: string; day: string }>(MAT_DIALOG_DATA);
  day = this.data.day;
}

@Component({
  selector: 'personal-project-tools',
  standalone: true,
  imports: [MatMenuModule, TranslatePipe],
  template: `
    <button
      type="button"
      class="pm-menu"
      data-testid="pm-menu"
      [disabled]="disabled()"
      [attr.aria-label]="project().title + '：更多操作'"
      [matMenuTriggerFor]="menu"
    >
      更多
    </button>
    <mat-menu
      #menu="matMenu"
      class="project1-menu"
    >
      <button
        mat-menu-item
        type="button"
        data-testid="pm-open-rename"
        (click)="openRename()"
      >
        重命名
      </button>
      @if (!isRoutine()) {
        <button
          mat-menu-item
          type="button"
          data-testid="pm-open-plan"
          (click)="openPlan()"
        >
          设置计划日期
        </button>
      }
      @if (!isRoutine()) {
        <button
          mat-menu-item
          type="button"
          data-testid="pm-quadrant-trigger"
          [matMenuTriggerFor]="quadrantMenu"
        >
          <span>四象限</span>
          <span class="pm-submenu-arrow">›</span>
        </button>
        <mat-menu
          #quadrantMenu="matMenu"
          class="project1-menu"
        >
          @for (option of quadrantOptions; track option.id) {
            <button
              mat-menu-item
              type="button"
              [attr.data-testid]="'pm-quadrant-' + option.id"
              (click)="quadrantChanged.emit(option.id)"
            >
              <span>{{ option.labelKey | translate }}</span>
              @if (currentQuadrant() === option.id) {
                <span class="pm-check">✓</span>
              }
            </button>
          }
        </mat-menu>
      }
      @if (allowConversion()) {
        <button
          mat-menu-item
          type="button"
          data-testid="pm-convert"
          (click)="conversionRequested.emit()"
        >
          {{ isRoutine() ? '变更为项目进展' : '变更为常态事项' }}
        </button>
      }
      @if (folderName()) {
        <button
          mat-menu-item
          type="button"
          data-testid="pm-remove-from-folder"
          (click)="removeFromFolder.emit()"
        >
          移出文件夹
        </button>
      }
      <button
        mat-menu-item
        type="button"
        data-testid="pm-trash"
        (click)="confirmDelete()"
      >
        {{ isRoutine() ? '删除事项' : '删除项目' }}
      </button>
    </mat-menu>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .pm-section-label {
        padding: 8px 12px 3px;
        color: var(--text-color-muted);
        font-size: 11px;
        letter-spacing: 0.04em;
      }
      .pm-check {
        margin-left: auto;
        color: var(--c-primary);
      }
      .pm-submenu-arrow {
        margin-left: auto;
        color: var(--text-color-muted);
      }
      .pm-menu {
        min-height: 32px;
        padding: 0 10px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--text-color-muted);
        font: inherit;
        cursor: pointer;
      }
      .pm-menu:hover {
        background: var(--project1-hover-bg, #eef2fa);
        color: var(--text-color);
      }
      .pm-menu:focus-visible {
        outline: 2px solid var(--c-primary);
        outline-offset: 2px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalProjectToolsComponent {
  readonly project = input.required<Project>();
  readonly disabled = input(false);
  readonly allowConversion = input(false);
  readonly planChanged = output<string | null>();
  readonly trashConfirmed = output<void>();
  readonly conversionRequested = output<void>();
  readonly quadrantChanged = output<string>();
  readonly folderName = input<string | null>(null);
  readonly removeFromFolder = output<void>();
  readonly quadrantOptions = PERSONAL_OVERVIEW_GROUPS;
  readonly renamed = output<Omit<RenameProjectInput, 'operationId'>>();
  private _dialog = inject(MatDialog);
  private _destroy = inject(DestroyRef);
  isRoutine(): boolean {
    return personalProjectKind(this.project()) === 'routine';
  }

  currentQuadrant(): string {
    const value = personalProjectQuadrant(this.project()).value;
    return value ?? 'unclassified';
  }

  openRename(): void {
    if (this.disabled()) return;
    const project = this.project();
    this._dialog
      .open(PersonalProjectRenameDialogComponent, {
        panelClass: 'project1-dialog',
        width: '420px',
        data: project.title,
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this._destroy))
      .subscribe((title) => {
        if (typeof title === 'string' && title.trim() && !this.disabled())
          this.renamed.emit({
            projectId: project.id,
            ownerKind: this.isRoutine() ? 'routine' : 'project',
            expectedTitle: project.title,
            expectedRevision: project.personalProgress?.nameEdit?.revision ?? 0,
            title,
          });
      });
  }

  openPlan(): void {
    if (this.disabled()) return;
    this._dialog
      .open(PersonalProjectPlanDialogComponent, {
        panelClass: 'project1-dialog',
        width: '400px',
        data: {
          title: this.project().title,
          day: this.project().personalProgress?.planning?.day ?? '',
        },
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this._destroy))
      .subscribe((result) => {
        if (result && !this.disabled()) this.planChanged.emit(result.day);
      });
  }

  confirmDelete(): void {
    if (this.disabled()) return;
    this._dialog
      .open(PersonalProjectDeleteDialogComponent, {
        data: this.project().title,
        panelClass: 'project1-dialog',
        width: '400px',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this._destroy))
      .subscribe((confirmed) => {
        if (confirmed === true && !this.disabled()) this.trashConfirmed.emit();
      });
  }
}
