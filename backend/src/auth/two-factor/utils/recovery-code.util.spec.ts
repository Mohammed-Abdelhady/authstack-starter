import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  recoveryHashEquals,
} from './recovery-code.util';

describe('recovery codes', () => {
  it('should not repeat a batch', () => {
    expect(generateRecoveryCodes()).not.toEqual(generateRecoveryCodes());
  });

  it('should hash a retyped code to the same digest', () => {
    expect(hashRecoveryCode('k3m7q-rtvwx')).toBe(
      hashRecoveryCode('K3M7QRTVWX'),
    );
    expect(hashRecoveryCode(' K3M7 QRTVWX ')).toBe(
      hashRecoveryCode('K3M7QRTVWX'),
    );
  });

  it('should strip spacing and case when normalising', () => {
    expect(normalizeRecoveryCode(' k3m7-qrtvwx ')).toBe('K3M7QRTVWX');
  });

  it('should compare digests without accepting a near miss', () => {
    const hash = hashRecoveryCode('K3M7QRTVWX');

    expect(recoveryHashEquals(hash, hash)).toBe(true);
    expect(recoveryHashEquals(hash, hashRecoveryCode('AAAAAAAAAA'))).toBe(
      false,
    );
    expect(recoveryHashEquals(hash, hash.slice(0, 62))).toBe(false);
    expect(recoveryHashEquals('', '')).toBe(false);
  });
});
