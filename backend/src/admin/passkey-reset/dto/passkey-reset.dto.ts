// feature:passkeys:start
import { StaffVersion } from '../../dto/staff-version.decorator';

/** A passkey reset, with the account version it was read at. */
export class PasskeyResetDto {
  @StaffVersion()
  version?: number;
}
// feature:passkeys:end
