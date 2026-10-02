import { Coins, FlaskConical, Settings } from 'lucide-react-native';
import { RoleTabs } from '../../src/screens/TabsLayout';

export default function BuilderLayout() {
  return (
    <RoleTabs
      role="builder"
      tabs={[
        { name: 'studies', title: 'Studies', icon: FlaskConical },
        { name: 'budget', title: 'Budget', icon: Coins },
        { name: 'builder-settings', title: 'Settings', icon: Settings },
      ]}
    />
  );
}
