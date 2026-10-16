import { isEmail } from 'class-validator';
import { LANGUAGE_TAG_MAX_LENGTH } from '../common/constants/locales';
import {
  NAME_HAS_LETTER_REGEX,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  NAME_REGEX,
} from '../common/constants/name';
import { storedAddress } from '../common/persistence/stored-address';
import { AdminCommandError } from './admin-command-error';
import type {
  AdminInviteOptions,
  AdminRecoverOptions,
} from './types/admin-command';

function argumentsMap(
  args: readonly string[],
  flags: readonly string[],
): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const separator = argument.indexOf('=');
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    if (!flags.includes(flag)) throw new AdminCommandError('Unknown flag');
    if (values.has(flag)) throw new AdminCommandError('Duplicate flag');
    const value =
      separator === -1 ? args[++index] : argument.slice(separator + 1);
    if (!value || value.startsWith('--'))
      throw new AdminCommandError('Missing flag value');
    values.set(flag, value);
  }
  return values;
}

function emailArgument(value: string | undefined, flag: string): string {
  if (!value) throw new AdminCommandError(`${flag} is required`);
  if (!isEmail(value))
    throw new AdminCommandError(`${flag} must be an email address`);
  return storedAddress(value);
}

export function adminInviteArguments(
  args: readonly string[],
): AdminInviteOptions {
  const values = argumentsMap(args, ['--email', '--name', '--locale']);
  const email = emailArgument(values.get('--email'), '--email');
  const name = values.get('--name')?.trim().normalize('NFC');
  if (
    name !== undefined &&
    (Array.from(name).length < NAME_MIN_LENGTH ||
      Array.from(name).length > NAME_MAX_LENGTH ||
      !NAME_REGEX.test(name) ||
      !NAME_HAS_LETTER_REGEX.test(name))
  ) {
    throw new AdminCommandError('Invalid name');
  }
  const locale = values.get('--locale');
  if (locale !== undefined && locale.length > LANGUAGE_TAG_MAX_LENGTH)
    throw new AdminCommandError('Invalid locale');
  return { email, name, locale };
}

export function adminRecoverArguments(
  args: readonly string[],
): AdminRecoverOptions {
  const values = argumentsMap(args, ['--email', '--new-email']);
  const email = emailArgument(values.get('--email'), '--email');
  const next = values.get('--new-email');
  return {
    email,
    newEmail:
      next === undefined ? undefined : emailArgument(next, '--new-email'),
  };
}
