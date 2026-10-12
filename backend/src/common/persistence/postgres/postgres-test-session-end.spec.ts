import { ignoreSessionEnd } from '../../../../test/postgres/postgres-connection';

describe('the listener a suite puts on a pool its server is about to stop under', () => {
  it('lets through the state a stopping server ends a session with', () => {
    const ended = Object.assign(new Error('terminating connection'), {
      code: '57P01',
    });

    expect(() => ignoreSessionEnd(ended)).not.toThrow();
  });

  it('raises every other fault, whatever shape it has', () => {
    const refused = Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED',
    });
    const raised = [refused, new Error('no code'), 'a string', null].map(
      (fault) => {
        try {
          ignoreSessionEnd(fault);
        } catch (error) {
          return error instanceof Error ? error.message : 'not an error';
        }
        return 'let through';
      },
    );

    expect(raised).toEqual([
      'connection refused',
      'no code',
      'a string',
      'null',
    ]);
  });
});
