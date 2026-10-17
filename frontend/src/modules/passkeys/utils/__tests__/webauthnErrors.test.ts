import { describe, expect, it } from 'vitest';
import { WEBAUTHN_ERROR_KEY } from '../../constants';
import { webAuthnErrorKey } from '../webauthnErrors';

/** How the browser raises a failed ceremony. */
function domException(name: string): DOMException {
  return new DOMException('written for developers', name);
}

/** How @simplewebauthn/browser rethrows one, with the original on `cause`. */
function wrapped(name: string): Error {
  return new Error('ceremony failed', { cause: domException(name) });
}

describe('webAuthnErrorKey', () => {
  it('reads a dismissed or timed out prompt', () => {
    expect(webAuthnErrorKey(domException('NotAllowedError'))).toBe(WEBAUTHN_ERROR_KEY.NOT_ALLOWED);
  });

  it('reads an authenticator that already holds a passkey for the account', () => {
    expect(webAuthnErrorKey(domException('InvalidStateError'))).toBe(
      WEBAUTHN_ERROR_KEY.INVALID_STATE,
    );
  });

  it('reads an abandoned ceremony', () => {
    expect(webAuthnErrorKey(domException('AbortError'))).toBe(WEBAUTHN_ERROR_KEY.ABORTED);
  });

  it('reads what the browser or the key cannot do', () => {
    expect(webAuthnErrorKey(domException('NotSupportedError'))).toBe(
      WEBAUTHN_ERROR_KEY.UNSUPPORTED,
    );
    expect(webAuthnErrorKey(domException('ConstraintError'))).toBe(WEBAUTHN_ERROR_KEY.UNSUPPORTED);
  });

  it('looks past the library error at the exception it wrapped', () => {
    expect(webAuthnErrorKey(wrapped('NotAllowedError'))).toBe(WEBAUTHN_ERROR_KEY.NOT_ALLOWED);
  });

  it('falls back for a name it does not know', () => {
    expect(webAuthnErrorKey(domException('UnknownError'))).toBe(WEBAUTHN_ERROR_KEY.FAILED);
    expect(webAuthnErrorKey(new Error('network down'))).toBe(WEBAUTHN_ERROR_KEY.FAILED);
  });

  it('falls back for what is not an error at all', () => {
    expect(webAuthnErrorKey(undefined)).toBe(WEBAUTHN_ERROR_KEY.FAILED);
    expect(webAuthnErrorKey('NotAllowedError')).toBe(WEBAUTHN_ERROR_KEY.FAILED);
    expect(webAuthnErrorKey({ name: 42 })).toBe(WEBAUTHN_ERROR_KEY.FAILED);
  });

  it('stops rather than following a cause chain that loops', () => {
    const looping: { name: string; cause?: unknown } = { name: 'SomeError' };
    looping.cause = looping;

    expect(webAuthnErrorKey(looping)).toBe(WEBAUTHN_ERROR_KEY.FAILED);
  });
});
