import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { ApplicationAccess } from '../../applications/application-access';

/**
 * The MongoDB face of application access, for callers that still hold Mongoose
 * ids. Every decision is `ApplicationAccess`'s.
 */
@Injectable()
export class ApplicationAccessService {
  constructor(private readonly access: ApplicationAccess) {}

  blockGrant(userId: Types.ObjectId, clientId: string): Promise<void> {
    return this.access.blockGrant(userId.toString(), clientId);
  }

  disableApplication(clientId: string): Promise<void> {
    return this.access.disableApplication(clientId);
  }

  enableApplication(clientId: string): Promise<void> {
    return this.access.enableApplication(clientId);
  }
}
