import { emailCodeCapability } from './native-methods.service';

describe('email code capability in the methods reply', () => {
  it('adds the key as true when email code is on', () => {
    expect(emailCodeCapability(true)).toStrictEqual({ emailCode: true });
  });

  it('leaves the key out when email code is off, so an installed app still parses the reply', () => {
    const capability = emailCodeCapability(false);
    expect(capability).not.toHaveProperty('emailCode');
    expect(Object.keys(capability)).toEqual([]);
  });
});
