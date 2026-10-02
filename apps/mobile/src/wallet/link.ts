// Web / iOS: Mobile Wallet Adapter is Android-only. The UI never offers linking here
// (walletCapability), and this throws rather than pretending to link.
export async function linkWalletWithMwa(): Promise<never> {
  throw new Error('Wallet linking uses Mobile Wallet Adapter, which works only in the Android app.');
}
