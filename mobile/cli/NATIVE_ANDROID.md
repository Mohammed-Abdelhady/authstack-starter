# Bare Android project setup

Generate `mobile/cli/android` with the React Native 0.86.3 Community CLI template
as described in [Native project setup](NATIVE_PROJECTS.md). Run commands from
the repository root with Node 22 active. The generated directory is ignored by
git. These steps produced an arm64 Debug APK with JDK 17 and SDK 36 on
macOS. Android app launch and sign-in have not been checked on a device.

Use JDK 17 and Android SDK Platform 36, Build Tools 36.0.0, and NDK
27.1.12297006. Those versions come from the installed React Native 0.86.3
version catalog. Accept the Android SDK licenses before building. The [Expo SDK
57 bare template](https://github.com/expo/expo/tree/sdk-57/templates/expo-template-bare-minimum/android)
shows the matching Android integration.

## Gradle settings

Replace the generated `mobile/cli/android/settings.gradle` with the following.
Node resolves the plugins through their owning packages because pnpm does not
place `expo-modules-autolinking` directly in `mobile/cli/node_modules`.

```groovy
pluginManagement {
  def reactNativeGradlePlugin = new File(
    providers.exec {
      workingDir(rootDir)
      commandLine("node", "--print", "require.resolve('@react-native/gradle-plugin/package.json', { paths: [require.resolve('react-native/package.json')] })")
    }.standardOutput.asText.get().trim()
  ).getParentFile().absolutePath
  includeBuild(reactNativeGradlePlugin)

  def expoPluginsPath = new File(
    providers.exec {
      workingDir(rootDir)
      commandLine("node", "--print", "require.resolve('expo-modules-autolinking/package.json', { paths: [require.resolve('expo/package.json')] })")
    }.standardOutput.asText.get().trim(),
    "../android/expo-gradle-plugin"
  ).absolutePath
  includeBuild(expoPluginsPath)
}

plugins {
  id("com.facebook.react.settings")
  id("expo-autolinking-settings")
}

extensions.configure(com.facebook.react.ReactSettingsExtension) { ex ->
  ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)
}
expoAutolinking.useExpoModules()
expoAutolinking.useExpoVersionCatalog()

rootProject.name = 'MobileCli'
include ':app'
includeBuild(expoAutolinking.reactNativeGradlePlugin)
```

The React Native plugin appears once in `pluginManagement` and once for the
root build, as in the Expo SDK 57 template. Keep the generated
`autolinkLibrariesWithApp()` call in `android/app/build.gradle`. Add
these package paths inside its existing `react` block. The template's flat
`node_modules` paths do not resolve Codegen or Hermes under pnpm:

```groovy
react {
  codegenDir = new File(["node", "--print", "require.resolve('@react-native/codegen/package.json', { paths: [require.resolve('react-native/package.json')] })"].execute(null, rootDir).text.trim()).getParentFile().getAbsoluteFile()
  hermesCommand = new File(["node", "--print", "require.resolve('hermes-compiler/package.json', { paths: [require.resolve('react-native/package.json')] })"].execute(null, rootDir).text.trim()).getParentFile().getAbsolutePath() + "/hermesc/%OS-BIN%/hermesc"
  autolinkLibrariesWithApp()
}
```

Keep the bare shell's React Native CLI and `index.js` entry. Expo autolinking
discovers installed modules, including the device key module at
`mobile/device-key`. Do not register those packages manually.

In `mobile/cli/android/build.gradle`, keep the template's SDK version block
and add Expo's root plugin before React Native's:

```groovy
apply plugin: 'expo-root-project'
apply plugin: 'com.facebook.react.rootproject'
```

## App package and React host

Set both `namespace` and `defaultConfig.applicationId` in
`mobile/cli/android/app/build.gradle` to `com.example.mobilecli`. Keep the
existing React Native bundling configuration. The bare shell uses `index.js`
and registers the `MobileCli` component; it does not use Expo's virtual Metro
entry.

Move the generated `MainApplication.kt` and `MainActivity.kt` from
`android/app/src/main/java/com/mobilecli/` to
`android/app/src/main/java/com/example/mobilecli/`. Change both package
statements to `com.example.mobilecli`. In `MainApplication.kt`, use Expo's
host and dispatch the application lifecycle:

```kotlin
package com.example.mobilecli

import android.app.Application
import android.content.res.Configuration
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList = PackageList(this).packages,
      jsMainModulePath = "index"
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
```

The explicit `index` path is necessary because `ExpoReactHostFactory` defaults
to `.expo/.virtual-metro-entry`. Keep the template's `MobileCli` component
name in `MainActivity.kt` and wrap its delegate:

```kotlin
package com.example.mobilecli

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "MobileCli"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    ReactActivityDelegateWrapper(
      this,
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
    )
}
```

These host, wrapper, and dispatcher signatures are present in the installed
`expo` 57.0.26 Android sources. The [Expo SDK 57 application](https://github.com/expo/expo/blob/sdk-57/templates/expo-template-bare-minimum/android/app/src/main/java/com/helloworld/MainApplication.kt)
and [activity](https://github.com/expo/expo/blob/sdk-57/templates/expo-template-bare-minimum/android/app/src/main/java/com/helloworld/MainActivity.kt)
show the same lifecycle wiring. Keep the bare shell's component name and entry
path when applying them.

## Callback manifest

In `mobile/cli/android/app/src/main/AndroidManifest.xml`, keep
`MainActivity` exported with `android:launchMode="singleTask"`. Add this
filter inside that activity to match `mobilecli://auth/callback`:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="mobilecli" android:host="auth" android:path="/callback" />
</intent-filter>
```

The package must match `mobile/cli/app.json`, which declares
`com.example.mobilecli` for Android.

## Compile and verify

From `mobile/cli/android`, run `./gradlew :app:assembleDebug` with Node 22,
JDK 17, and the Android SDK on the process PATH. Check the first Gradle error
if configuration or compilation fails. A plugin resolution failure calls for
checking Node's `require.resolve` output from `mobile/cli`; a missing SDK or
NDK error calls for checking the installed revision against the values above.
Check the resulting APK or merged manifest for package
`com.example.mobilecli` and the callback intent filter. Confirm that Expo
autolinking includes `mobile/device-key` without a manual package entry.

A successful debug compile establishes native compilation and manifest merge.
It does not bundle JavaScript or verify app launch, Expo module behavior,
OAuth provider registration, or callback delivery. Those require a device or
emulator run with the bare Metro server. Release bundling and signing require
separate checks.
