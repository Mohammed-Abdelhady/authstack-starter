import { AdminCommandError } from './admin-command-error';
import {
  adminInviteArguments,
  adminRecoverArguments,
} from './admin-command-arguments';

// Failure: an invalid console command starts a privileged recovery or invitation with the wrong address.
describe.each([
  ['admin:invite', adminInviteArguments],
  ['admin:recover', adminRecoverArguments],
] as const)('%s arguments', (_name, parse) => {
  // Failure: malformed or ambiguous arguments start a privileged command.
  it.each([
    [],
    ['--email'],
    ['--email', '--unknown'],
    ['--email', 'invalid-address'],
    ['--email', ''],
    ['--email', 'admin@example.test', '--unknown', 'value'],
    ['--email', 'admin@example.test', '--email', 'other@example.test'],
  ])('refuses invalid arguments %j', (...args: string[]) => {
    expect(() => parse(args)).toThrow(AdminCommandError);
  });

  // Failure: the command targets a different account when address casing differs.
  it('accepts and normalizes the account address', () => {
    expect(parse(['--email=Admin@example.test']).email).toBe(
      'admin@example.test',
    );
  });
});

// Failure: recovery accepts a malformed destination or drops the intended destination.
it('validates both recovery addresses', () => {
  expect(() =>
    adminRecoverArguments([
      '--email',
      'admin@example.test',
      '--new-email',
      'broken',
    ]),
  ).toThrow(AdminCommandError);
  expect(
    adminRecoverArguments([
      '--email',
      'admin@example.test',
      '--new-email',
      'Recovery@example.test',
    ]),
  ).toEqual({ email: 'admin@example.test', newEmail: 'recovery@example.test' });
});
