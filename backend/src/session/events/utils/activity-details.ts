import { PERMISSION_REGEX } from '../../../common/constants/permissions';
import {
  ACTIVITY_DETAIL_FIELDS,
  ACTIVITY_MAX_TEXT_LENGTH,
  SECURITY_EVENT_KIND,
} from '../constants/activity-details';
import {
  ActivityDetails,
  ActivityEventFields,
  SecurityEventKind,
} from '../types/activity-event';

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/;
const CHANGED_FIELDS = ['name', 'email'];
const MAX_LIST_LENGTH = 100;

function validListItem(shape: string, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (shape === 'fields') return CHANGED_FIELDS.includes(value);
  return (
    value.length <= ACTIVITY_MAX_TEXT_LENGTH && PERMISSION_REGEX.test(value)
  );
}

function validValue(shape: string, value: unknown): boolean {
  if (shape === 'boolean') return typeof value === 'boolean';
  if (shape === 'text') {
    return (
      typeof value === 'string' && value.length <= ACTIVITY_MAX_TEXT_LENGTH
    );
  }
  if (shape === 'id')
    return typeof value === 'string' && ID_PATTERN.test(value);
  if (shape === 'permission')
    return (
      typeof value === 'string' &&
      value.length <= ACTIVITY_MAX_TEXT_LENGTH &&
      PERMISSION_REGEX.test(value)
    );
  if (!Array.isArray(value) || value.length > MAX_LIST_LENGTH) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    const item: unknown = descriptor?.value;
    if (!descriptor || !('value' in descriptor) || !validListItem(shape, item))
      return false;
  }
  return true;
}

export function activityDetails(
  action: string,
  details: unknown,
): ActivityDetails {
  if (!Object.hasOwn(ACTIVITY_DETAIL_FIELDS, action)) {
    throw new TypeError('Unknown activity action');
  }
  if (details === undefined) return {};
  if (
    details === null ||
    typeof details !== 'object' ||
    Array.isArray(details)
  ) {
    throw new TypeError('Activity details must be a plain object');
  }
  const prototype: unknown = Object.getPrototypeOf(details);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Activity details must be a plain object');
  }
  const fields = ACTIVITY_DETAIL_FIELDS[action];
  const accepted: ActivityDetails = {};
  for (const key of Reflect.ownKeys(details)) {
    if (typeof key !== 'string' || !Object.hasOwn(fields, key)) {
      throw new TypeError('Unknown activity detail field');
    }
    const descriptor = Object.getOwnPropertyDescriptor(details, key);
    const value: unknown = descriptor?.value;
    if (
      !descriptor ||
      !('value' in descriptor) ||
      !validValue(fields[key], value)
    ) {
      throw new TypeError('Invalid activity detail value');
    }
    if (typeof value === 'string' || typeof value === 'boolean')
      accepted[key] = value;
    else if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const item: unknown = Object.getOwnPropertyDescriptor(
          value,
          index,
        )?.value;
        if (!validListItem(fields[key], item))
          throw new TypeError('Invalid activity detail value');
        items.push(item);
      }
      accepted[key] = items;
    }
  }
  return accepted;
}

export function eventActivityFields(
  input: Pick<ActivityEventFields, 'details'> & {
    action: string;
    actorId?: string;
  },
  allowLegacyEmpty = false,
): { kind: SecurityEventKind; details: ActivityDetails } {
  const staffAction = Object.hasOwn(ACTIVITY_DETAIL_FIELDS, input.action);
  const kind =
    input.actorId && staffAction
      ? SECURITY_EVENT_KIND.STAFF
      : SECURITY_EVENT_KIND.SIGN_IN;
  const legacyEmpty =
    allowLegacyEmpty &&
    kind === 'sign_in' &&
    !staffAction &&
    input.details !== null &&
    typeof input.details === 'object' &&
    !Array.isArray(input.details) &&
    Reflect.ownKeys(input.details).length === 0;
  const details =
    !legacyEmpty && (input.details !== undefined || kind === 'staff')
      ? activityDetails(input.action, input.details)
      : {};
  return { kind, details };
}
