import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import { FRESH_PROOF_KIND } from '../../contracts/constants/fresh-proof';
import type { IssuancePolicy } from '../../contracts/types/application-policy';
import { FRESH_PROOF_REQUIRED } from '../constants/proof';

export function freshProofRefusal(
  policy: Pick<IssuancePolicy, 'requirePasskey' | 'passkeyRelyingParty'>,
): AppException {
  const methods: string[] = [];
  if (policy.passkeyRelyingParty) methods.push(FRESH_PROOF_KIND.PASSKEY);
  if (policy.requirePasskey !== true) methods.push(FRESH_PROOF_KIND.EMAIL_CODE);
  return new AppException(
    ErrorCode.REAUTH_REQUIRED,
    'Prove your identity to continue',
    HttpStatus.UNAUTHORIZED,
    { required: FRESH_PROOF_REQUIRED, methods },
  );
}
