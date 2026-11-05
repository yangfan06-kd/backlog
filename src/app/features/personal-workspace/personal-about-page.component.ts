import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  signal,
  inject,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PERSONAL_PREVIEW_NAME } from './personal-preview-mode';
import { IS_ELECTRON_TOKEN } from '../../app.constants';

@Component({
  selector: 'personal-about-page',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './personal-about-page.component.html',
  styleUrl: './personal-about-page.component.scss',
})
export class PersonalAboutPageComponent implements OnInit {
  readonly name = PERSONAL_PREVIEW_NAME;
  readonly version = signal<string | null>(null);
  private readonly _isElectron = inject(IS_ELECTRON_TOKEN);
  readonly dataPath = signal('...');

  ngOnInit(): void {
    if (!this._isElectron) return;
    this.version.set(window.ea?.getPreviewVersion?.() ?? null);
    void this._loadDataPath();
  }

  private async _loadDataPath(): Promise<void> {
    try {
      const path = await window.ea?.getUserDataPath?.();
      if (path) this.dataPath.set(path);
    } catch {
      // The browser shell has no native data path.
    }
  }
}
