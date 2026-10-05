// iPhone screen + voice recording of OTHER apps (docs/plans/native-screen-voice-recording.md,
// Design: iOS). `expo prebuild --platform ios` regenerates ios/ from scratch, so the Broadcast
// Upload Extension target is added here, reproducibly, never by hand in Xcode:
//  - ios/PocketQaBroadcast/: SampleHandler.swift + Info.plist + entitlements from
//    modules/screen-capture/ios-extension, and BroadcastShared.swift from modules/screen-capture/ios
//    (the on-disk handoff, compiled into BOTH the app module and the extension so they never drift);
//  - an app-extension target `PocketQaBroadcast` (<app id>.Broadcast) embedded into the app's PlugIns;
//  - the app's Info.plist learns the App Group and the extension id (the Swift code reads them there).
// The App Group has ONE source: app.json `ios.entitlements` (`com.apple.security.application-groups`).
// The extension's own entitlements/Info.plist are checked against it so a mismatch fails prebuild,
// not a device run. Signing (team, profiles) is deliberately untouched: a device build needs a team
// whose provisioning profiles include the group, for both targets.
const { withDangerousMod, withInfoPlist, withXcodeProject } = require('expo/config-plugins');
const plist = require('@expo/plist').default;
const fs = require('fs');
const path = require('path');

const EXT = 'PocketQaBroadcast';
const GROUP_KEY = 'com.apple.security.application-groups';
const extensionBundleId = (appBundleId) => `${appBundleId}.Broadcast`;

function moduleDir() {
  return path.dirname(require.resolve('pocketqa-screen-capture/package.json'));
}

/** Files copied into ios/PocketQaBroadcast (dest names are what the Xcode target references). */
function extensionFiles() {
  const dir = moduleDir();
  return [
    { src: path.join(dir, 'ios-extension/SampleHandler.swift'), dest: 'SampleHandler.swift' },
    { src: path.join(dir, 'ios/BroadcastShared.swift'), dest: 'BroadcastShared.swift' },
    { src: path.join(dir, 'ios-extension/Info.plist'), dest: 'Info.plist' },
    { src: path.join(dir, 'ios-extension/PocketQaBroadcast.entitlements'), dest: `${EXT}.entitlements` },
  ];
}

function appGroupOf(config) {
  const groups = config.ios?.entitlements?.[GROUP_KEY];
  if (!Array.isArray(groups) || groups.length !== 1 || typeof groups[0] !== 'string') {
    throw new Error(`withBroadcastExtension: app.json must declare exactly one App Group in ios.entitlements["${GROUP_KEY}"]`);
  }
  return groups[0];
}

/** The extension must share the app's group, or the app never sees its recordings. */
function checkExtensionGroup(entitlementsXml, infoPlistXml, appGroup) {
  const ent = plist.parse(entitlementsXml);
  const info = plist.parse(infoPlistXml);
  const groups = ent[GROUP_KEY];
  if (!Array.isArray(groups) || groups.length !== 1 || groups[0] !== appGroup || info.PocketQaAppGroup !== appGroup) {
    throw new Error(`withBroadcastExtension: the extension's App Group must be exactly "${appGroup}" (entitlements and Info.plist PocketQaAppGroup)`);
  }
}

function setAppInfoPlist(info, { appGroup, appBundleId }) {
  return { ...info, PocketQaAppGroup: appGroup, PocketQaBroadcastExtension: extensionBundleId(appBundleId) };
}

const q = (s) => `"${s}"`;
const unquote = (s) => String(s).replace(/^"|"$/g, '');

/**
 * Adds the extension target to a parsed `xcode` project. Objects are written explicitly (the
 * `xcode` package's addTarget mis-wires app extensions); idempotent so a non-clean prebuild is safe.
 */
function addBroadcastExtension(project, { appBundleId, appTargetName, version = '0.1.0', buildNumber = '1', deploymentTarget = '16.4' }) {
  const objects = project.hash.project.objects;
  const sectionOf = (isa) => (objects[isa] = objects[isa] || {});
  const add = (isa, obj, comment) => {
    const id = project.generateUuid();
    sectionOf(isa)[id] = { isa, ...obj };
    if (comment) sectionOf(isa)[`${id}_comment`] = comment;
    return id;
  };
  const targets = sectionOf('PBXNativeTarget');
  const exists = Object.keys(targets).some((k) => !k.endsWith('_comment') && unquote(targets[k].name) === EXT);
  if (exists) return project;
  const appId = Object.keys(targets).find((k) => !k.endsWith('_comment') && unquote(targets[k].name) === appTargetName);
  if (!appId) throw new Error(`withBroadcastExtension: app target "${appTargetName}" not found`);
  const app = targets[appId];
  const projectId = project.hash.project.rootObject;
  const proj = objects.PBXProject[projectId];

  // Files: a PocketQaBroadcast group (path-relative), the Swift sources compiled into the target.
  const fileRef = (name, type) => add('PBXFileReference', { lastKnownFileType: type, path: q(name), sourceTree: q('<group>') }, name);
  const refs = {
    handler: fileRef('SampleHandler.swift', 'sourcecode.swift'),
    shared: fileRef('BroadcastShared.swift', 'sourcecode.swift'),
    info: fileRef('Info.plist', 'text.plist.xml'),
    ent: fileRef(`${EXT}.entitlements`, 'text.plist.entitlements'),
  };
  const child = (id, name) => ({ value: id, comment: name });
  const groupId = add(
    'PBXGroup',
    {
      children: [child(refs.handler, 'SampleHandler.swift'), child(refs.shared, 'BroadcastShared.swift'), child(refs.info, 'Info.plist'), child(refs.ent, `${EXT}.entitlements`)],
      path: EXT,
      sourceTree: q('<group>'),
    },
    EXT,
  );
  objects.PBXGroup[proj.mainGroup].children.push(child(groupId, EXT));

  const product = add('PBXFileReference', { explicitFileType: q('wrapper.app-extension'), includeInIndex: 0, path: `${EXT}.appex`, sourceTree: 'BUILT_PRODUCTS_DIR' }, `${EXT}.appex`);
  objects.PBXGroup[proj.productRefGroup].children.push(child(product, `${EXT}.appex`));

  const buildFile = (ref, name, phase, extra = {}) => ({ value: add('PBXBuildFile', { fileRef: ref, fileRef_comment: name, ...extra }, `${name} in ${phase}`), comment: `${name} in ${phase}` });
  const phase = (isa, name, files, extra = {}) => add(isa, { buildActionMask: 2147483647, files, runOnlyForDeploymentPostprocessing: 0, ...extra }, name);
  const sources = phase('PBXSourcesBuildPhase', 'Sources', [buildFile(refs.handler, 'SampleHandler.swift', 'Sources'), buildFile(refs.shared, 'BroadcastShared.swift', 'Sources')]);
  const frameworks = phase('PBXFrameworksBuildPhase', 'Frameworks', []);
  const resources = phase('PBXResourcesBuildPhase', 'Resources', []);

  const common = {
    APPLICATION_EXTENSION_API_ONLY: 'YES',
    CODE_SIGN_ENTITLEMENTS: q(`${EXT}/${EXT}.entitlements`),
    CURRENT_PROJECT_VERSION: q(buildNumber),
    GENERATE_INFOPLIST_FILE: 'NO',
    INFOPLIST_FILE: q(`${EXT}/Info.plist`),
    IPHONEOS_DEPLOYMENT_TARGET: deploymentTarget,
    LD_RUNPATH_SEARCH_PATHS: q('$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'),
    MARKETING_VERSION: q(version),
    PRODUCT_BUNDLE_IDENTIFIER: q(extensionBundleId(appBundleId)),
    PRODUCT_NAME: q('$(TARGET_NAME)'),
    SKIP_INSTALL: 'YES',
    SWIFT_VERSION: '5.0',
    TARGETED_DEVICE_FAMILY: q('1'),
  };
  const config = (name, extra) => ({ value: add('XCBuildConfiguration', { buildSettings: { ...common, ...extra }, name }, name), comment: name });
  const configList = add(
    'XCConfigurationList',
    {
      buildConfigurations: [
        config('Debug', { DEBUG_INFORMATION_FORMAT: 'dwarf', SWIFT_ACTIVE_COMPILATION_CONDITIONS: 'DEBUG', SWIFT_OPTIMIZATION_LEVEL: q('-Onone') }),
        config('Release', { DEBUG_INFORMATION_FORMAT: q('dwarf-with-dsym'), SWIFT_COMPILATION_MODE: 'wholemodule' }),
      ],
      defaultConfigurationIsVisible: 0,
      defaultConfigurationName: 'Release',
    },
    `Build configuration list for PBXNativeTarget "${EXT}"`,
  );

  const extId = add(
    'PBXNativeTarget',
    {
      buildConfigurationList: configList,
      buildConfigurationList_comment: `Build configuration list for PBXNativeTarget "${EXT}"`,
      buildPhases: [child(sources, 'Sources'), child(frameworks, 'Frameworks'), child(resources, 'Resources')],
      buildRules: [],
      dependencies: [],
      name: EXT,
      productName: EXT,
      productReference: product,
      productReference_comment: `${EXT}.appex`,
      productType: q('com.apple.product-type.app-extension'),
    },
    EXT,
  );
  proj.targets.push(child(extId, EXT));

  // The app builds the extension first and embeds the .appex into PlugIns (dstSubfolderSpec 13).
  const proxy = add('PBXContainerItemProxy', { containerPortal: projectId, containerPortal_comment: 'Project object', proxyType: 1, remoteGlobalIDString: extId, remoteInfo: EXT }, 'PBXContainerItemProxy');
  const dep = add('PBXTargetDependency', { target: extId, target_comment: EXT, targetProxy: proxy, targetProxy_comment: 'PBXContainerItemProxy' }, 'PBXTargetDependency');
  app.dependencies.push(child(dep, 'PBXTargetDependency'));
  const embed = phase('PBXCopyFilesBuildPhase', 'Embed Foundation Extensions', [buildFile(product, `${EXT}.appex`, 'Embed Foundation Extensions', { settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] } })], {
    dstPath: q(''),
    dstSubfolderSpec: 13,
    name: q('Embed Foundation Extensions'),
  });
  app.buildPhases.push(child(embed, 'Embed Foundation Extensions'));
  return project;
}

function withBroadcastExtension(config) {
  const appGroup = appGroupOf(config);
  const appBundleId = config.ios?.bundleIdentifier;
  if (!appBundleId) throw new Error('withBroadcastExtension: app.json needs ios.bundleIdentifier');
  const opts = { appGroup, appBundleId, version: config.version, buildNumber: config.ios?.buildNumber };

  config = withInfoPlist(config, (c) => {
    c.modResults = setAppInfoPlist(c.modResults, opts);
    return c;
  });
  config = withDangerousMod(config, [
    'ios',
    async (c) => {
      const files = extensionFiles();
      const read = (dest) => fs.readFileSync(files.find((f) => f.dest === dest).src, 'utf8');
      checkExtensionGroup(read(`${EXT}.entitlements`), read('Info.plist'), appGroup);
      const dir = path.join(c.modRequest.platformProjectRoot, EXT);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of files) fs.copyFileSync(f.src, path.join(dir, f.dest));
      return c;
    },
  ]);
  return withXcodeProject(config, (c) => {
    addBroadcastExtension(c.modResults, { ...opts, appTargetName: c.modRequest.projectName });
    return c;
  });
}

module.exports = withBroadcastExtension;
module.exports.addBroadcastExtension = addBroadcastExtension;
module.exports.appGroupOf = appGroupOf;
module.exports.checkExtensionGroup = checkExtensionGroup;
module.exports.extensionFiles = extensionFiles;
module.exports.setAppInfoPlist = setAppInfoPlist;
