import { Injectable } from '@nestjs/common';
import { EmailChangeConfirmationService } from '../../../auth/services/registration/email-change-confirmation.service';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { ApplicationRegistry } from '../../../session/applications/application-registry';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
} from '../../../session/constants/client-ids';
import { NativeEmailChangeConfirmDto } from '../dto/native-email-change-confirm.dto';
import { clientRefused } from '../utils/own-email-errors';

/**
 * Confirms an address change from a mobile app, for a person who may be
 * signed out: the same confirmation as the public route, for a registered
 * native client, without a browser proof.
 */
@Injectable()
export class NativeEmailChangeService {
  constructor(
    private readonly applications: ApplicationRegistry,
    private readonly epoch: AuthEpochService,
    private readonly confirmation: EmailChangeConfirmationService,
  ) {}

  /**
   * @throws AppException FORBIDDEN for a client that is not an enabled public
   *   native application, before any code is counted
   * @throws AppException ACTIVATION_CODE_INVALID for every code that cannot
   *   move an account
   */
  async confirm(
    dto: NativeEmailChangeConfirmDto,
  ): Promise<ApiResponse<{ message: string }>> {
    if (!(await this.isNativeClient(dto.clientId))) throw clientRefused();
    return this.confirmation.confirm({ email: dto.email, code: dto.code });
  }

  private async isNativeClient(clientId: string): Promise<boolean> {
    if (!this.epoch.nativeEnabled()) return false;
    const client = await this.applications.lookUpClient(clientId);
    return (
      client?.enabled === true &&
      client.platform === APPLICATION_PLATFORM.NATIVE &&
      client.clientType === APPLICATION_CLIENT_TYPE.PUBLIC
    );
  }
}
