import { Injectable } from '@angular/core';
import { AppDataComplete } from '../../op-log/model/model-config';
import { hasSupportedPersonalTextFormats } from '../personal-text/personal-text.model';

@Injectable({ providedIn: 'root' })
export class PersonalBackupValidator {
  async isValid(data: AppDataComplete): Promise<boolean> {
    // Keep the large generated validator out of the startup bundle. This runs
    // only before a backup write or a restore, never on the hot path.
    const { validateFull } = await import('../../op-log/validation/validation-fn');
    return hasSupportedPersonalTextFormats(data) && validateFull(data).isValid;
  }
}
