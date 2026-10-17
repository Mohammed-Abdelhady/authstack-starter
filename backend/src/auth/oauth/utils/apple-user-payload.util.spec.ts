import { readAppleUserName } from './apple-user-payload.util';

describe('readAppleUserName', () => {
  it('swallows a malformed payload instead of failing the login', () => {
    expect(readAppleUserName('{not json')).toBeUndefined();
    expect(readAppleUserName('"a string"')).toBeUndefined();
  });
});
