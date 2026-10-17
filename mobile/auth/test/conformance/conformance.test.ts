import { describe, expect, it } from 'vitest';
import { runConformance } from '../../conformance';
import { fakeSubject } from '../support/conformance-fakes';

describe('adapter conformance suite', () => {
  it('reports a harness that cannot reset instead of passing its checks', async () => {
    const subject = fakeSubject();
    subject.driver.reset = async () => {
      throw new Error('The harness lost the device.');
    };

    const results = await runConformance(subject);

    expect(results).toHaveLength(36);
    expect(new Set(results.map((result) => (result.ok ? 'passed' : result.message)))).toEqual(
      new Set(['The harness lost the device.']),
    );
  });
});
