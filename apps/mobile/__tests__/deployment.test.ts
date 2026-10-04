import { deploymentProblem } from '../src/lib/deployment';

const prod = { env: 'production', preview: false, platform: 'android' };
describe('production build checks', () => {
  it('development builds are never blocked', () => {
    expect(deploymentProblem({ env: undefined, apiUrl: undefined, preview: true, platform: 'android' })).toBeNull();
  });
  it('accepts an https API on a real host, and same-origin /api on web only', () => {
    expect(deploymentProblem({ ...prod, apiUrl: 'https://api.pocketqa.example' })).toBeNull();
    expect(deploymentProblem({ ...prod, platform: 'web', apiUrl: '/api' })).toBeNull();
    expect(deploymentProblem({ ...prod, apiUrl: '/api' })).toMatch(/API address/);
  });
  it('refuses missing, plain-http and loopback API addresses (no adb reverse in production)', () => {
    for (const apiUrl of [undefined, '', 'http://api.pocketqa.example', 'https://127.0.0.1:8787', 'https://localhost', 'http://10.0.2.2:8787', 'https://127.1', 'https://0.0.0.0', 'https://localhost.', 'https://[::ffff:127.0.0.1]', 'https://10.0.2.2', 'https://192.168.0.5']) {
      expect(deploymentProblem({ ...prod, apiUrl })).not.toBeNull();
    }
  });
  it('refuses the shared-demo preview in a production build', () => {
    expect(deploymentProblem({ ...prod, preview: true, apiUrl: 'https://api.pocketqa.example' })).toMatch(/demo preview/);
  });
});
