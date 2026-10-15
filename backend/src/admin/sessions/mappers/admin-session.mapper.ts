import { DEVICE_KIND } from '../../../common/constants/session';
import { parseUserAgent } from '../../../common/utils/parse-user-agent';
import { StoredSession } from '../../../session/authority/session-authority.store';
import { CREDENTIAL_PURPOSE } from '../../../session/constants/credential-purpose';
import { AdminSessionDto } from '../dto/admin-session-response.dto';

export function toAdminSessionDto(session: StoredSession): AdminSessionDto {
  return {
    id: session.id,
    clientId: session.clientId,
    userAgent: session.userAgent,
    ip: session.ip,
    deviceName: session.deviceName ?? undefined,
    deviceParts: {
      ...parseUserAgent(session.userAgent).parts,
      ...(session.credentialPurpose === CREDENTIAL_PURPOSE.NATIVE_ACCESS
        ? { kind: DEVICE_KIND.MOBILE_APP }
        : {}),
    },
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt ?? undefined,
    isCurrent: false,
    credentialPurpose: session.credentialPurpose,
  };
}
