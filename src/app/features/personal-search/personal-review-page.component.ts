import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { selectAllProjects } from '../project/store/project.selectors';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { PersonalProgressService } from '../personal-progress/personal-progress.service';
import { SnackService } from '../../core/snack/snack.service';
import {
  PersonalReviewActiveProject,
  PersonalReviewCompletion,
  PersonalReviewPeriod,
  PersonalReviewStaleProject,
  buildPersonalReview,
  formatReviewDay,
  formatReviewRange,
  formatReviewSummary,
  isCurrentReviewPeriod,
  shiftReviewAnchor,
} from './personal-review.view';

@Component({
  selector: 'personal-review-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="review-page"
      data-testid="personal-review-page"
    >
      <header class="review-head">
        <div>
          <h1>复盘</h1>
          <p>回看这一段时间，决定下一步先做什么。</p>
        </div>
        <div class="review-head-actions">
          <div
            class="range-switch"
            role="group"
            aria-label="复盘范围"
          >
            <button
              type="button"
              data-testid="personal-review-week"
              [class.is-active]="period() === 'week'"
              [attr.aria-pressed]="period() === 'week'"
              (click)="setPeriod('week')"
            >
              本周
            </button>
            <button
              type="button"
              data-testid="personal-review-month"
              [class.is-active]="period() === 'month'"
              [attr.aria-pressed]="period() === 'month'"
              (click)="setPeriod('month')"
            >
              本月
            </button>
          </div>
          <div class="review-nav">
            <button
              type="button"
              data-testid="personal-review-prev"
              aria-label="上一个周期"
              title="上一个周期"
              (click)="movePeriod(-1)"
            >
              ←
            </button>
            <button
              type="button"
              data-testid="personal-review-current"
              [disabled]="isCurrentPeriod()"
              (click)="goToCurrentPeriod()"
            >
              回到{{ periodLabel() }}
            </button>
            <button
              type="button"
              data-testid="personal-review-next"
              aria-label="下一个周期"
              title="下一个周期"
              [disabled]="isCurrentPeriod()"
              (click)="movePeriod(1)"
            >
              →
            </button>
            <button
              type="button"
              data-testid="personal-review-copy"
              [disabled]="
                review().completions.length === 0 && review().activeProjects.length === 0
              "
              (click)="copySummary()"
            >
              复制摘要
            </button>
          </div>
        </div>
      </header>

      <p class="review-period">{{ rangeLabel() }}</p>

      <p class="review-summary">
        @if (review().completions.length === 0 && review().activeProjects.length === 0) {
          这一阶段还没有记录。
        } @else {
          完成 <strong>{{ review().completions.length }} 个步骤</strong>，<strong
            >{{ review().activeProjects.length }} 个项目</strong
          >有记录，
          @if (review().staleProjects.length > 0) {
            有 <strong>{{ review().staleProjects.length }} 个项目</strong>需要回看。
          } @else {
            暂时没有需要回看的项目。
          }
        }
      </p>

      <section class="review-section">
        <div class="section-head">
          <h2 class="section-title section-title-done">完成</h2>
          <span>{{ review().completions.length }} 个步骤</span>
        </div>
        @if (review().completions.length === 0) {
          <p class="section-empty">这一阶段还没有完成步骤。</p>
        } @else {
          <div class="review-list">
            @for (
              item of review().completions;
              track item.projectId + item.day + item.title
            ) {
              <button
                type="button"
                class="review-row"
                (click)="openCompletion(item)"
              >
                <span class="row-main">
                  <span class="row-title">{{ item.title }}</span>
                  <span class="row-meta"
                    >{{ item.projectTitle }} · {{ formatDay(item.day) }}</span
                  >
                </span>
                <span class="row-side">完成</span>
              </button>
            }
          </div>
        }
      </section>

      <section class="review-section">
        <div class="section-head">
          <h2 class="section-title section-title-active">有推进的项目</h2>
          <span>{{ review().activeProjects.length }} 个项目</span>
        </div>
        @if (review().activeProjects.length === 0) {
          <p class="section-empty">这一阶段还没有项目推进。</p>
        } @else {
          <div class="review-list">
            @for (item of review().activeProjects; track item.projectId) {
              <button
                type="button"
                class="review-row"
                (click)="openActiveProject(item)"
              >
                <span class="row-main">
                  <span class="row-title">{{ item.title }}</span>
                  <span class="row-meta">{{ activeMeta(item) }}</span>
                </span>
                <span class="row-side">打开 →</span>
              </button>
            }
          </div>
        }
      </section>

      <section class="review-section">
        <div class="section-head">
          <h2 class="section-title section-title-stale">需要回看</h2>
          <span>{{ review().staleProjects.length }} 个项目</span>
        </div>
        <p class="section-note">计划日期已经过去，但仍有剩余步骤。</p>
        @if (review().staleProjects.length === 0) {
          <p class="section-empty">没有需要回看的项目。</p>
        } @else {
          <div class="review-list">
            @for (item of review().staleProjects; track item.projectId) {
              <button
                type="button"
                class="review-row"
                (click)="openStaleProject(item)"
              >
                <span class="row-main">
                  <span class="row-title">{{ item.title }}</span>
                  <span class="row-meta">{{ staleMeta(item) }}</span>
                </span>
                <span class="row-side">打开 →</span>
              </button>
            }
          </div>
        }
      </section>

      <section class="review-section">
        <div class="section-head">
          <h2 class="section-title section-title-daily">每日记录</h2>
          <span>{{ review().dayCounts.length }} 天有记录</span>
        </div>
        @if (review().dayCounts.length === 0) {
          <p class="section-empty">这一阶段还没有手写记录。</p>
        } @else {
          <div class="day-strip">
            @for (day of review().dayCounts; track day.day) {
              <span class="day-chip"
                >{{ formatDay(day.day) }} <strong>{{ day.count }}</strong></span
              >
            }
          </div>
          <p class="section-note">这里只汇总已有记录，不额外生成或修改任何数据。</p>
        }
      </section>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: var(--s3);
      }

      .review-page {
        width: min(900px, 100%);
        margin: 0 auto;
        color: var(--text-color);
      }

      .review-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--s2);
        margin-bottom: var(--s);
      }

      .review-head h1 {
        margin: 0 0 var(--s-half);
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-semibold);
      }

      .review-head p {
        margin: 0;
        color: var(--text-color-muted);
        font-size: var(--font-size-sm);
      }

      .range-switch {
        display: inline-flex;
        flex: 0 0 auto;
        padding: 3px;
        border: 1px solid var(--separator-color);
        border-radius: var(--radius-sm);
        background: var(--card-bg);
      }

      .range-switch button {
        min-height: 28px;
        padding: 0 var(--s2);
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--text-color-muted);
        font: inherit;
        font-size: var(--font-size-xs);
        cursor: pointer;
      }

      .range-switch button.is-active {
        background: var(--bg);
        color: var(--text-color);
      }

      .review-head-actions {
        display: flex;
        flex: 0 0 auto;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--s-half);
      }

      .review-nav {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .review-nav button {
        min-height: 26px;
        padding: 0 var(--s-half);
        border: 1px solid var(--separator-color);
        border-radius: 5px;
        background: var(--card-bg);
        color: var(--text-color-muted);
        font: inherit;
        font-size: var(--font-size-xs);
        cursor: pointer;
      }

      .review-nav button:hover:not(:disabled) {
        color: var(--text-color);
      }

      .review-nav button:disabled {
        cursor: default;
        opacity: 0.42;
      }

      .review-period {
        margin: 0 0 var(--s2);
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      .review-summary {
        margin: 0 0 var(--s3);
        padding-bottom: var(--s2);
        border-bottom: 1px solid var(--separator-color);
        color: var(--text-color-muted);
        font-size: var(--font-size-sm);
        line-height: 1.8;
      }

      .review-summary strong {
        color: var(--text-color);
        font-weight: var(--font-weight-semibold);
      }

      .review-section {
        margin-bottom: var(--s3);
      }

      .section-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--s);
        margin-bottom: var(--s-half);
      }

      .section-head h2 {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 0;
        color: var(--text-color);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
      }

      .section-head h2::before {
        width: 6px;
        height: 6px;
        flex: 0 0 6px;
        border-radius: 50%;
        background: currentColor;
        content: '';
      }

      .section-head h2.section-title-done {
        color: var(--color-success);
      }

      .section-head h2.section-title-active {
        color: var(--c-primary);
      }

      .section-head h2.section-title-stale {
        color: var(--color-warning);
      }

      .section-head h2.section-title-daily {
        color: var(--text-color-muted);
      }

      .section-head span,
      .section-note,
      .section-empty {
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      .section-note {
        margin: 0 0 var(--s-half);
        line-height: 1.6;
      }

      .section-empty {
        margin: 0;
        padding: var(--s) 0;
        border-top: 1px solid var(--separator-color);
      }

      .review-list {
        border-top: 1px solid var(--separator-color);
      }

      .review-row {
        display: grid;
        width: 100%;
        min-height: 48px;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--s);
        padding: 7px 0;
        border: 0;
        border-bottom: 1px solid var(--separator-color);
        background: transparent;
        color: var(--text-color);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .review-row:hover .row-title {
        color: var(--c-primary);
      }

      .review-row:focus-visible {
        outline: var(--focus-ring-width) solid var(--c-primary);
        outline-offset: -1px;
      }

      .row-main {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 2px;
      }

      .row-title {
        overflow: hidden;
        color: var(--text-color);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .row-meta,
      .row-side {
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      .row-side {
        white-space: nowrap;
      }

      .day-strip {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-half);
        padding-top: 2px;
      }

      .day-chip {
        padding: 7px 9px;
        border: 1px solid var(--separator-color);
        border-radius: 6px;
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      .day-chip strong {
        color: var(--text-color);
        font-weight: var(--font-weight-semibold);
      }

      @media (max-width: 700px) {
        :host {
          padding: var(--s2);
        }

        .review-head {
          display: block;
        }

        .range-switch {
          margin-top: var(--s);
        }

        .review-head-actions {
          align-items: flex-start;
          margin-top: var(--s);
        }
      }
    `,
  ],
})
export class PersonalReviewPageComponent {
  private readonly _store = inject(Store);
  private readonly _router = inject(Router);
  private readonly _progress = inject(PersonalProgressService);
  private readonly _snack = inject(SnackService);
  private readonly _projects = toSignal(this._store.select(selectAllProjects), {
    initialValue: [],
  });
  private readonly _tasks = toSignal(this._store.select(selectAllTasks), {
    initialValue: [],
  });

  readonly period = signal<PersonalReviewPeriod>('week');
  readonly anchorDay = signal(this._progress.todayStr());
  readonly review = computed(() =>
    buildPersonalReview(
      this._projects(),
      this._tasks(),
      this._progress.todayStr(),
      this.period(),
      this.anchorDay(),
    ),
  );
  readonly rangeLabel = computed(() => formatReviewRange(this.review().range));
  readonly periodLabel = computed(() => (this.period() === 'week' ? '本周' : '本月'));
  readonly isCurrentPeriod = computed(() =>
    isCurrentReviewPeriod(this.anchorDay(), this._progress.todayStr(), this.period()),
  );

  setPeriod(period: PersonalReviewPeriod): void {
    this.period.set(period);
    this.anchorDay.set(this._progress.todayStr());
  }

  movePeriod(direction: -1 | 1): void {
    this.anchorDay.update((day) => shiftReviewAnchor(day, this.period(), direction));
  }

  goToCurrentPeriod(): void {
    this.anchorDay.set(this._progress.todayStr());
  }

  async copySummary(): Promise<void> {
    try {
      await navigator.clipboard.writeText(formatReviewSummary(this.review()));
      this._snack.open('已复制复盘摘要');
    } catch {
      this._snack.open('复制复盘摘要失败，请重试');
    }
  }

  formatDay(day: string): string {
    return formatReviewDay(day);
  }

  activeMeta(item: PersonalReviewActiveProject): string {
    const parts: string[] = [];
    if (item.completionCount > 0) parts.push(`${item.completionCount} 个步骤完成`);
    if (item.recordCount > 0) parts.push(`${item.recordCount} 条记录`);
    if (item.isRoutine) parts.push('常态事项');
    parts.push(`最近 ${this.formatDay(item.lastDay)}`);
    return parts.join(' · ');
  }

  staleMeta(item: PersonalReviewStaleProject): string {
    const last = item.lastActivityDay
      ? `最近 ${this.formatDay(item.lastActivityDay)}`
      : '还没有记录';
    return `计划 ${item.plannedDay} · 仍有 ${item.remainingSteps} 个步骤 · ${last}`;
  }

  openCompletion(item: PersonalReviewCompletion): void {
    void this._router.navigate(['/personal-progress'], {
      queryParams: { projectId: item.projectId },
    });
  }

  openActiveProject(item: PersonalReviewActiveProject): void {
    if (item.isRoutine) {
      void this._router.navigate(['/personal-routine'], {
        queryParams: { itemId: item.projectId },
      });
      return;
    }
    void this._router.navigate(['/personal-progress'], {
      queryParams: { projectId: item.projectId },
    });
  }

  openStaleProject(item: PersonalReviewStaleProject): void {
    void this._router.navigate(['/personal-progress'], {
      queryParams: { projectId: item.projectId },
    });
  }
}
