import { mediaUrl } from '../api/client';

/**
 * Where to play a playback grant from: private R2 hands out a short-lived presigned URL on the
 * storage endpoint (the bytes never pass through the API); local storage hands out a token for the
 * API's /media route.
 */
export function playbackUri(t: { token?: string; url?: string; expiresAt: string }): string {
  return t.url ?? mediaUrl(t.token!);
}
