import { ApplicationDocument } from './schemas/application.schema';
import {
  RegisteredApplication,
  RegisteredClient,
} from '../../applications/application-registry.store';
import { toIssuanceApplication } from './mongo-issuance-mappers';

/**
 * The documents behind what the registry store handed out. Callers that still
 * speak Mongoose get the document back through here; the port never carries it.
 */
const applicationRecords = new WeakMap<
  RegisteredApplication,
  ApplicationDocument
>();

export function toRegisteredApplication(
  document: ApplicationDocument,
): RegisteredApplication {
  const registered: RegisteredApplication = {
    ...toIssuanceApplication(document),
    allowedOrigins: [...document.allowedOrigins],
  };
  applicationRecords.set(registered, document);
  return registered;
}

export function toRegisteredClient(
  document: ApplicationDocument,
): RegisteredClient {
  return {
    ...toIssuanceApplication(document),
    allowedOrigins: [...document.allowedOrigins],
    clientType: document.clientType,
    redirectUris: [...document.redirectUris],
    displayName: document.displayName,
  };
}

/** The application as Mongoose callers know it. Throws for one this adapter did not read. */
export function applicationDocumentOf(
  registered: RegisteredApplication,
): ApplicationDocument {
  const document = applicationRecords.get(registered);
  if (!document) {
    throw new Error('This application was not read by the MongoDB adapter');
  }
  return document;
}
