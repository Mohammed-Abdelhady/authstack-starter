import { describe, expect, it } from 'vitest';
import { QR_MAX_VERSION } from '../tables';
import { byteCapacity } from '../encode';
import { formatBits, versionBits } from '../format';
import { encodeQrCode } from '../index';
import { qrPathData, QR_QUIET_ZONE } from '../render';

describe('format and version information', () => {
  it('matches the published bits for level M', () => {
    expect(formatBits(0)).toBe(0b101010000010010);
    expect(formatBits(4)).toBe(0b100010111111001);
    expect(formatBits(7)).toBe(0b100101010100000);
  });

  it('matches the published version bits', () => {
    expect(versionBits(7)).toBe(0b000111110010010100);
    expect(versionBits(10)).toBe(0b001010010011010011);
  });
});

describe('encodeQrCode', () => {
  it('returns null rather than truncating an oversized payload', () => {
    expect(encodeQrCode('x'.repeat(byteCapacity(QR_MAX_VERSION) + 1))).toBeNull();
  });
});

describe('qrPathData', () => {
  it('draws one square per dark module, offset by the quiet zone', () => {
    expect(qrPathData([[true, false]])).toBe(`M${QR_QUIET_ZONE} ${QR_QUIET_ZONE}h1v1h-1z`);
    expect(qrPathData([[false, false]])).toBe('');
  });
});
