import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import { CONFIG, ScriptedTransport, testPorts } from '../support/support';

describe('redirect configuration', () => {
  it.each([
    'https://app.example.test/a%20b',
    'https://app.example.test/a|b',
    'http://app.localhost:3000/cb',
    'myapp://Host/cb',
    'myapp://host:0/cb',
    'myapp:///cb',
    'com.example.app:/oauth',
    'myapp:a/../b',
    'myapp:a/./b',
    'myapp:a^b',
    'myapp://h/a|b',
    'myapp://h/%zz',
  ])('accepts a redirect the server preserves: %s', (redirectUri) => {
    expect(() =>
      createAuthEngine({ ...CONFIG, redirectUri }, testPorts(new ScriptedTransport())),
    ).not.toThrow();
  });

  it.each([
    'https:/host/cb',
    'https://1.1/cb',
    'https://0x7f.1/cb',
    'https://2130706433/cb',
    'https://[::0001]/cb',
    'https://app.example.test',
    'https://APP.example.test/cb',
    'https://app.example.test/a/./cb',
    'https://app.example.test/a^b',
    'ftp://host/cb',
    'ws://host/cb',
    'wss://host/cb',
    'myapp://h/a/./b',
    'myapp://h/a^b',
    'myapp:/a/..',
    'myapp://',
    'myapp://bad!host/cb',
    'https://256.1.1.1/cb',
    'myapp://host:0080/cb',
    'myapp://host:65536/cb',
  ])('rejects a redirect the server rewrites or does not permit: %s', (redirectUri) => {
    expect(() =>
      createAuthEngine({ ...CONFIG, redirectUri }, testPorts(new ScriptedTransport())),
    ).toThrow(TypeError);
  });

  it.each([
    'https://app.example.test',
    'https://app.example.test/a/../callback',
    'https://app.example.test/%2e%2e/callback',
    'sampleapp://auth/call{back}',
    'sampleapp://auth/a"b',
    'sampleapp://auth/a<b>',
    'sampleapp://auth/a`b',
    'sampleapp://auth/càllback',
    'sampleapp://auth/a/../callback',
    'sampleapp://auth/a/%2e%2e/callback',
  ])('rejects a return address the server will rewrite: %s', (redirectUri) => {
    expect(() =>
      createAuthEngine({ ...CONFIG, redirectUri }, testPorts(new ScriptedTransport())),
    ).toThrow(TypeError);
  });
});
