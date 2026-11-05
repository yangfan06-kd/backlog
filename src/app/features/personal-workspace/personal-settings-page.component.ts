import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GlobalThemeService, DarkModeCfg } from '../../core/theme/global-theme.service';

@Component({
  selector: 'personal-settings-page',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="ps-page"
      data-testid="ps-page"
    >
      <header class="ps-header">
        <h1>设置</h1>
      </header>
      <section class="ps-card">
        <h2>外观</h2>
        <div
          class="ps-theme-options"
          role="group"
          aria-label="深色模式"
        >
          @for (option of themeOptions; track option.value) {
            <button
              type="button"
              class="ps-theme-option"
              [class.is-active]="darkMode() === option.value"
              [attr.aria-pressed]="darkMode() === option.value"
              (click)="setDarkMode(option.value)"
            >
              {{ option.label }}
            </button>
          }
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: var(--s3);
      }

      .ps-page {
        max-width: 900px;
        margin: 0 auto;
        color: var(--text-color);
      }

      .ps-header {
        margin-bottom: var(--s2);

        h1 {
          margin: 0 0 var(--s-half);
          font-size: var(--font-size-2xl);
          font-weight: var(--font-weight-semibold);
        }

        p {
          margin: 0;
          color: var(--text-color-muted);
          font-size: var(--font-size-sm);
        }
      }

      .ps-card {
        padding: var(--s2);
        border: 1px solid var(--separator-color);
        border-radius: var(--radius-sm);
        background: var(--card-bg);
      }

      .ps-card h2 {
        margin: 0 0 var(--s);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
      }

      .ps-theme-options {
        display: inline-flex;
        gap: 0;
        padding: 3px;
        border: 1px solid var(--separator-color);
        border-radius: var(--radius-sm);
        background: var(--bg);
      }

      .ps-theme-option {
        min-height: 30px;
        padding: 0 var(--s2);
        border: 0;
        border-radius: calc(var(--radius-sm) - 2px);
        background: transparent;
        color: var(--text-color-muted);
        font: inherit;
        font-size: var(--font-size-sm);
        cursor: pointer;
      }

      .ps-theme-option.is-active {
        background: var(--card-bg);
        color: var(--text-color);
      }

      .ps-hint {
        margin: var(--s) 0 0;
        color: var(--text-color-muted);
        font-size: var(--font-size-xs);
      }

      @media (max-width: 700px) {
        :host {
          padding: var(--s2);
        }
      }
    `,
  ],
})
export class PersonalSettingsPageComponent {
  private readonly _theme = inject(GlobalThemeService);
  readonly darkMode = this._theme.darkMode;
  readonly themeOptions: { value: DarkModeCfg; label: string }[] = [
    { value: 'system', label: '系统' },
    { value: 'dark', label: '深色' },
    { value: 'light', label: '浅色' },
  ];

  setDarkMode(value: DarkModeCfg): void {
    this._theme.darkMode.set(value);
  }
}
