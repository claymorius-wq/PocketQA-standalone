import { render } from '@testing-library/react-native';
import { useFocusRefetch } from '../src/lib/queries';

// Model expo-router's useFocusEffect: the callback re-runs whenever its identity changes.
let mockFocus: () => void = () => {};
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      mockFocus = cb;
      cb();
    }, [cb]);
  },
}));
jest.mock('../src/api/client', () => ({ api: jest.fn() }));

function Probe({ q }: { q: { refetch: () => unknown } }) {
  useFocusRefetch(q);
  return null;
}

describe('useFocusRefetch', () => {
  it('does not refetch on re-render with a new query object (no loop), but does on refocus', async () => {
    const refetch = jest.fn();
    const r = await render(<Probe q={{ refetch }} />);
    for (let i = 0; i < 5; i++) await r.rerender(<Probe q={{ refetch }} />);
    expect(refetch).toHaveBeenCalledTimes(0);
    mockFocus();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
