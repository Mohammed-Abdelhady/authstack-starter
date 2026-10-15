import { belongsTo, relyingPartyScope } from './relying-party.util';

const WEB_RP_ID = 'localhost';
const APP_RP_ID = 'app.example.test';

describe('relying party of a stored passkey', () => {
  it('gives a passkey stored with no relying party to the web one only, so an app never offers or accepts it', () => {
    expect(belongsTo({}, WEB_RP_ID, WEB_RP_ID)).toBe(true);
    expect(belongsTo({}, APP_RP_ID, WEB_RP_ID)).toBe(false);
    expect(relyingPartyScope(APP_RP_ID, WEB_RP_ID)).toEqual({
      rpId: APP_RP_ID,
      includesUnmarked: false,
    });
    expect(relyingPartyScope(WEB_RP_ID, WEB_RP_ID)).toEqual({
      rpId: WEB_RP_ID,
      includesUnmarked: true,
    });
  });

  it('gives an app passkey to its own relying party and not to the web one', () => {
    const appPasskey = { rpId: APP_RP_ID };

    expect(belongsTo(appPasskey, APP_RP_ID, WEB_RP_ID)).toBe(true);
    expect(belongsTo(appPasskey, WEB_RP_ID, WEB_RP_ID)).toBe(false);
  });
});
