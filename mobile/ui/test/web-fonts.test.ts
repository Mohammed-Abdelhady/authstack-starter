import { describe, expect, it } from 'vitest';
import { fontReadiness } from '../src/logic/font-readiness';

describe('native web font readiness', () => {
  it('uses platform fonts until the local faces finish loading', () => {
    expect(fontReadiness(false, null)).toBe(false);
  });

  it('allows the registered faces after a successful load', () => {
    expect(fontReadiness(true, null)).toBe(true);
  });

  it('uses platform fonts when the font bridge reports an error', () => {
    expect(fontReadiness(false, new Error('font loading failed'))).toBe(false);
  });

  it('keeps the fallback when a loaded result also carries an error', () => {
    expect(fontReadiness(true, new Error('partial font loading failed'))).toBe(false);
  });
});
