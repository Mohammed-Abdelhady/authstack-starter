import { multiselect, text } from '@clack/prompts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureRoot, run } from '../support/answers-helpers.js';
import { rmSync } from 'node:fs';

vi.mock('@clack/prompts', async (original) => ({
  ...(await original<typeof import('@clack/prompts')>()),
  multiselect: vi.fn(),
  text: vi.fn(),
}));

const manifestRoot = fixtureRoot();
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
/** Everything but the clients is fixed, so the clients question is the only one asked first. */
const FLAGS = [
  '--dry-run',
  '--features',
  'email-password',
  '--no-production',
  '--rules',
  'strict',
  '--database',
  'mongodb',
  '--mobile-name',
  'Trail Log',
];

beforeEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
});

afterEach(() => {
  if (ttyDescriptor) Object.defineProperty(process.stdin, 'isTTY', ttyDescriptor);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  vi.resetAllMocks();
});

afterAll(() => rmSync(manifestRoot, { recursive: true, force: true }));

describe('a mobile flag given before the clients are chosen in a terminal', () => {
  it('waits for the clients answer and names the app when the mobile app is picked', async () => {
    vi.mocked(multiselect).mockResolvedValue(['web', 'native-expo']);
    vi.mocked(text).mockResolvedValue('');

    const { code, output } = await run(manifestRoot, FLAGS);

    expect(code).toBe(0);
    expect(output).toContain('Mobile     Trail Log (slug my-app)');
    expect(text).toHaveBeenCalledTimes(3);
  });

  it('exits 2 after the answer when the mobile app is not picked', async () => {
    vi.mocked(multiselect).mockResolvedValue(['web']);

    const { code, output } = await run(manifestRoot, FLAGS);

    expect(code).toBe(2);
    expect(output).toContain('--mobile-name names a mobile app, and no mobile client was chosen.');
    expect(text).not.toHaveBeenCalled();
  });

  it.each([
    ['--mobile-scheme', 'https'],
    ['--mobile-app-id', 'notes'],
    ['--mobile-slug', 'Field Notes'],
  ])('exits 2 for a refused %s before any question is asked', async (flag, value) => {
    vi.mocked(multiselect).mockResolvedValue(['web', 'native-expo']);
    vi.mocked(text).mockResolvedValue('');

    const { code, output } = await run(manifestRoot, [...FLAGS, flag, value]);

    expect(code).toBe(2);
    expect(output).toContain(`${flag}: `);
    expect(multiselect).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  it('reports a refused value once when the clients are already named', async () => {
    const { code, output } = await run(manifestRoot, [
      ...FLAGS,
      '--targets',
      'web,native-expo',
      '--mobile-scheme',
      'https',
    ]);

    expect(code).toBe(2);
    expect(output.split('--mobile-scheme: ')).toHaveLength(2);
    expect(text).not.toHaveBeenCalled();
  });
});
