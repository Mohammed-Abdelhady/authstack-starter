import { storedAddress } from '../../../common/persistence/stored-address';
import { ACTIVITY_PERSONAL_FIELDS } from '../../../session/events/constants/activity-details';

/** Every detail field the log may hold about a person, whatever the action. */
export const PERSONAL_DETAIL_FIELDS: readonly string[] = [
  ...new Set(Object.values(ACTIVITY_PERSONAL_FIELDS).flat()),
];

/** Each address as stored and as given, so a row written either way matches. */
export function addressesToMatch(addresses: readonly string[]): string[] {
  return [
    ...new Set(
      addresses.flatMap((address) => [address, storedAddress(address)]),
    ),
  ];
}
