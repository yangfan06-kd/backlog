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
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { selectAllProjects } from '../project/store/project.selectors';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { PersonalMemoService } from '../personal-memo/personal-memo.service';
import {
  PersonalSearchKind,
  PersonalSearchResult,
  buildPersonalSearchResults,
} from './personal-search.view';

type SearchFilter = 'all' | PersonalSearchKind;
interface SearchGroup {
  kind: PersonalSearchKind;
  label: string;
  items: PersonalSearchResult[];
}

const FILTERS: { id: SearchFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'project', label: '项目' },
  { id: 'routine', label: '常态事项' },
  { id: 'step', label: '步骤' },
  { id: 'record', label: '记录' },
  { id: 'memo', label: '备忘' },
];

const KIND_LABELS: Record<PersonalSearchKind, string> = {
  project: '项目',
  routine: '常态事项',
  step: '步骤',
  record: '记录',
  memo: '备忘',
};

const GROUP_ORDER: PersonalSearchKind[] = [
  'project',
  'routine',
  'step',
  'record',
  'memo',
];

const QUICK_ROUTES = [
  { label: '四象限总览', route: '/personal-overview' },
  { label: '项目进展', route: '/personal-progress' },
  { label: '常态事项', route: '/personal-routine' },
  { label: '备忘', route: '/personal-memo' },
  { label: '项目归档', route: '/personal-archive' },
];

@Component({
  selector: 'personal-search-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="search-page"
      data-testid="personal-search-page"
    >
      <header class="search-head">
        <div>
          <h1>搜索</h1>
          <p>在项目、步骤、记录、常态事项和备忘中查找。</p>
        </div>
        <span class="search-shortcut"><kbd>Ctrl</kbd><kbd>K</kbd></span>
      </header>

      <div class="search-field">
        <span
          class="search-symbol"
          aria-hidden="true"
          >⌕</span
        >
        <input
          #searchInput
          type="search"
          data-testid="personal-search-input"
          autocomplete="off"
          spellcheck="false"
          placeholder="搜索项目、步骤、记录、常态事项、备忘…"
          aria-label="搜索项目、步骤、记录、常态事项和备忘"
          [value]="query()"
          (input)="onInput($event)"
          (keydown)="onKeydown($event)"
        />
        @if (query()) {
          <button
            type="button"
            class="clear-search"
            data-testid="personal-search-clear"
            aria-label="清空搜索"
            (click)="clear()"
          >
            ×
          </button>
        }
      </div>

      <div
        class="search-filters"
        role="group"
        aria-label="搜索范围"
      >
        @for (filterOption of filters; track filterOption.id) {
          <button
            type="button"
            class="search-filter"
            [class.is-active]="filter() === filterOption.id"
            [attr.aria-pressed]="filter() === filterOption.id"
            (click)="changeFilter(filterOption.id)"
          >
            {{ filterOption.label }}
          </button>
        }
      </div>

      @if (!query().trim()) {
        <section
          class="search-empty"
          aria-label="常用入口"
        >
          <p class="search-section-label">常用入口</p>
          <div class="quick-links">
            @for (quick of quickRoutes; track quick.route) {
              <button
                type="button"
                class="quick-link"
                (click)="openRoute(quick.route)"
              >
                <span>{{ quick.label }}</span>
                <span aria-hidden="true">→</span>
              </button>
            }
          </div>
        </section>
      } @else if (groups().length === 0) {
        <p
          class="search-empty-line"
          data-testid="personal-search-empty"
        >
          没有找到相关内容
        </p>
      } @else {
        <section
          class="search-results"
          aria-label="搜索结果"
        >
          @for (group of groups(); track group.kind) {
            <section class="result-group">
              <div class="group-head">
                <button
                  type="button"
                  class="group-toggle"
                  [attr.aria-expanded]="!isGroupCollapsed(group.kind)"
                  (click)="toggleGroup(group.kind)"
                >
                  <span class="group-title">{{ group.label }}</span>
                  <span class="group-count">{{ group.items.length }}</span>
                  <span
                    class="group-chevron"
                    aria-hidden="true"
                  >
                    {{ isGroupCollapsed(group.kind) ? '›' : '⌄' }}
                  </span>
                </button>
              </div>

              @if (!isGroupCollapsed(group.kind)) {
                <div class="result-list">
                  @for (item of group.items; track item.id) {
                    <div class="record-item">
                      <button
                        type="button"
                        class="result-row"
                        data-testid="personal-search-result"
                        [attr.data-search-kind]="item.kind"
                        [class.is-active]="activeResultId() === item.id"
                        [attr.aria-expanded]="
                          item.kind === 'record' ? isRecordExpanded(item.id) : null
                        "
                        (mouseenter)="activeResultId.set(item.id)"
                        (click)="openResult(item)"
                      >
                        <span
                          class="kind-dot"
                          [class.kind-project]="item.kind === 'project'"
                          [class.kind-routine]="item.kind === 'routine'"
                          [class.kind-step]="item.kind === 'step'"
                          [class.kind-record]="item.kind === 'record'"
                          [class.kind-memo]="item.kind === 'memo'"
                          aria-hidden="true"
                        ></span>
                        <span class="row-copy">
                          <span class="row-title">{{ item.title }}</span>
                          <span class="row-context">{{ item.subtitle }}</span>
                        </span>
                        @if (item.kind === 'record') {
                          <span class="record-toggle">
                            {{ isRecordExpanded(item.id) ? '收起' : '展开' }}
                          </span>
                          <span
                            class="row-arrow"
                            aria-hidden="true"
                          >
                            {{ isRecordExpanded(item.id) ? '⌃' : '⌄' }}
                          </span>
                        } @else {
                          <span class="row-kind">{{ kindLabel(item.kind) }}</span>
                          <span
                            class="row-arrow"
                            aria-hidden="true"
                            >→</span
                          >
                        }
                      </button>

                      @if (item.kind === 'record' && isRecordExpanded(item.id)) {
                        <div
                          class="record-detail"
                          data-testid="personal-search-record-detail"
                        >
                          <p>{{ item.title }}</p>
                          <div class="record-detail-foot">
                            <span>{{ item.subtitle }}</span>
                            <button
                              type="button"
                              class="record-open"
                              (click)="openResultTarget(item)"
                            >
                              打开项目 →
                            </button>
                          </div>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </section>
          }
        </section>
      }

      @if (query().trim()) {
        <footer class="search-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 打开</span>
          <span><kbd>Esc</kbd> 清空</span>
        </footer>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: var(--s3);
      }

      .search-page {
        width: min(900px, 100%);
        margin: 0 auto;
        color: var(--text-color);
      }

      .search-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--s2);
        margin-bottom: var(--s2);
      }

      .search-head h1 {
        margin: 0 0 var(--s-half);
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-semibold);
      }

      .search-head p {
        margin: 0;
        color: var(--text-color-muted);
        font-size: var(--font-size-sm);
      }

      .search-shortcut {
        display: inline-flex;
        flex: 0 0 auto;
        gap: 4px;
        margin-top: 3px;
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      kbd {
        display: inline-flex;
        min-width: 20px;
        min-height: 20px;
        align-items: center;
        justify-content: center;
        padding: 0 5px;
        border: 1px solid var(--separator-color);
        border-radius: 5px;
        background: var(--card-bg);
        color: var(--text-color-muted);
        font-size: 11px;
      }

      .search-field {
        display: flex;
        align-items: center;
        gap: var(--s-half);
        min-height: 44px;
        padding: 0 var(--s);
        border: 1px solid var(--separator-color);
        border-radius: var(--radius-sm);
        background: var(--card-bg);
      }

      .search-field:focus-within {
        border-color: var(--c-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-primary) 18%, transparent);
      }

      .search-symbol {
        color: var(--text-color-muted);
        font-size: 20px;
        line-height: 1;
      }

      .search-field input {
        min-width: 0;
        flex: 1;
        padding: 0;
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--text-color);
        font: inherit;
        font-size: var(--font-size-md);
      }

      .search-field input::placeholder {
        color: var(--text-color-muted);
        opacity: 0.85;
      }

      .clear-search {
        display: grid;
        width: 22px;
        height: 22px;
        place-items: center;
        border: 0;
        border-radius: 50%;
        background: var(--bg);
        color: var(--text-color-muted);
        cursor: pointer;
      }

      .search-filters {
        display: flex;
        align-items: center;
        gap: 2px;
        margin: var(--s) 0 var(--s2);
        overflow-x: auto;
      }

      .search-filter {
        min-height: 30px;
        padding: 0 var(--s);
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--text-color-muted);
        font: inherit;
        font-size: var(--font-size-xs);
        cursor: pointer;
        white-space: nowrap;
      }

      .search-filter:hover {
        color: var(--text-color);
      }

      .search-filter.is-active {
        background: var(--card-bg);
        color: var(--text-color);
        box-shadow: inset 0 0 0 1px var(--separator-color);
      }

      .search-empty {
        padding-top: var(--s);
        border-top: 1px solid var(--separator-color);
      }

      .search-section-label {
        margin: 0 0 var(--s);
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
        letter-spacing: 0.06em;
      }

      .quick-links {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .quick-link {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 42px;
        padding: 0 var(--s);
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--text-color);
        font: inherit;
        font-size: var(--font-size-sm);
        text-align: left;
        cursor: pointer;
      }

      .quick-link:hover {
        background: var(--project1-hover-bg, var(--hover-bg));
      }

      .quick-link span:last-child {
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      .search-empty-line {
        padding: var(--s3) 0;
        border-top: 1px solid var(--separator-color);
        color: var(--text-color-muted);
        font-size: var(--font-size-sm);
        text-align: center;
      }

      .search-results {
        border-top: 1px solid var(--separator-color);
      }

      .result-group {
        padding-top: var(--s2);
      }

      .group-head {
        padding: 0 var(--s) var(--s-half);
      }

      .group-toggle {
        display: flex;
        width: 100%;
        align-items: center;
        gap: var(--s-half);
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--text-color-muted);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .group-title {
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
        font-weight: 600;
        letter-spacing: 0.08em;
      }

      .group-count {
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      .group-chevron {
        margin-left: auto;
        color: var(--text-color-muted);
        font-size: 12px;
      }

      .result-list {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }

      .record-item {
        min-width: 0;
      }

      .result-row {
        display: grid;
        width: 100%;
        min-height: 56px;
        grid-template-columns: 12px minmax(0, 1fr) auto 16px;
        align-items: center;
        gap: var(--s-half) var(--s);
        padding: 7px var(--s);
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--text-color);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .result-row:hover,
      .result-row.is-active {
        background: var(--project1-hover-bg, var(--hover-bg));
      }

      .result-row:focus-visible,
      .group-toggle:focus-visible,
      .quick-link:focus-visible,
      .record-open:focus-visible {
        outline: var(--focus-ring-width) solid var(--c-primary);
        outline-offset: 1px;
      }

      .kind-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--text-color-muted);
      }

      .kind-project {
        background: var(--c-primary);
      }

      .kind-routine {
        background: var(--color-success);
      }

      .kind-step {
        background: var(--color-warning);
      }

      .kind-record {
        background: var(--color-accent, var(--c-accent));
      }

      .kind-memo {
        background: var(--color-info, var(--c-primary));
      }

      .row-copy {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 3px;
      }

      .row-title {
        overflow: hidden;
        color: var(--text-color);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .row-context {
        overflow: hidden;
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .row-kind,
      .record-toggle {
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
        white-space: nowrap;
      }

      .row-arrow {
        color: var(--text-color-muted);
        font-size: 14px;
        text-align: right;
      }

      .record-detail {
        margin: 0 var(--s) var(--s-half) 34px;
        padding: var(--s) var(--s2);
        border-radius: 7px;
        background: var(--card-bg);
      }

      .record-detail p {
        margin: 0 0 var(--s-half);
        color: var(--text-color);
        font-size: var(--font-size-sm);
        line-height: 1.65;
        white-space: pre-wrap;
      }

      .record-detail-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--s);
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      .record-open {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--text-color);
        font: inherit;
        font-size: var(--font-size-xs);
        cursor: pointer;
      }

      .record-open:hover {
        color: var(--c-primary);
      }

      .search-footer {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s2);
        margin-top: var(--s3);
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      .search-footer span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      @media (max-width: 700px) {
        :host {
          padding: var(--s2);
        }

        .search-head {
          display: block;
        }

        .search-shortcut {
          margin-top: var(--s);
        }

        .record-detail {
          margin-left: var(--s);
        }
      }
    `,
  ],
})
export class PersonalSearchPageComponent implements AfterViewInit {
  private readonly _store = inject(Store);
  private readonly _router = inject(Router);
  private readonly _memo = inject(PersonalMemoService);
  private readonly _input = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly _projects = toSignal(this._store.select(selectAllProjects), {
    initialValue: [],
  });
  private readonly _tasks = toSignal(this._store.select(selectAllTasks), {
    initialValue: [],
  });
  private readonly _notes = toSignal(this._memo.notes$, { initialValue: [] });

  readonly filters = FILTERS;
  readonly quickRoutes = QUICK_ROUTES;
  readonly query = signal('');
  readonly filter = signal<SearchFilter>('all');
  readonly activeResultId = signal<string | null>(null);
  private readonly _collapsedGroups = signal<ReadonlySet<PersonalSearchKind>>(new Set());
  private readonly _expandedRecords = signal<ReadonlySet<string>>(new Set());

  readonly allResults = computed(() =>
    buildPersonalSearchResults(
      this._projects(),
      this._tasks(),
      this._notes(),
      this.query(),
    ),
  );
  readonly groups = computed<SearchGroup[]>(() => {
    const kind = this.filter();
    const items = this.allResults();
    const filtered = kind === 'all' ? items : items.filter((item) => item.kind === kind);
    return GROUP_ORDER.flatMap((groupKind) => {
      const groupItems = filtered.filter((item) => item.kind === groupKind);
      return groupItems.length
        ? [{ kind: groupKind, label: KIND_LABELS[groupKind], items: groupItems }]
        : [];
    });
  });

  ngAfterViewInit(): void {
    this._input()?.nativeElement.focus();
  }

  onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.activeResultId.set(null);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.clear();
      return;
    }
    if (event.key === 'Enter') {
      const active = this.activeResultId();
      const result = this.allResults().find((item) => item.id === active);
      if (result) {
        event.preventDefault();
        this.openResult(result);
      }
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const results = this.allResults();
    if (!results.length) return;
    event.preventDefault();
    const index = results.findIndex((item) => item.id === this.activeResultId());
    const next =
      event.key === 'ArrowDown'
        ? (index + 1 + results.length) % results.length
        : (index - 1 + results.length) % results.length;
    this.activeResultId.set(results[next].id);
  }

  clear(): void {
    this.query.set('');
    this.filter.set('all');
    this.activeResultId.set(null);
    this._input()?.nativeElement.focus();
  }

  changeFilter(filter: SearchFilter): void {
    this.filter.set(filter);
    this.activeResultId.set(null);
  }

  isGroupCollapsed(kind: PersonalSearchKind): boolean {
    return this._collapsedGroups().has(kind);
  }

  toggleGroup(kind: PersonalSearchKind): void {
    const next = new Set(this._collapsedGroups());
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    this._collapsedGroups.set(next);
  }

  isRecordExpanded(id: string): boolean {
    return this._expandedRecords().has(id);
  }

  toggleRecord(id: string): void {
    const next = new Set(this._expandedRecords());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expandedRecords.set(next);
  }

  openResult(item: PersonalSearchResult): void {
    if (item.kind === 'record') {
      this.toggleRecord(item.id);
      return;
    }
    this.openResultTarget(item);
  }

  openResultTarget(item: PersonalSearchResult): void {
    void this._router.navigate([item.route], { queryParams: item.queryParams });
  }

  openRoute(route: string): void {
    void this._router.navigate([route]);
  }

  kindLabel(kind: PersonalSearchKind): string {
    return KIND_LABELS[kind];
  }
}
