import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { IS_ELECTRON_TOKEN } from '../../app.constants';
import { PersonalAboutPageComponent } from './personal-about-page.component';

describe('PersonalAboutPageComponent packaged version', () => {
  let originalBridge: Window['ea'];
  beforeEach(() => {
    originalBridge = window.ea;
  });
  afterEach(() => {
    window.ea = originalBridge;
  });

  it('displays the actual packaged version instead of a build-independent constant', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: IS_ELECTRON_TOKEN, useValue: true }],
    });
    window.ea = {
      getPreviewVersion: () => '1.0.0-preview.20261028.2',
      getUserDataPath: async () => 'G:/project1/output/runtime/test/user-data',
    } as unknown as Window['ea'];
    const view = TestBed.runInInjectionContext(() => new PersonalAboutPageComponent());
    view.ngOnInit();
    expect((view as unknown as { version(): string }).version()).toBe(
      '1.0.0-preview.20261028.2',
    );
  });

  it('does not invent a native version in the browser', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: IS_ELECTRON_TOKEN, useValue: false }],
    });
    const view = TestBed.runInInjectionContext(() => new PersonalAboutPageComponent());
    view.ngOnInit();
    expect((view as unknown as { version(): string | null }).version()).toBeNull();
  });

  it('renders one version value without printing the signal function', async () => {
    await TestBed.configureTestingModule({
      imports: [PersonalAboutPageComponent, TranslateModule.forRoot()],
      providers: [{ provide: IS_ELECTRON_TOKEN, useValue: true }],
    }).compileComponents();
    window.ea = {
      getPreviewVersion: () => '1.0.3-preview.20261028',
      getUserDataPath: async () => 'G:/project1/output/runtime/test/user-data',
    } as unknown as Window['ea'];
    const fixture = TestBed.createComponent(PersonalAboutPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text.split('1.0.3-preview.20261028').length - 1).toBe(1);
    expect(text).not.toContain('=>');
    expect(text).not.toContain('VERSION_LABEL');
  });
});
