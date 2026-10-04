// Local-only build: allow cleartext HTTP to the loopback API (reached through
// `adb reverse tcp:8787 tcp:8787`) and nowhere else. Every other host stays HTTPS-only.
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const DEV_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">localhost</domain>
  </domain-config>
</network-security-config>
`;
// Production builds (EXPO_PUBLIC_POCKETQA_ENV=production at prebuild): no cleartext anywhere,
// not even loopback, so a release binary can only reach the https API.
const PROD_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
</network-security-config>
`;
const xmlFor = (env) => (env === 'production' ? PROD_XML : DEV_XML);

function withLocalhostCleartext(config) {
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'network_security_config.xml'), xmlFor(process.env.EXPO_PUBLIC_POCKETQA_ENV));
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return c;
  });
}
module.exports = withLocalhostCleartext;
module.exports.xmlFor = xmlFor;
