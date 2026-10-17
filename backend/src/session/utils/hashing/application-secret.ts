import { WEB_CLIENT_ID } from '../../constants/client-ids';
import { hashToken } from './token-hash';

/** Preserve legacy web hashes and bind other applications before hashing. */
export function applicationSecret(secret: string, clientId: string): string {
  return clientId === WEB_CLIENT_ID
    ? secret
    : hashToken(`${clientId}\0${secret}`);
}
