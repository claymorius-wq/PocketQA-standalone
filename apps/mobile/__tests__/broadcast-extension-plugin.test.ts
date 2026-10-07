/**
 * @jest-environment node
 */
// The iPhone recorder is a Broadcast Upload Extension that `expo prebuild` must recreate
// reproducibly (docs/plans/native-screen-voice-recording.md, Design: iOS 4). The baseline fixture
// is the unmodified project that `expo prebuild --platform ios` generates for this app.
import fs from 'fs';
import path from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const xcode = require(require.resolve('xcode', { paths: [path.dirname(require.resolve('@expo/config-plugins'))] }));
const plist = require('@expo/plist').default;
const plugin = require('../plugins/withBroadcastExtension');
/* eslint-enable @typescript-eslint/no-require-imports */

const FIXTURE = path.join(__dirname, 'fixtures/ios-baseline.pbxproj');
const MODULE_DIR = path.join(__dirname, '../../../modules/screen-capture');
const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8')).expo;
const GROUP = 'group.com.reshareai.pocketqa';

function baseline() {
  const p = xcode.project(FIXTURE);
  p.parseSync();
  return p;
}
const opts = { appBundleId: 'com.reshareai.pocketqa', appGroup: GROUP, appTargetName: 'PocketQA' };
const unquote = (s: unknown) => String(s).replace(/^"|"$/g, '');
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const section = (p: Obj, isa: string): Obj => p.hash.project.objects[isa] ?? {};
const entries = (p: Obj, isa: string) => Object.entries(section(p, isa)).filter(([k]) => !k.endsWith('_comment')) as [string, Obj][];
function targetNamed(p: Obj, name: string) {
  return entries(p, 'PBXNativeTarget').find(([, t]) => unquote(t.name) === name);
}
function phasesOf(p: Obj, target: Obj, isa: string) {
  return target.buildPhases.map((ph: Obj) => section(p, isa)[ph.value]).filter(Boolean);
}
function buildSettings(p: Obj, target: Obj) {
  const list = section(p, 'XCConfigurationList')[target.buildConfigurationList];
  return list.buildConfigurations.map((c: Obj) => section(p, 'XCBuildConfiguration')[c.value]);
}
function fileNamesIn(p: Obj, phase: Obj) {
  return phase.files.map((f: Obj) => {
    const bf = section(p, 'PBXBuildFile')[f.value];
    return unquote(section(p, 'PBXFileReference')[bf.fileRef].path);
  });
}

describe('withBroadcastExtension: Xcode project', () => {
  it('adds the PocketQaBroadcast app-extension target with the extension bundle id', () => {
    const p = plugin.addBroadcastExtension(baseline(), opts);
    const found = targetNamed(p, 'PocketQaBroadcast');
    expect(found).toBeDefined();
    const [, t] = found!;
    expect(unquote(t.productType)).toBe('com.apple.product-type.app-extension');
    const configs = buildSettings(p, t);
    expect(configs.map((c: Obj) => c.name).sort()).toEqual(['Debug', 'Release']);
    for (const c of configs) {
      const s = c.buildSettings;
      expect(unquote(s.PRODUCT_BUNDLE_IDENTIFIER)).toBe('com.reshareai.pocketqa.Broadcast');
      expect(unquote(s.INFOPLIST_FILE)).toBe('PocketQaBroadcast/Info.plist');
      expect(unquote(s.CODE_SIGN_ENTITLEMENTS)).toBe('PocketQaBroadcast/PocketQaBroadcast.entitlements');
      expect(s.APPLICATION_EXTENSION_API_ONLY).toBe('YES');
      expect(s.SKIP_INSTALL).toBe('YES');
      expect(unquote(s.IPHONEOS_DEPLOYMENT_TARGET)).toBe('16.4');
      expect(String(s.SWIFT_VERSION)).toBe('5.0');
      expect(unquote(s.TARGETED_DEVICE_FAMILY)).toBe('1');
      // Signing is never configured here: no team, no profile (a device build adds them).
      expect(s.DEVELOPMENT_TEAM).toBeUndefined();
      expect(s.PROVISIONING_PROFILE_SPECIFIER).toBeUndefined();
    }
  });

  it('compiles the sample handler and the shared pending store into the extension, nothing else', () => {
    const p = plugin.addBroadcastExtension(baseline(), opts);
    const [, t] = targetNamed(p, 'PocketQaBroadcast')!;
    const [sources] = phasesOf(p, t, 'PBXSourcesBuildPhase');
    expect(fileNamesIn(p, sources).sort()).toEqual(['BroadcastShared.swift', 'SampleHandler.swift']);
    expect(phasesOf(p, t, 'PBXFrameworksBuildPhase')).toHaveLength(1);
    expect(phasesOf(p, t, 'PBXResourcesBuildPhase')).toHaveLength(1);
  });

  it('embeds the .appex into the app (PlugIns) and makes the app depend on it', () => {
    const p = plugin.addBroadcastExtension(baseline(), opts);
    const [extId] = targetNamed(p, 'PocketQaBroadcast')!;
    const [, app] = targetNamed(p, 'PocketQA')!;
    const embeds = phasesOf(p, app, 'PBXCopyFilesBuildPhase');
    expect(embeds).toHaveLength(1);
    expect(unquote(embeds[0].name)).toBe('Embed Foundation Extensions');
    expect(String(embeds[0].dstSubfolderSpec)).toBe('13');
    expect(fileNamesIn(p, embeds[0])).toEqual(['PocketQaBroadcast.appex']);
    const deps = app.dependencies.map((d: Obj) => section(p, 'PBXTargetDependency')[d.value]);
    expect(deps.map((d: Obj) => d.target)).toContain(extId);
  });

  it('lists the target in the project and puts its files in a PocketQaBroadcast group', () => {
    const p = plugin.addBroadcastExtension(baseline(), opts);
    const [extId] = targetNamed(p, 'PocketQaBroadcast')!;
    const [, proj] = entries(p, 'PBXProject')[0]!;
    expect(proj.targets.map((t: Obj) => t.value)).toContain(extId);
    const group = entries(p, 'PBXGroup').find(([, g]) => unquote(g.path) === 'PocketQaBroadcast' || unquote(g.name) === 'PocketQaBroadcast');
    expect(group).toBeDefined();
    const main = section(p, 'PBXGroup')[proj.mainGroup];
    expect(main.children.map((c: Obj) => c.value)).toContain(group![0]);
  });

  it('is idempotent: running prebuild twice keeps exactly one extension target and one embed phase', () => {
    const p = plugin.addBroadcastExtension(plugin.addBroadcastExtension(baseline(), opts), opts);
    expect(entries(p, 'PBXNativeTarget').filter(([, t]) => unquote(t.name) === 'PocketQaBroadcast')).toHaveLength(1);
    const [, app] = targetNamed(p, 'PocketQA')!;
    expect(phasesOf(p, app, 'PBXCopyFilesBuildPhase')).toHaveLength(1);
  });

  it('the result is a project Xcode can parse back (writeSync round trip)', () => {
    const out = plugin.addBroadcastExtension(baseline(), opts).writeSync();
    const again = xcode.project(FIXTURE);
    again.hash = require('xcode/lib/parser/pbxproj').parse(out); // eslint-disable-line @typescript-eslint/no-require-imports
    expect(targetNamed(again, 'PocketQaBroadcast')).toBeDefined();
  });
});

describe('withBroadcastExtension: app group and Info.plist', () => {
  it('reads the App Group from app.json (single source) and refuses to run without it', () => {
    expect(plugin.appGroupOf({ ios: { entitlements: { 'com.apple.security.application-groups': [GROUP] } } })).toBe(GROUP);
    expect(() => plugin.appGroupOf({ ios: {} })).toThrow(/App Group/);
  });

  it('app.json declares the plugin and the App Group entitlement for the app', () => {
    expect(appJson.plugins).toContain('./plugins/withBroadcastExtension');
    expect(appJson.ios.entitlements['com.apple.security.application-groups']).toEqual([GROUP]);
    expect(plugin.appGroupOf(appJson)).toBe(GROUP);
  });

  it('tells the app module its group and extension id through Info.plist (no hard-coded ids in Swift)', () => {
    const info = plugin.setAppInfoPlist({ CFBundleName: 'Pocket QA' }, opts);
    expect(info.PocketQaAppGroup).toBe(GROUP);
    expect(info.PocketQaBroadcastExtension).toBe('com.reshareai.pocketqa.Broadcast');
    expect(info.CFBundleName).toBe('Pocket QA');
  });

  it('copies exactly the extension sources into ios/PocketQaBroadcast', () => {
    const files = plugin.extensionFiles().map((f: { dest: string }) => f.dest).sort();
    expect(files).toEqual(['BroadcastShared.swift', 'Info.plist', 'PocketQaBroadcast.entitlements', 'SampleHandler.swift']);
    for (const f of plugin.extensionFiles()) expect(fs.existsSync(f.src)).toBe(true);
  });
});

describe('broadcast extension sources (modules/screen-capture/ios-extension)', () => {
  const ext = (f: string) => fs.readFileSync(path.join(MODULE_DIR, 'ios-extension', f), 'utf8');

  it('Info.plist declares a sample-buffer broadcast upload extension with SampleHandler as principal class', () => {
    const info = plist.parse(ext('Info.plist'));
    expect(info.NSExtension.NSExtensionPointIdentifier).toBe('com.apple.broadcast-services-upload');
    expect(info.NSExtension.NSExtensionPrincipalClass).toBe('$(PRODUCT_MODULE_NAME).SampleHandler');
    expect(info.NSExtension.NSExtensionAttributes.RPBroadcastProcessMode).toBe('RPBroadcastProcessModeSampleBuffer');
    expect(info.CFBundleIdentifier).toBe('$(PRODUCT_BUNDLE_IDENTIFIER)');
    expect(info.CFBundlePackageType).toBe('$(PRODUCT_BUNDLE_PACKAGE_TYPE)');
    expect(info.PocketQaAppGroup).toBe(GROUP);
  });

  it('the extension has the same App Group as the app, and nothing else', () => {
    const ent = plist.parse(ext('PocketQaBroadcast.entitlements'));
    expect(ent).toEqual({ 'com.apple.security.application-groups': [GROUP] });
    expect(() => plugin.checkExtensionGroup(ext('PocketQaBroadcast.entitlements'), ext('Info.plist'), GROUP)).not.toThrow();
    expect(() => plugin.checkExtensionGroup(ext('PocketQaBroadcast.entitlements'), ext('Info.plist'), 'group.other')).toThrow(/App Group/);
  });

  it('records the microphone only (never app audio), with no network or camera code (N11)', () => {
    const src = ext('SampleHandler.swift');
    expect(src).toMatch(/class SampleHandler: RPBroadcastSampleHandler/);
    expect(src).toMatch(/case \.audioMic:/);
    expect(src).toMatch(/case \.audioApp:\s*\n\s*\/\/[^\n]*\n\s*break/);
    expect(src).toMatch(/finishBroadcastWithError/);
    for (const banned of [/URLSession/, /NWConnection/, /import Network/, /CFStream/, /socket\(/, /AVCaptureDevice/, /URLRequest/]) {
      expect(src).not.toMatch(banned);
      expect(fs.readFileSync(path.join(MODULE_DIR, 'ios/BroadcastShared.swift'), 'utf8')).not.toMatch(banned);
    }
  });
});

describe('expo module config', () => {
  it('registers the Swift module for iOS next to the Android one', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, 'expo-module.config.json'), 'utf8'));
    expect(cfg.platforms).toEqual(expect.arrayContaining(['android', 'apple']));
    expect(cfg.apple.modules).toEqual(['ScreenCaptureModule']);
    expect(cfg.android.modules).toEqual(['expo.modules.pocketqascreencapture.ScreenCaptureModule']);
  });
});
