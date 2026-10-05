require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# The app half of the iPhone recorder. BroadcastShared.swift is ALSO compiled into the broadcast
# extension target (copied there by apps/mobile/plugins/withBroadcastExtension.js). Tests/ is a
# macOS swiftc harness for BroadcastShared.swift and is not part of the pod.
Pod::Spec.new do |s|
  s.name           = 'PocketQaScreenCapture'
  s.version        = package['version']
  s.summary        = 'Pocket QA iPhone screen broadcast: picker, App Group handoff of finished clips'
  s.description    = s.summary
  s.license        = 'UNLICENSED'
  s.author         = 'Pocket QA'
  s.homepage       = 'https://github.com/reshareai/pocket-qa'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ReplayKit'

  s.source_files = '*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
