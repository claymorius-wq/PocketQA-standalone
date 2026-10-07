import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { DeviceProfile } from '@pocket-qa/contracts';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import Discover from '../app/(tester)/discover';

// Regression (production trace): a tester profile saved on WEB ({android, "Browser", API null,
// "Web preview"}) was never refreshed by the native Android app, and Discover silently hid every
// study that needs an API level. On NATIVE only, when the saved profile doesn't match this phone,
// Discover says so and offers "Use this phone's details", which saves this phone's values ONLY on
// that explicit tap (never silently) and refetches the eligible studies. Web is unchanged.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
const mockSession = { user: null as null | { device: DeviceProfile | null }, refreshUser: jest.fn(() => Promise.resolve()) };
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => mockSession }));
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), api: jest.fn() }));
jest.mock('../src/lib/queries', () => ({ useEligible: () => ({ isLoading: false, error: null, data: { items: [] }, refetch: jest.fn() }), useFocusRefetch: () => undefined }));
const { api } = jest.requireMock<{ api: jest.Mock }>('../src/api/client');

/** The production trace: saved on the web, as an Android profile without an API level. */
const FROM_WEB: DeviceProfile = { platform: 'android', osVersion: 'Browser', androidApiLevel: null, model: 'Web preview', languages: ['en', 'es'] };
const THIS_PIXEL: DeviceProfile = { platform: 'android', osVersion: '34', androidApiLevel: 34, model: 'Pixel 8', languages: ['en'] };

let client: QueryClient;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
async function renderDiscover(device: DeviceProfile | null) {
  mockSession.user = { device };
  client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider fonts="system">
          <Discover />
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const onPhone = (os: 'android' | 'ios', version: number | string) => {
  jest.replaceProperty(Platform, 'OS', os);
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(version as never);
};

beforeEach(() => {
  api.mockReset();
  mockSession.refreshUser.mockClear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => jest.restoreAllMocks());

describe('Discover · a device profile saved from another device (native only)', () => {
  it('Android phone, profile saved on the web: the notice shows, and nothing is saved without a tap', async () => {
    onPhone('android', 34);
    await renderDiscover(FROM_WEB);
    await settle();
    expect(screen.getByTestId('device-mismatch')).toHaveTextContent(/Your device profile was saved from another device/);
    expect(screen.getByTestId('device-use-this-phone')).toHaveTextContent(/Use this phone’s details|Use this phone's details/);
    expect(api).not.toHaveBeenCalled(); // never silently
  });

  it('the tap saves this phone’s details (keeping the saved languages), refreshes the profile and refetches eligibility', async () => {
    onPhone('android', 34);
    api.mockResolvedValue({});
    await renderDiscover(FROM_WEB);
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    await act(async () => fireEvent.press(screen.getByTestId('device-use-this-phone')));
    await settle();
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith('putDevice', { body: { platform: 'android', osVersion: '34', androidApiLevel: 34, model: 'My phone', languages: ['en', 'es'] } });
    expect(mockSession.refreshUser).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['eligible'] });
  });

  it.each<[string, DeviceProfile]>([
    ['another platform (iOS saved on this Android phone)', { ...THIS_PIXEL, platform: 'ios', androidApiLevel: null }],
    ['Android with no API level', { ...THIS_PIXEL, androidApiLevel: null }],
    ['Android with another API level', { ...THIS_PIXEL, androidApiLevel: 29 }],
    ['the web preview model', { ...THIS_PIXEL, model: 'Web preview' }],
  ])('Android phone: %s → the notice shows', async (_n, saved) => {
    onPhone('android', 34);
    await renderDiscover(saved);
    await settle();
    expect(screen.getByTestId('device-mismatch')).toBeTruthy();
  });

  it('iPhone with an Android profile: the notice shows; the tap saves iOS with no API level', async () => {
    onPhone('ios', '17.5');
    api.mockResolvedValue({});
    await renderDiscover(THIS_PIXEL);
    await settle();
    expect(screen.getByTestId('device-mismatch')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('device-use-this-phone')));
    await settle();
    expect(api).toHaveBeenCalledWith('putDevice', { body: { platform: 'ios', osVersion: '17.5', androidApiLevel: null, model: 'My phone', languages: ['en'] } });
  });

  it('no notice when the saved profile matches this phone', async () => {
    onPhone('android', 34);
    await renderDiscover(THIS_PIXEL);
    await settle();
    expect(screen.queryByTestId('device-mismatch')).toBeNull();
    expect(screen.getByTestId('device-matched')).toBeTruthy();
  });

  it('no notice on the web (unchanged), even for a profile from another device', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    await renderDiscover(FROM_WEB);
    await settle();
    expect(screen.queryByTestId('device-mismatch')).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it('no profile at all: the existing "Add your device profile" notice, not the mismatch one', async () => {
    onPhone('android', 34);
    await renderDiscover(null);
    await settle();
    expect(screen.getByTestId('device-missing')).toBeTruthy();
    expect(screen.queryByTestId('device-mismatch')).toBeNull();
  });
});
