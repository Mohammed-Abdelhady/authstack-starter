import { model } from 'mongoose';
import { Application, ApplicationSchema } from './application.schema';

const APPLICATION_MODEL_NAME = 'ApplicationRedirectUriValidationSpec';
const APPLICATION_MODEL = model<Application>(
  APPLICATION_MODEL_NAME,
  ApplicationSchema,
);

describe('Application redirect URI validation', () => {
  it('accepts supported callback addresses', () => {
    const application = new APPLICATION_MODEL({
      clientId: 'native-test',
      displayName: 'Native test',
      platform: 'native',
      environment: 'test',
      clientType: 'public',
      redirectUris: ['myapp://callback', 'https://client.example/callback'],
    });

    expect(application.validateSync()).toBeUndefined();
  });

  it('rejects unsafe callback addresses before persistence', () => {
    const application = new APPLICATION_MODEL({
      clientId: 'native-test',
      displayName: 'Native test',
      platform: 'native',
      environment: 'test',
      clientType: 'public',
      redirectUris: ['javascript:alert(1)'],
    });

    expect(application.validateSync()?.errors.redirectUris).toBeDefined();
  });
});
