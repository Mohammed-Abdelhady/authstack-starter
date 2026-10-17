import type { AbortSignalPort } from '@app/native-auth';
import type { Transport } from '@app/sdk';

export interface EmailConfirmationProps {
  clientId: string;
  transport: Transport<AbortSignalPort>;
}
