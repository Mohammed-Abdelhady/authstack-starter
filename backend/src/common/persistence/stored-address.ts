/** The canonical form for stored addresses and occupancy lookups. */
export function storedAddress(email: string): string {
  return email.trim().toLowerCase();
}
