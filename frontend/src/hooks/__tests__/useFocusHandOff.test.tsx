// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { Heading } from '@/components/design-system/Heading';
import { useRetryHandOff } from '../useFocusHandOff';

interface PageProps {
  /** What the failure gives way to: nothing, or the content with its heading. */
  readonly keepsRetry?: boolean;
}

/** A failure with a Retry, replaced by content when the button beside it says so. */
function Page({ keepsRetry = false }: PageProps) {
  const [hasFailed, setHasFailed] = useState(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retry = useRetryHandOff(hasFailed, () => undefined, headingRef);
  return (
    <>
      {(hasFailed || keepsRetry) && <button data-testid="retry" onClick={retry} />}
      <Heading level={1} variant="pageTitle" ref={headingRef} tabIndex={-1} data-testid="heading" />
      <input data-testid="elsewhere" />
      <button data-testid="recover" onClick={() => setHasFailed(false)} />
    </>
  );
}

const focusedId = () => document.activeElement?.getAttribute('data-testid') ?? null;

/** Presses Retry with the focus on it, as a key does. */
function pressRetry() {
  const retry = screen.getByTestId('retry');
  retry.focus();
  fireEvent.click(retry);
}

afterEach(cleanup);

describe('focus when a Retry leaves with its failure', () => {
  it('goes to the heading when Retry is gone', () => {
    render(<Page />);
    pressRetry();

    fireEvent.click(screen.getByTestId('recover'));

    expect(screen.queryByTestId('retry')).toBeNull();
    expect(focusedId()).toBe('heading');
  });

  it('goes to the heading when Retry is still in the page with the focus, as a hidden one is', () => {
    render(<Page keepsRetry />);
    pressRetry();

    fireEvent.click(screen.getByTestId('recover'));

    expect(focusedId()).toBe('heading');
  });

  it('leaves a person who moved on where they are', () => {
    render(<Page />);
    pressRetry();
    screen.getByTestId('elsewhere').focus();

    fireEvent.click(screen.getByTestId('recover'));

    expect(focusedId()).toBe('elsewhere');
  });

  it('moves nothing when the failure ends without Retry having been pressed', () => {
    render(<Page />);
    screen.getByTestId('elsewhere').focus();
    screen.getByTestId('elsewhere').blur();

    fireEvent.click(screen.getByTestId('recover'));

    expect(focusedId()).toBeNull();
  });
});
