import { Gavel, ScrollText, Settings, ShieldAlert } from 'lucide-react-native';
import { RoleTabs } from '../../src/screens/TabsLayout';

export default function AdminLayout() {
  return (
    <RoleTabs
      role="admin"
      tabs={[
        { name: 'disputes', title: 'Disputes', icon: Gavel },
        { name: 'moderation', title: 'Moderation', icon: ShieldAlert },
        { name: 'audit', title: 'Audit', icon: ScrollText },
        { name: 'admin-settings', title: 'Settings', icon: Settings },
      ]}
    />
  );
}
