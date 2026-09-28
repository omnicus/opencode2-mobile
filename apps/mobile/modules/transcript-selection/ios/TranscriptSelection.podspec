Pod::Spec.new do |s|
  s.name = 'TranscriptSelection'
  s.version = '1.0.0'
  s.summary = 'Native selectable transcript text'
  s.description = 'Read-only attributed UITextView with native range selection.'
  s.license = { :type => 'MIT' }
  s.author = 'Omnicus'
  s.homepage = 'https://github.com/omnicus/opencode2-mobile'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => 'https://github.com/omnicus/opencode2-mobile.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.swift_version = '5.9'
  s.source_files = '**/*.{h,m,mm,swift}'
end
