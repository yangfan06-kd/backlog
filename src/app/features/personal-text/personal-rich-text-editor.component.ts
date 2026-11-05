import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  ViewEncapsulation,
  inject,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Compartment, EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewUpdate,
  keymap,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  personalTextEditing,
  runsField,
  setRunsEffect,
} from './personal-text-editor-state';
import {
  PERSONAL_TEXT_COLORS,
  PersonalTextColor,
  PersonalTextDraft,
  PersonalTextFormat,
  PersonalTextRun,
  PersonalTextStyleKey,
  clearFormatInRange,
  formatEquals,
  formatForText,
  formatFromRuns,
  setColorInRange,
  styleAt,
  toggleFormatInRange,
} from './personal-text.model';

const formatDecorations = (state: EditorState): DecorationSet => {
  const snapshot = state.field(runsField);
  const builder = new RangeSetBuilder<Decoration>();
  let cursor = 0;
  for (const run of snapshot.runs) {
    const from = cursor;
    const to = cursor + run.text.length;
    cursor = to;
    if (from === to) continue;
    const classes = [
      run.bold ? 'pt-bold' : '',
      run.italic ? 'pt-italic' : '',
      run.underline ? 'pt-underline' : '',
      run.color ? `pt-color-${run.color}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (classes) builder.add(from, to, Decoration.mark({ class: classes }));
  }
  return builder.finish();
};

@Component({
  selector: 'personal-rich-text-editor',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      class="pt-toolbar"
      [class.pt-toolbar-wrap]="wrapToolbar"
      role="toolbar"
      [attr.aria-label]="ariaLabel || null"
      (keydown.escape)="closeColorMenu()"
    >
      <button
        type="button"
        class="pt-tool"
        [class.is-active]="active().bold"
        [attr.aria-pressed]="active().bold"
        [attr.aria-label]="'PERSONAL_TEXT.BOLD' | translate"
        data-testid="pt-bold"
        [disabled]="disabled"
        (mousedown)="preventToolbarBlur($event)"
        (click)="toggle('bold')"
      >
        {{ 'PERSONAL_TEXT.BOLD' | translate }}
      </button>
      <button
        type="button"
        class="pt-tool"
        [class.is-active]="active().italic"
        [attr.aria-pressed]="active().italic"
        [attr.aria-label]="'PERSONAL_TEXT.ITALIC' | translate"
        data-testid="pt-italic"
        [disabled]="disabled"
        (mousedown)="preventToolbarBlur($event)"
        (click)="toggle('italic')"
      >
        {{ 'PERSONAL_TEXT.ITALIC' | translate }}
      </button>
      <button
        type="button"
        class="pt-tool"
        [class.is-active]="active().underline"
        [attr.aria-pressed]="active().underline"
        [attr.aria-label]="'PERSONAL_TEXT.UNDERLINE' | translate"
        data-testid="pt-underline"
        [disabled]="disabled"
        (mousedown)="preventToolbarBlur($event)"
        (click)="toggle('underline')"
      >
        {{ 'PERSONAL_TEXT.UNDERLINE' | translate }}
      </button>
      <button
        type="button"
        class="pt-tool"
        data-testid="pt-color-toggle"
        [attr.aria-expanded]="colorMenuOpen"
        [attr.aria-label]="'PERSONAL_TEXT.COLOR' | translate"
        [disabled]="disabled"
        (mousedown)="onColorToggleMouseDown($event)"
        (click)="toggleColorMenu()"
      >
        {{ 'PERSONAL_TEXT.COLOR' | translate }} ▾
      </button>
      <button
        type="button"
        class="pt-tool"
        data-testid="pt-clear"
        [attr.aria-label]="'PERSONAL_TEXT.CLEAR' | translate"
        [disabled]="disabled"
        (mousedown)="preventToolbarBlur($event)"
        (click)="clear()"
      >
        {{ 'PERSONAL_TEXT.CLEAR' | translate }}
      </button>
    </div>
    @if (colorMenuOpen) {
      <div
        class="pt-colors"
        role="menu"
      >
        <button
          type="button"
          class="pt-color"
          [class.is-active]="!active().color"
          data-testid="pt-color-default"
          role="menuitem"
          [attr.aria-label]="'PERSONAL_TEXT.COLOR_DEFAULT' | translate"
          [disabled]="disabled"
          (mousedown)="onColorMouseDown($event, null)"
          (click)="onColorClick($event, null)"
        >
          {{ 'PERSONAL_TEXT.COLOR_DEFAULT' | translate }}
        </button>
        @for (color of colors; track color) {
          <button
            type="button"
            class="pt-color"
            [class.is-active]="active().color === color"
            [attr.data-testid]="'pt-color-' + color"
            role="menuitem"
            [attr.aria-label]="'PERSONAL_TEXT.COLOR_' + color.toUpperCase() | translate"
            [disabled]="disabled"
            (mousedown)="onColorMouseDown($event, color)"
            (click)="onColorClick($event, color)"
          >
            <span [class]="'pt-swatch pt-swatch-' + color"></span>
            {{ 'PERSONAL_TEXT.COLOR_' + color.toUpperCase() | translate }}
          </button>
        }
      </div>
    }
    <div
      #host
      class="pt-host"
    ></div>
  `,
  styleUrls: ['./personal-text-theme.scss', './personal-rich-text-editor.component.scss'],
})
export class PersonalRichTextEditorComponent
  implements AfterViewInit, OnChanges, OnDestroy
{
  @Input() text = '';
  @Input() format: PersonalTextFormat | null = null;
  @Input() testId = '';
  @Input() ariaLabel = '';
  @Input() disabled = false;
  @Input() autofocus = false;
  @Input() wrapToolbar = false;
  /** Changes when the owning project/item changes; clears uncommitted pending styles. */
  @Input() resetKey = '';
  @Output() valueChange = new EventEmitter<PersonalTextDraft>();
  @Output() focused = new EventEmitter<void>();

  @ViewChild('host', { static: true }) private _host?: ElementRef<HTMLDivElement>;

  private _view: EditorView | null = null;
  private readonly _changeDetector = inject(ChangeDetectorRef);
  private readonly _editable = new Compartment();
  private _pendingStyle: Omit<PersonalTextRun, 'text'> | null = null;
  private _colorSelection: { from: number; to: number; text: string } | null = null;
  private _lastToolbarSelection: { from: number; to: number; text: string } | null = null;
  private _colorAppliedOnMouseDown = false;
  readonly colors = PERSONAL_TEXT_COLORS;
  colorMenuOpen = false;
  active: () => Omit<PersonalTextRun, 'text'> = () => ({});

  ngAfterViewInit(): void {
    const host = this._host?.nativeElement;
    if (!host) return;
    this._view = new EditorView({ parent: host, state: this._createState() });
    if (this.autofocus) this._view.focus();
    this.active = () => this._styleAtSelection();
    this._emit();
  }

  private _createState(): EditorState {
    const normalizedText = this.text ?? '';
    const initialRuns = formatForText(normalizedText, this.format)?.runs ?? [
      { text: normalizedText },
    ];
    return EditorState.create({
      doc: normalizedText,
      extensions: [
        history(),
        personalTextEditing(() => this._pendingStyle),
        keymap.of([
          { key: 'Mod-b', run: () => this._toggleKeyboard('bold') },
          { key: 'Mod-i', run: () => this._toggleKeyboard('italic') },
          { key: 'Mod-u', run: () => this._toggleKeyboard('underline') },
          { key: 'ArrowLeft', run: () => this._invalidateToolbarSelection() },
          { key: 'ArrowRight', run: () => this._invalidateToolbarSelection() },
          { key: 'ArrowUp', run: () => this._invalidateToolbarSelection() },
          { key: 'ArrowDown', run: () => this._invalidateToolbarSelection() },
          { key: 'Home', run: () => this._invalidateToolbarSelection() },
          { key: 'End', run: () => this._invalidateToolbarSelection() },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        runsField.init(() => ({ text: normalizedText, runs: initialRuns })),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          ['data-testid']: this.testId,
          ['aria-label']: this.ariaLabel,
          role: 'textbox',
          ['aria-multiline']: 'true',
        }),
        EditorView.updateListener.of((update) => this._onUpdate(update)),
        EditorView.domEventHandlers({
          focus: () => this.focused.emit(),
          keydown: (event) => this._onEditorKeydown(event),
          mousedown: () => {
            this._lastToolbarSelection = null;
            this._pendingStyle = null;
            this.closeColorMenu();
            return false;
          },
        }),
        EditorView.decorations.compute([runsField], formatDecorations),
        this._editable.of(EditorView.editable.of(!this.disabled)),
      ],
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this._view) return;
    if (changes['resetKey'] && !changes['resetKey'].firstChange) {
      this._pendingStyle = null;
      this._lastToolbarSelection = null;
      this.closeColorMenu();
      this.active = () => this._styleAtSelection();
      this._view.setState(this._createState());
      return;
    }
    if (changes['disabled']) {
      this._view.dispatch({
        effects: this._editable.reconfigure(EditorView.editable.of(!this.disabled)),
      });
    }
    const nextText = this.text ?? '';
    const nextFormat = formatForText(nextText, this.format);
    const current = this._view.state.field(runsField);
    if (
      current.text === nextText &&
      formatEquals(formatFromRuns(current.runs), nextFormat)
    ) {
      return;
    }
    // A save/cancel or a loaded document is a new editing session. Replaying an
    // old format snapshot against replacement text could restore another draft.
    this._pendingStyle = null;
    this._lastToolbarSelection = null;
    this.closeColorMenu();
    this._view.setState(this._createState());
  }

  ngOnDestroy(): void {
    this._view?.destroy();
    this._view = null;
  }

  preventToolbarBlur(event: MouseEvent): void {
    event.preventDefault();
  }

  onColorToggleMouseDown(event: MouseEvent): void {
    event.preventDefault();
    if (this.colorMenuOpen) return;
    const view = this._view;
    const selection = view?.state.selection.main;
    const text = view?.state.doc.toString() ?? '';
    if (selection && selection.from !== selection.to) {
      this._colorSelection = { from: selection.from, to: selection.to, text };
    } else if (this._lastToolbarSelection?.text === text) {
      this._colorSelection = this._lastToolbarSelection;
    }
  }

  onColorMouseDown(event: MouseEvent, color: PersonalTextColor | null): void {
    event.preventDefault();
    this._colorAppliedOnMouseDown = true;
    this.setColor(color);
  }

  onColorClick(event: MouseEvent, color: PersonalTextColor | null): void {
    event.preventDefault();
    if (this._colorAppliedOnMouseDown) {
      this._colorAppliedOnMouseDown = false;
      return;
    }
    this.setColor(color);
  }

  toggleColorMenu(): void {
    if (this.colorMenuOpen) {
      this.closeColorMenu();
      return;
    }
    const view = this._view;
    const selection = view?.state.selection.main;
    const text = view?.state.doc.toString() ?? '';
    if (view && selection && selection.from !== selection.to) {
      this._colorSelection = { from: selection.from, to: selection.to, text };
    } else if (this._lastToolbarSelection?.text === text) {
      this._colorSelection = this._lastToolbarSelection;
    }
    this.colorMenuOpen = true;
  }

  closeColorMenu(): void {
    this.colorMenuOpen = false;
    this._colorSelection = null;
  }

  toggle(key: PersonalTextStyleKey): void {
    const view = this._view;
    if (!view || this.disabled) return;
    const { from, to } = view.state.selection.main;
    const text = view.state.doc.toString();
    if (from === to) {
      const style = { ...(this._pendingStyle ?? this._styleAtPosition(from)) };
      style[key] = !style[key];
      this._pendingStyle = style;
      this.active = () => style;
      return;
    }
    this._lastToolbarSelection = { from, to, text };
    const format = formatFromRuns(view.state.field(runsField).runs);
    this._dispatchFormat(toggleFormatInRange(format, text, from, to, key), {
      from,
      to,
    });
  }

  setColor(color: PersonalTextColor | null): void {
    const view = this._view;
    if (!view || this.disabled) return;
    const text = view.state.doc.toString();
    const saved = this._colorSelection;
    const range =
      saved && saved.text === text
        ? { from: saved.from, to: saved.to }
        : view.state.selection.main;
    this.closeColorMenu();
    if (range.from === range.to) {
      const style = { ...(this._pendingStyle ?? this._styleAtPosition(range.from)) };
      if (color) style.color = color;
      else delete style.color;
      this._pendingStyle = style;
      this.active = () => style;
      return;
    }
    this._lastToolbarSelection = { from: range.from, to: range.to, text };
    const format = formatFromRuns(view.state.field(runsField).runs);
    this._dispatchFormat(setColorInRange(format, text, range.from, range.to, color), {
      from: range.from,
      to: range.to,
    });
  }

  clear(): void {
    const view = this._view;
    if (!view || this.disabled) return;
    const { from, to } = view.state.selection.main;
    const text = view.state.doc.toString();
    if (from === to) {
      this._pendingStyle = {};
      this.active = () => ({});
      return;
    }
    this._lastToolbarSelection = { from, to, text };
    const format = formatFromRuns(view.state.field(runsField).runs);
    this._dispatchFormat(clearFormatInRange(format, text, from, to), { from, to });
  }

  private _invalidateToolbarSelection(): boolean {
    this._lastToolbarSelection = null;
    this._pendingStyle = null;
    this.closeColorMenu();
    return false;
  }

  private _onEditorKeydown(event: KeyboardEvent): boolean {
    if (
      event.key.startsWith('Arrow') ||
      event.key === 'Home' ||
      event.key === 'End' ||
      event.key === 'PageUp' ||
      event.key === 'PageDown'
    ) {
      this._lastToolbarSelection = null;
      this._pendingStyle = null;
      this.closeColorMenu();
    }
    return false;
  }

  private _toggleKeyboard(key: PersonalTextStyleKey): boolean {
    this.toggle(key);
    return true;
  }

  private _dispatchFormat(
    format: PersonalTextFormat | null,
    selection?: { from: number; to: number },
  ): void {
    const view = this._view;
    if (!view) return;
    const after = format?.runs ?? [{ text: view.state.doc.toString() }];
    this._pendingStyle = null;
    view.dispatch({
      effects: setRunsEffect.of(after),
      ...(selection ? { selection: { anchor: selection.from, head: selection.to } } : {}),
    });
    this.active = () => this._styleAtSelection();
    view.focus();
  }

  private _onUpdate(update: ViewUpdate): void {
    if (update.docChanged) this.closeColorMenu();
    this.active = () => this._pendingStyle ?? this._styleAtSelection();
    this._changeDetector.markForCheck();
    // Reconfiguring disabled/focus/selection is not user content. Emitting the
    // previous text during a parent save would put the cleared draft back.
    if (
      update.docChanged ||
      update.startState.field(runsField).runs !== update.state.field(runsField).runs
    )
      this._emit();
  }

  private _emit(): void {
    const view = this._view;
    if (!view) return;
    const snapshot = view.state.field(runsField);
    this.valueChange.emit({
      text: snapshot.text,
      format: formatFromRuns(snapshot.runs),
    });
  }

  private _styleAtSelection(): Omit<PersonalTextRun, 'text'> {
    const view = this._view;
    if (!view) return {};
    return this._styleAtPosition(view.state.selection.main.from);
  }

  private _styleAtPosition(position: number): Omit<PersonalTextRun, 'text'> {
    const view = this._view;
    if (!view) return {};
    const snapshot = view.state.field(runsField);
    return styleAt(formatFromRuns(snapshot.runs), snapshot.text, position);
  }
}
