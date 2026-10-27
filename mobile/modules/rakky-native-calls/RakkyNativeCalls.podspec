Pod::Spec.new do |s|
  s.name = 'RakkyNativeCalls'
  s.version = '1.0.0'
  s.summary = 'Native incoming trip-call lifecycle'
  s.description = 'PushKit reporting, bounded native call watchdog, and Expo bridge.'
  s.license = { :type => 'MIT' }
  s.author = 'Rakky Ride'
  s.homepage = 'https://rackyride.com'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'RNCallKeep'
  s.source_files = 'ios/**/*.{h,m,swift}'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
