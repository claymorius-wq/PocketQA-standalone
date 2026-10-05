import { RequireRole } from '../src/screens/RequireRole';
import { ReputationScreen } from '../src/screens/ReputationScreen';

export default function Reputation() {
  return (
    <RequireRole role="tester">
      <ReputationScreen />
    </RequireRole>
  );
}
