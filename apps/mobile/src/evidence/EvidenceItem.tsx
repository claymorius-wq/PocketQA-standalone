import { useMutation } from '@tanstack/react-query';
import { Eye } from 'lucide-react-native';
import { useState } from 'react';
import type { Evidence } from '@pocket-qa/contracts';
import { api, ApiError, mediaUrl } from '../api/client';
import { bytes } from '../lib/format';
import { Button, Card, Notice, Row, Text } from '../ui';
import { MediaPreview } from './MediaPreview';

/** One evidence item with on-demand playback (short-lived token; builder or admin). */
export function EvidenceItem({ e }: { e: Evidence }) {
  const [url, setUrl] = useState<string | null>(null);
  const open = useMutation({
    mutationFn: () => api('playbackToken', { params: { id: e.id } }),
    onSuccess: (t) => setUrl(mediaUrl(t.token)),
  });
  return (
    <Card testID="evidence-item">
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="heading">{e.kind === 'screen_recording' ? 'Screen recording' : 'Screenshot'}</Text>
        <Text variant="small" tone="muted">{e.capturedOn} · {bytes(e.sizeBytes)}</Text>
      </Row>
      {url ? (
        <MediaPreview uri={url} mimeType={e.mimeType} testID="evidence-media" />
      ) : (
        <Button label="View" icon={Eye} variant="secondary" onPress={() => open.mutate()} loading={open.isPending} testID="evidence-view" />
      )}
      {open.error ? <Notice tone="danger" title="Can’t open evidence">{(open.error as ApiError).message}</Notice> : null}
      <Text variant="small" tone="muted">Playback links expire after 5 minutes.</Text>
    </Card>
  );
}
