import { escapeHtml } from './escape-html';

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('Fish & Chips')).toBe('Fish &amp; Chips');
  });

  it('escapes quotes so attributes cannot be broken out of', () => {
    expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;');
    expect(escapeHtml("O'Brien")).toBe('O&#39;Brien');
  });

  it('escapes the ampersand of an entity only once', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('neutralises a script tag', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('neutralises an attribute break with an event handler', () => {
    expect(escapeHtml('" onload="alert(1)')).toBe(
      '&quot; onload=&quot;alert(1)',
    );
  });
});
