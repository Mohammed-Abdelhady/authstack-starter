import { MongoIdFormat } from './mongo-id-format';

describe('MongoIdFormat', () => {
  it.each([
    ['24 hexadecimal characters', '507f1f77bcf86cd799439011', true],
    ['the same in upper case', '507F1F77BCF86CD799439011', true],
    ['23 characters', '507f1f77bcf86cd79943901', false],
    ['25 characters', '507f1f77bcf86cd7994390111', false],
    ['24 characters with a letter past f', '507f1f77bcf86cd79943901z', false],
    ['12 characters', '123456789012', false],
    ['a UUID', '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f', false],
    ['an empty string', '', false],
    ['a word', 'not-an-id', false],
  ])('answers for %s', (_, id, expected) => {
    expect(new MongoIdFormat().isId(id)).toBe(expected);
  });
});
