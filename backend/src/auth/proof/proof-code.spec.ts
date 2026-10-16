import { validate } from 'class-validator';
import { ProofCodeDto } from './dto/proof-code.dto';

describe('proof code input', () => {
  // Failure: the proof endpoint accepts codes outside the six-digit search space.
  it.each([
    '12345',
    'abcdef',
    '1234567',
    '123456\n',
    '',
    null,
    undefined,
    123456,
  ])('refuses %s', async (code) => {
    const dto = Object.assign(new ProofCodeDto(), { code });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  // Failure: a valid code with a leading zero cannot prove a session.
  it('accepts exactly six digits', async () => {
    const dto = Object.assign(new ProofCodeDto(), { code: '012345' });
    expect(await validate(dto)).toEqual([]);
  });
});
