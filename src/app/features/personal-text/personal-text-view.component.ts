import {
  ChangeDetectionStrategy,
  Component,
  Input,
  ViewEncapsulation,
} from '@angular/core';
import {
  PersonalTextFormat,
  PersonalTextRun,
  runsForDisplay,
} from './personal-text.model';

@Component({
  selector: 'personal-text-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./personal-text-theme.scss', './personal-text-view.component.scss'],
  template: `@for (run of runs(); track $index) {
    <span
      [class]="classes(run)"
      [attr.data-testid]="testId || null"
      >{{ run.text }}</span
    >
  }`,
})
export class PersonalTextViewComponent {
  @Input() text = '';
  @Input() format: PersonalTextFormat | null | undefined = null;
  @Input() testId = '';

  runs(): PersonalTextRun[] {
    return runsForDisplay(this.text, this.format);
  }

  classes(run: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    color?: string;
  }): string {
    return [
      'pt-text',
      run.bold ? 'pt-bold' : '',
      run.italic ? 'pt-italic' : '',
      run.underline ? 'pt-underline' : '',
      run.color ? `pt-color-${run.color}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
}
