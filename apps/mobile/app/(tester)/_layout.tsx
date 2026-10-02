import { ClipboardList, Coins, Compass, Settings } from 'lucide-react-native';
import { RoleTabs } from '../../src/screens/TabsLayout';

export default function TesterLayout() {
  return (
    <RoleTabs
      role="tester"
      tabs={[
        { name: 'discover', title: 'Discover', icon: Compass },
        { name: 'work', title: 'My work', icon: ClipboardList },
        { name: 'credits', title: 'Credits', icon: Coins },
        { name: 'settings', title: 'Settings', icon: Settings },
      ]}
    />
  );
}
