import { AppException } from '../../../common/exceptions/app.exception';
import { requireNativeDpopNonceSecret } from './native-dpop.service';

function capturedFailure(value: unknown): unknown {
  try {
    requireNativeDpopNonceSecret(value);
    return undefined;
  } catch (error) {
    if (error instanceof AppException) {
      return { code: error.getCode(), status: error.getStatus() };
    }
    return error;
  }
}

describe('native DPoP runtime configuration', () => {
  it('fails closed with its configuration code when the secret is missing', () => {
    expect(capturedFailure(undefined)).toEqual({
      code: 'NATIVE_DPOP_CONFIGURATION_INVALID',
      status: 500,
    });
  });

  it('fails closed for a secret one character below the minimum', () => {
    expect(capturedFailure('n'.repeat(31))).toEqual({
      code: 'NATIVE_DPOP_CONFIGURATION_INVALID',
      status: 500,
    });
  });

  it('accepts a 32-character secret', () => {
    const secret = 'n'.repeat(32);

    expect(requireNativeDpopNonceSecret(secret)).toBe(secret);
  });
});
