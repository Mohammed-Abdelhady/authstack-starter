import { multiselect, text } from '@clack/prompts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { askPlan, planPromptNeeds } from '../../src/prompts/plan.js';
import { CANCELLED } from '../../src/prompts/index.js';
import { TARGETS_MANIFEST } from '../support/targets-fixture.js';

vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  multiselect: vi.fn(),
  groupMultiselect: vi.fn(),
  text: vi.fn(),
  isCancel: (value: unknown) => typeof value === 'symbol',
}));

afterEach(() => vi.resetAllMocks());

const ONLY_TARGETS = {
  targets: true,
  database: false,
  features: false,
  options: false,
  mobile: false,
  rules: false,
};
const NOTHING = { ...ONLY_TARGETS, targets: false };

describe('what a run has to ask about the mobile app', () => {
  it('asks for the clients when two are on offer and none was named', () => {
    expect(planPromptNeeds(TARGETS_MANIFEST, {}, true).targets).toBe(true);
    expect(planPromptNeeds(TARGETS_MANIFEST, { targets: ['web'] }, true).targets).toBe(false);
  });

  it('needs the identity only for a chosen mobile app with a field still open', () => {
    const all = { name: 'Notes', slug: 'notes', appId: 'org.sample.notes', scheme: 'notes' };

    expect([
      planPromptNeeds(TARGETS_MANIFEST, { targets: ['web'] }, true).mobile,
      planPromptNeeds(TARGETS_MANIFEST, { targets: ['native-expo'] }, true).mobile,
      planPromptNeeds(TARGETS_MANIFEST, { targets: ['native-expo'], mobile: { name: 'N' } }, true)
        .mobile,
      planPromptNeeds(TARGETS_MANIFEST, { targets: ['native-expo'], mobile: all }, true).mobile,
    ]).toEqual([false, true, true, false]);
  });
});

describe('the mobile identity questions', () => {
  it('asks nothing about the app when the web app is chosen alone', async () => {
    vi.mocked(multiselect).mockResolvedValue(['web']);

    expect(await askPlan(TARGETS_MANIFEST, {}, ONLY_TARGETS)).toEqual({ targets: ['web'] });
    expect(text).not.toHaveBeenCalled();
  });

  it('asks the four fields once the mobile app is chosen, showing each default', async () => {
    vi.mocked(multiselect).mockResolvedValue(['web', 'native-expo']);
    vi.mocked(text)
      .mockResolvedValueOnce('Trail Log')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('org.sample.trail')
      .mockResolvedValueOnce('trail');

    const answers = await askPlan(TARGETS_MANIFEST, { projectName: 'field-notes' }, ONLY_TARGETS);

    expect(answers).toEqual({
      targets: ['web', 'native-expo'],
      mobile: {
        name: 'Trail Log',
        slug: 'field-notes',
        appId: 'org.sample.trail',
        scheme: 'trail',
      },
    });
    expect(vi.mocked(text).mock.calls.map(([options]) => options.defaultValue)).toEqual([
      'Field Notes',
      'field-notes',
      'com.example.fieldnotes',
      'com.example.fieldnotes',
    ]);
  });

  it('asks only the fields a flag left open', async () => {
    vi.mocked(text).mockResolvedValueOnce('notes-app');
    const given = { name: 'Notes', appId: 'org.sample.notes', scheme: 'notes' };

    const answers = await askPlan(
      TARGETS_MANIFEST,
      { targets: ['native-expo'], mobile: given, projectName: 'field-notes' },
      NOTHING,
    );

    expect(answers).toEqual({ mobile: { ...given, slug: 'notes-app' } });
    expect(text).toHaveBeenCalledTimes(1);
  });

  it('refuses a bad answer in the prompt and accepts an empty one for the default', async () => {
    vi.mocked(multiselect).mockResolvedValue(['native-expo']);
    vi.mocked(text).mockResolvedValue('');

    await askPlan(TARGETS_MANIFEST, { projectName: 'field-notes' }, ONLY_TARGETS);
    const scheme = vi.mocked(text).mock.calls[3][0].validate;
    if (typeof scheme !== 'function') throw new Error('The scheme question has no check.');

    expect(scheme('https')).toBe('"https" belongs to the system. Use a scheme of your own.');
    expect(scheme('')).toBeUndefined();
    expect(scheme('trail')).toBeUndefined();
  });

  it('stops when an identity question is cancelled', async () => {
    vi.mocked(multiselect).mockResolvedValue(['native-expo']);
    // The prompt library answers a cancelled question with a symbol of its own.
    const question = vi.mocked(text);
    Reflect.apply(question.mockResolvedValue, question, [Symbol('cancel')]);

    expect(await askPlan(TARGETS_MANIFEST, {}, ONLY_TARGETS)).toBe(CANCELLED);
  });
});
