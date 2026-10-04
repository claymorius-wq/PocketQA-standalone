import { ScrollText } from 'lucide-react-native';
import { useFocusRefetch, useAudit } from '../../src/lib/queries';
import { adminAuditGlyph } from '../../src/screens/adminAudit';
import { EmptyState, QueryState, Screen } from '../../src/ui';
import { AuditGroove } from '../../src/ui/patterns';

// A-Audit: the log is one timeline card (AuditGroove), grouped by day; each entry is a glyph node
// on the groove (by the admin's subject: src/screens/adminAudit), the action key with its date
// right-aligned, the reason, then the target. S9: the groove draws top to bottom on mount and each
// node's rim lights as it passes (drawn at once under reduced motion). Every entry keeps the
// `audit-entry` testID.
export default function Audit() {
  const q = useAudit();
  useFocusRefetch(q);
  return (
    <Screen title="Audit log" subtitle="Every admin action, newest first" testID="audit-screen">
      <QueryState query={q} empty={(d) => (d.items.length === 0 ? <EmptyState icon={ScrollText} title="No admin actions yet" body="Dispute resolutions and moderation appear here." /> : null)}>
        {(d) => <AuditGroove entries={d.items} glyphFor={adminAuditGlyph} testID="audit-log" />}
      </QueryState>
    </Screen>
  );
}
