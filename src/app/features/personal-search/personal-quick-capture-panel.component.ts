import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { nanoid } from 'nanoid';
import { selectAllProjects } from '../project/store/project.selectors';
import { SnackService } from '../../core/snack/snack.service';
import { PersonalProgressService } from '../personal-progress/personal-progress.service';
import { personalProjectKind } from '../personal-progress/personal-progress.model';
import { PersonalMemoService } from '../personal-memo/personal-memo.service';
import { PersonalQuickCaptureService } from './personal-quick-capture.service';

type CaptureTarget = 'project' | 'routine' | 'memo';
const TARGET_KEY = 'project1.quick-capture.target';

@Component({
  selector: 'personal-quick-capture-panel',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="quick-capture"
      data-testid="personal-quick-capture"
      role="dialog"
      aria-modal="false"
      aria-label="快速记录"
      [style.transform]="panelTransform()"
    >
      <header
        class="quick-head"
        title="按住拖动，移动快记面板"
        (pointerdown)="startDrag($event)"
        (pointermove)="onDrag($event)"
        (pointerup)="endDrag($event)"
        (pointercancel)="endDrag($event)"
      >
        <div>
          <h2>快记</h2>
          <p>记录到今天；备忘单独保存。</p>
        </div>
        <button
          type="button"
          class="quick-close"
          aria-label="关闭快速记录"
          data-testid="personal-quick-capture-close"
          (click)="close()"
        >
          ×
        </button>
      </header>

      <div
        class="quick-kinds"
        role="tablist"
        aria-label="记录类型"
      >
        <button
          type="button"
          role="tab"
          class="quick-kind"
          data-testid="personal-quick-kind-project"
          [class.is-active]="target() === 'project'"
          [attr.aria-selected]="target() === 'project'"
          (click)="setTarget('project')"
        >
          项目进展
        </button>
        <button
          type="button"
          role="tab"
          class="quick-kind"
          data-testid="personal-quick-kind-routine"
          [class.is-active]="target() === 'routine'"
          [attr.aria-selected]="target() === 'routine'"
          (click)="setTarget('routine')"
        >
          常态事项
        </button>
        <button
          type="button"
          role="tab"
          class="quick-kind"
          data-testid="personal-quick-kind-memo"
          [class.is-active]="target() === 'memo'"
          [attr.aria-selected]="target() === 'memo'"
          (click)="setTarget('memo')"
        >
          备忘
        </button>
      </div>

      @if (target() === 'project') {
        @if (projects().length === 0) {
          <p class="quick-empty">还没有可记录的项目。</p>
        } @else {
          <label
            class="quick-label"
            for="personal-quick-project"
            >记录到</label
          >
          <select
            id="personal-quick-project"
            class="quick-project"
            data-testid="personal-quick-project"
            [ngModel]="selectedProjectId()"
            (ngModelChange)="selectedProjectId.set($event)"
          >
            @for (project of projects(); track project.id) {
              <option [value]="project.id">{{ project.title }}</option>
            }
          </select>
        }
      } @else if (target() === 'routine') {
        @if (routines().length === 0) {
          <p class="quick-empty">还没有可记录的常态事项。</p>
        } @else {
          <label
            class="quick-label"
            for="personal-quick-routine"
            >记录到</label
          >
          <select
            id="personal-quick-routine"
            class="quick-project"
            data-testid="personal-quick-routine"
            [ngModel]="selectedRoutineId()"
            (ngModelChange)="selectedRoutineId.set($event)"
          >
            @for (routine of routines(); track routine.id) {
              <option [value]="routine.id">{{ routine.title }}</option>
            }
          </select>
        }
      } @else {
        <p class="quick-memo-note">保存为一条备忘，不需要选择项目。</p>
      }

      @if (hasTarget()) {
        <label
          class="quick-label"
          for="personal-quick-body"
          >{{ bodyLabel() }}</label
        >
        <textarea
          #bodyInput
          id="personal-quick-body"
          class="quick-body"
          data-testid="personal-quick-body"
          rows="3"
          [placeholder]="bodyPlaceholder()"
          [ngModel]="body()"
          (ngModelChange)="body.set($event)"
          (keydown)="onBodyKeydown($event)"
        ></textarea>

        <div class="quick-foot">
          <span class="quick-day">{{ footLabel() }}</span>
          <div class="quick-actions">
            <button
              type="button"
              class="quick-secondary"
              (click)="close()"
            >
              取消
            </button>
            <button
              type="button"
              class="quick-primary"
              data-testid="personal-quick-save"
              [disabled]="isSaving() || !canSave()"
              (click)="save()"
            >
              {{ isSaving() ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
        <p class="quick-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> 保存</p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        position: fixed;
        z-index: 1200;
        top: 72px;
        right: 24px;
        display: block;
        width: min(360px, calc(100vw - 32px));
      }

      .quick-capture {
        padding: var(--s2);
        border: 1px solid var(--separator-color);
        border-radius: var(--radius-sm);
        background: var(--card-bg);
        box-shadow: 0 14px 36px rgb(0 0 0 / 22%);
      }

      .quick-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--s);
        margin-bottom: var(--s2);
        cursor: grab;
        touch-action: none;
        user-select: none;
      }

      .quick-head:active {
        cursor: grabbing;
      }

      .quick-head h2 {
        margin: 0 0 var(--s-half);
        color: var(--text-color);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
      }

      .quick-head p {
        margin: 0;
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
        line-height: 1.5;
      }

      .quick-kinds {
        display: flex;
        gap: 3px;
        margin-bottom: var(--s2);
        padding: 3px;
        border-radius: 6px;
        background: var(--bg);
      }

      .quick-kind {
        min-height: 28px;
        flex: 1;
        padding: 0 var(--s-half);
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: var(--text-color-muted);
        font: inherit;
        font-size: var(--font-size-xs);
        cursor: pointer;
      }

      .quick-kind.is-active {
        background: var(--card-bg);
        color: var(--text-color);
        box-shadow: 0 1px 2px rgb(0 0 0 / 12%);
      }

      .quick-memo-note {
        margin: 0 0 var(--s2);
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      .quick-close {
        display: grid;
        width: 24px;
        height: 24px;
        flex: 0 0 24px;
        place-items: center;
        border: 0;
        border-radius: 50%;
        background: var(--bg);
        color: var(--text-color-muted);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }

      .quick-label {
        display: block;
        margin: 0 0 var(--s-half);
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      .quick-project,
      .quick-body {
        width: 100%;
        border: 1px solid var(--separator-color);
        border-radius: 6px;
        background: var(--bg);
        color: var(--text-color);
        font: inherit;
        font-size: var(--font-size-sm);
      }

      .quick-project {
        min-height: 34px;
        margin-bottom: var(--s);
        padding: 0 var(--s);
      }

      .quick-body {
        min-height: 76px;
        resize: vertical;
        padding: var(--s);
        line-height: 1.55;
      }

      .quick-project:focus,
      .quick-body:focus {
        border-color: var(--c-primary);
        outline: 0;
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--c-primary) 18%, transparent);
      }

      .quick-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--s);
        margin-top: var(--s2);
      }

      .quick-day {
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      .quick-actions {
        display: flex;
        align-items: center;
        gap: var(--s-half);
      }

      .quick-secondary,
      .quick-primary {
        min-height: 30px;
        padding: 0 var(--s2);
        border-radius: 6px;
        font: inherit;
        font-size: var(--font-size-sm);
        cursor: pointer;
      }

      .quick-secondary {
        border: 1px solid var(--separator-color);
        background: transparent;
        color: var(--text-color-muted);
      }

      .quick-primary {
        border: 1px solid var(--c-primary);
        background: var(--c-primary);
        color: var(--c-primary-contrast, #fff);
      }

      .quick-primary:disabled {
        cursor: default;
        opacity: 0.55;
      }

      .quick-hint {
        margin: var(--s) 0 0;
        color: var(--text-color-muted);
        font-size: 10px;
        text-align: right;
      }

      .quick-hint kbd {
        padding: 1px 4px;
        border: 1px solid var(--separator-color);
        border-radius: 4px;
        background: var(--bg);
        font-size: 10px;
      }

      .quick-empty {
        margin: 0;
        padding: var(--s) 0;
        color: var(--text-color-muted);
        font-size: var(--font-size-sm);
      }
    `,
  ],
})
export class PersonalQuickCapturePanelComponent implements AfterViewInit {
  private readonly _store = inject(Store);
  private readonly _router = inject(Router);
  private readonly _progress = inject(PersonalProgressService);
  private readonly _memo = inject(PersonalMemoService);
  private readonly _snack = inject(SnackService);
  private readonly _panel = inject(PersonalQuickCaptureService);
  private readonly _bodyInput = viewChild<ElementRef<HTMLTextAreaElement>>('bodyInput');
  private readonly _allProjects = toSignal(this._store.select(selectAllProjects), {
    initialValue: [],
  });

  readonly today = signal(this._progress.todayStr());
  readonly body = signal('');
  readonly isSaving = signal(false);
  readonly target = signal<CaptureTarget>(this._loadTarget());
  readonly projects = computed(() =>
    this._allProjects()
      .filter(
        (project) =>
          !project.isArchived &&
          !project.isDone &&
          !project.personalProgress?.trash?.deletedAt &&
          personalProjectKind(project) === 'project',
      )
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')),
  );
  readonly routines = computed(() =>
    this._allProjects()
      .filter(
        (project) =>
          !project.isArchived &&
          !project.isDone &&
          !project.personalProgress?.trash?.deletedAt &&
          personalProjectKind(project) === 'routine',
      )
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')),
  );
  readonly selectedProjectId = signal(this._defaultProjectId());
  readonly selectedRoutineId = signal(this._defaultRoutineId());
  readonly hasTarget = computed(() => {
    if (this.target() === 'memo') return true;
    if (this.target() === 'routine') return !!this.selectedRoutineId();
    return !!this.selectedProjectId();
  });
  readonly canSave = computed(() => !!this.body().trim() && this.hasTarget());
  readonly bodyLabel = computed(() => {
    if (this.target() === 'routine') return '记录';
    if (this.target() === 'memo') return '内容';
    return '进展';
  });
  readonly bodyPlaceholder = computed(() => {
    if (this.target() === 'routine') return '今天观察到什么…';
    if (this.target() === 'memo') return '要记住的事…';
    return '今天做了什么…';
  });
  readonly footLabel = computed(() => (this.target() === 'memo' ? '备忘' : this.today()));
  readonly position = signal(this._loadPosition());
  readonly panelTransform = computed(
    () => `translate3d(${this.position().x}px, ${this.position().y}px, 0)`,
  );
  private _drag: {
    startX: number;
    startY: number;
    x: number;
    y: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null = null;

  ngAfterViewInit(): void {
    requestAnimationFrame(() => {
      this._bodyInput()?.nativeElement.focus();
      this._bodyInput()?.nativeElement.select();
    });
  }

  setTarget(target: CaptureTarget): void {
    this.target.set(target);
    try {
      localStorage.setItem(TARGET_KEY, target);
    } catch {
      // The remembered type is only a convenience.
    }
    requestAnimationFrame(() => this._bodyInput()?.nativeElement.focus());
  }

  startDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button')) return;
    const current = this.position();
    const rect = (event.currentTarget as HTMLElement)
      .closest('.quick-capture')
      ?.getBoundingClientRect();
    const margin = 8;
    this._drag = {
      startX: event.clientX,
      startY: event.clientY,
      x: current.x,
      y: current.y,
      minX: rect ? margin - rect.left : 0,
      maxX: rect ? window.innerWidth - rect.right - margin : 0,
      minY: rect ? margin - rect.top : 0,
      maxY: rect ? window.innerHeight - rect.bottom - margin : 0,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  onDrag(event: PointerEvent): void {
    if (!this._drag) return;
    const drag = this._drag;
    this.position.set({
      x: Math.min(drag.maxX, Math.max(drag.minX, drag.x + event.clientX - drag.startX)),
      y: Math.min(drag.maxY, Math.max(drag.minY, drag.y + event.clientY - drag.startY)),
    });
  }

  endDrag(event: PointerEvent): void {
    if (!this._drag) return;
    this._drag = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    try {
      localStorage.setItem(
        'project1.quick-capture.position',
        JSON.stringify(this.position()),
      );
    } catch {
      // The position is only a convenience; storage failure must not block capture.
    }
  }

  private _loadPosition(): { x: number; y: number } {
    try {
      const saved = localStorage.getItem('project1.quick-capture.position');
      if (saved) {
        const parsed = JSON.parse(saved) as { x?: unknown; y?: unknown };
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          const minX = -Math.max(0, window.innerWidth - 360 - 48);
          const maxY = Math.max(72, window.innerHeight - 400 - 72);
          return {
            x: Math.min(0, Math.max(minX, Number(parsed.x))),
            y: Math.min(maxY, Math.max(-72, Number(parsed.y))),
          };
        }
      }
    } catch {
      // Use the default position when no readable preference exists.
    }
    return { x: 0, y: 0 };
  }

  onBodyKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void this.save();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  async save(): Promise<void> {
    const body = this.body().trim();
    if (!body || !this.hasTarget() || this.isSaving()) return;
    this.isSaving.set(true);
    try {
      if (this.target() === 'memo') {
        await this._memo.save({ text: body, format: null, remindAt: null });
        this._snack.open('已保存备忘');
      } else {
        const projectId =
          this.target() === 'routine'
            ? this.selectedRoutineId()
            : this.selectedProjectId();
        const ownerKind = this.target() === 'routine' ? 'routine' : 'project';
        const result = await this._progress.addEntry({
          operationId: nanoid(),
          projectId,
          recordDay: this.today(),
          body,
          ownerKind,
        });
        if (result.status !== 'persisted') {
          this._snack.open('快速记录没有保存成功，请重试');
          return;
        }
        const target = this._allProjects().find((item) => item.id === projectId);
        this._snack.open(`已记入 ${target?.title ?? '记录'} · 今天`);
      }
      this.body.set('');
      this._panel.close();
    } catch {
      this._snack.open('快速记录没有保存成功，请重试');
    } finally {
      this.isSaving.set(false);
    }
  }

  close(): void {
    if (this.body().trim() && !window.confirm('放弃这条未保存的内容？')) return;
    this.body.set('');
    this._panel.close();
  }

  private _loadTarget(): CaptureTarget {
    try {
      const saved = localStorage.getItem(TARGET_KEY);
      if (saved === 'project' || saved === 'routine' || saved === 'memo') {
        return saved;
      }
    } catch {
      // Fall through to the default target.
    }
    return 'project';
  }

  private _defaultRoutineId(): string {
    const query = this._router.url.split('?')[1] ?? '';
    const fromRoute = new URLSearchParams(query).get('itemId');
    const routines = this.routines();
    if (fromRoute && routines.some((routine) => routine.id === fromRoute)) {
      return fromRoute;
    }
    return routines[0]?.id ?? '';
  }

  private _defaultProjectId(): string {
    const query = this._router.url.split('?')[1] ?? '';
    const fromRoute = new URLSearchParams(query).get('projectId');
    const projects = this.projects();
    if (fromRoute && projects.some((project) => project.id === fromRoute)) {
      return fromRoute;
    }
    return projects[0]?.id ?? '';
  }
}
