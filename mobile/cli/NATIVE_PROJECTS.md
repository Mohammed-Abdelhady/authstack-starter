# Native project setup

The bare app keeps no native project in the repository. Generate the React
Native 0.86.3 projects with the Community CLI 20.1.0, then make the edits
below. Run every command from the repository root with Node 22 active.

The iOS steps were followed on Xcode 27 with CocoaPods 1.17, and the app was
built and run on an iPhone 17 simulator with iOS 27 against a local server. The
native project those steps produce is ignored by git and not committed, so the
installer does not offer this app yet. The Android steps have never been built
or run.

```sh
pnpm --filter @app/mobile-cli exec rnc-cli init MobileCli --template @react-native-community/template@0.86.3 --directory /tmp/mobile-cli-native-0.86.3 --skip-install
cp -R /tmp/mobile-cli-native-0.86.3/ios mobile/cli/ios
cp -R /tmp/mobile-cli-native-0.86.3/android mobile/cli/android
```

Keep the generated native project files under `mobile/cli/ios` and
`mobile/cli/android`. Do not copy the generated package manifest or lockfile.

## iOS

### Project settings

In `mobile/cli/ios/MobileCli.xcodeproj/project.pbxproj`:

- Set every `PRODUCT_BUNDLE_IDENTIFIER` build setting to `com.example.mobilecli`.
- Set every `IPHONEOS_DEPLOYMENT_TARGET` build setting to `16.4`. The template
  writes 15.1, and the Expo modules refuse to link below 16.4.

### Podfile

In `mobile/cli/ios/Podfile`, require Expo's autolinking script before the app
target:

```ruby
require File.join(File.dirname(`node --print "require.resolve('expo/package.json')"`), "scripts/autolinking")
```

Replace `platform :ios, min_ios_version_supported` with:

```ruby
platform :ios, '16.4'
```

Call `use_expo_modules!` as the first line inside `target 'MobileCli' do`,
before `use_native_modules!`.

### Info.plist

In `mobile/cli/ios/MobileCli/Info.plist`:

Set `CFBundleDisplayName` to `Mobile CLI`, the `displayName` in
`mobile/cli/app.json`. The sign-in screen shows that name.

Add the URL type sign-in returns through:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>mobilecli</string>
    </array>
  </dict>
</array>
```

Add the scene configuration. An app built with the iOS 27 SDK does not launch
without one:

```xml
<key>UIApplicationSceneManifest</key>
<dict>
  <key>UIApplicationSupportsMultipleScenes</key>
  <false/>
  <key>UISceneConfigurations</key>
  <dict>
    <key>UIWindowSceneSessionRoleApplication</key>
    <array>
      <dict>
        <key>UISceneConfigurationName</key>
        <string>Default Configuration</string>
        <key>UISceneDelegateClassName</key>
        <string>EXExpoAppSceneDelegate</string>
      </dict>
    </array>
  </dict>
</dict>
```

<!-- feature:locale-ar:start -->

Declare the two languages the screens ship in:

```xml
<key>CFBundleLocalizations</key>
<array>
  <string>en</string>
  <string>ar</string>
</array>
```

<!-- feature:locale-ar:end -->

The template already sets `NSAllowsLocalNetworking` under
`NSAppTransportSecurity`. Keep it. The development build talks to
`http://localhost:5001`.

### App delegate

Replace the contents of `mobile/cli/ios/MobileCli/AppDelegate.swift`. The
template's delegate creates the window itself and knows nothing about Expo
modules. This one hands the window to Expo's scene delegate and starts React
Native through Expo's factory, which is what registers the Expo modules.

```swift
internal import Expo
import React
import ReactAppDependencyProvider
import UIKit

@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  let reactNativeFactoryModuleName = "MobileCli"

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // The scene delegate creates the window and starts React Native into it.
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
```

`internal import Expo` is deliberate. The file Expo generates imports the same
module that way, and a plain `import Expo` beside it does not compile.

### Pods

```sh
cd mobile/cli/ios
pod install
cd ../../..
```

The output lists `AppDeviceKey` beside the Expo pods. That is the device key
module from `mobile/device-key`, found through the app's dependencies.

### What the server needs

The bare app has its own client id and return address. They live in
`mobile/cli/src/constants.ts`. Set these in `backend/.env`:

- `AUTH_NATIVE_ENABLED=true`
- `AUTH_NATIVE_DPOP_NONCE_SECRET` with a random value of at least 32
  characters. `openssl rand -hex 32` makes one.
- `API_URL=http://localhost:5001`
- `AUTH_NATIVE_APPLICATIONS` with this JSON array, inside single quotes as
  `backend/.env.example` shows:

```text
[{"clientId":"native-app","displayName":"Mobile CLI","redirectUris":["mobilecli://auth/callback"]}]
```

To run the Expo app against the same server, put both applications in the one
JSON array.

A development build always talks to `http://localhost:5001`, so the backend
has to listen on port 5001. A release build talks to `PRODUCTION_API_ORIGIN` in
`mobile/cli/src/constants.ts`, which is a placeholder until you change it.

The web app must be running too, because sign-in happens on its pages, and
`CLIENT_URL` on the backend must be its address. You also need an account. The
seed script makes two.

### Run it on an iOS simulator

With MongoDB, the backend and the web app running:

```sh
# In one terminal, serve the JavaScript:
pnpm --filter @app/mobile-cli run start

# In another, build the app and open it on a simulator:
pnpm --filter @app/mobile-cli run ios
```

`run ios` opens Simulator.app before it builds, and stops if Xcode has none.
The same result by hand, which is how the app was checked:

```sh
cd mobile/cli/ios
xcodebuild -workspace MobileCli.xcworkspace -scheme MobileCli -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath build/derived build
xcrun simctl boot 'iPhone 17'
xcrun simctl install booted build/derived/Build/Products/Debug-iphonesimulator/MobileCli.app
xcrun simctl launch booted com.example.mobilecli
```

The first sign-in on a simulator shows a "Save Password?" sheet over the
consent page. Dismiss it, then choose Continue.

A development build prints one warning at start, "process.env.EXPO_OS is not
defined". The app uses React Native's Babel preset, which does not set that
value. Expo's modules fall back to React Native's own platform check.

## Android

Nothing in this section has been built or run.

In `mobile/cli/android/settings.gradle`, add the Expo Gradle plugin build to
`pluginManagement`, apply `expo-autolinking-settings`, and configure Expo
module discovery alongside React Native autolinking:

```groovy
pluginManagement {
  includeBuild("../node_modules/@react-native/gradle-plugin")
  includeBuild("../node_modules/expo-modules-autolinking/android/expo-gradle-plugin")
}
plugins {
  id("com.facebook.react.settings")
  id("expo-autolinking-settings")
}
extensions.configure(com.facebook.react.ReactSettingsExtension) { ex ->
  ex.autolinkLibrariesFromCommand()
}
extensions.configure(expo.modules.ExpoAutolinkingSettingsExtension) { ex ->
  ex.useExpoModules()
}
```

Merge those entries with the template's existing settings. Keep its existing
`includeBuild` for the React Native Gradle plugin only once.

In `mobile/cli/android/app/build.gradle`, set both `namespace` and
`applicationId` to `com.example.mobilecli`. Move the generated Kotlin source
files into `android/app/src/main/java/com/example/mobilecli/` and change their
package declarations to `com.example.mobilecli`.

In `mobile/cli/android/app/src/main/AndroidManifest.xml`, add this intent filter
to the generated `MainActivity` activity:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="mobilecli" android:host="auth" android:path="/callback" />
</intent-filter>
```

Expo autolinking discovers the installed Expo modules used by this shell:
`expo-secure-store`, `expo-web-browser`, `expo-crypto`, `expo-linking`,
`expo-file-system`, and the device key module in `mobile/device-key`. Do not
add manual native package registrations for them.
