import { IdFormat } from '../id-format';
import { MalformedIdError } from '../persistence-errors';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';

/** An id is text the stores' own parser reads as a UUID. */
export class PostgresIdFormat extends IdFormat {
  isId(id: string): boolean {
    try {
      toUuid(id);
      return true;
    } catch (error) {
      if (error instanceof MalformedIdError) {
        return false;
      }
      throw error;
    }
  }
}
