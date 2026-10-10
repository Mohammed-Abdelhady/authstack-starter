# Config file

`--config` reads a JSON object with these keys, all optional:

```json
{
  "targets": ["web"],
  "database": "mongodb",
  "features": ["email-password", "google"],
  "locales": ["en", "ar"],
  "docker": true,
  "production": true,
  "preset": "standard",
  "rules": "strict"
}
```

`rules` takes `strict` or `standard`, spelled exactly as the flag takes them.
Any other value stops the run with exit code 2.

`database` takes `mongodb` or `postgres`. A file without the key gives a MongoDB
project, as it did before there was a choice. An unknown name, or more than one
name, stops the run with exit code 2.

A flag overrides the config file, the config file overrides the preset, and the
preset overrides the manifest defaults. A UTF-8 byte order mark is accepted and
stripped.

## Mobile app

`--targets web,native-expo`, or `"targets": ["web", "native-expo"]` in the config
file, adds the Expo app in `mobile/expo` with the packages it needs. It has been
built and run on an iOS simulator. Android has not been built or run. The bare
React Native app, `native-cli`, is not offered yet and is refused with exit
code 2. `native-expo` without `web` keeps the web app, because the mobile app
signs in on its pages. The `everything` preset includes `native-expo`.

Four values name the app. Each has a flag, a key under `mobile` in the config
file and a prompt. They are asked only when a mobile app is chosen, and giving
one without a mobile app is an error.

| Flag              | Config key      | Rule                                                                                                                       | Default for `my-app` |
| ----------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `--mobile-name`   | `mobile.name`   | 1 to 30 characters on one line, no space at either end                                                                     | `My App`             |
| `--mobile-slug`   | `mobile.slug`   | Lower case letters, digits, hyphens and underscores, starting with a letter or digit, at most 64 characters                | `my-app`             |
| `--mobile-app-id` | `mobile.appId`  | Two or more parts joined by dots, letters and digits only, each part starting with a letter, no Java keyword               | `com.example.myapp`  |
| `--mobile-scheme` | `mobile.scheme` | Lower case letters, digits, dots and hyphens, starting with a letter, not `http`, `https`, `file` or another system scheme | `com.example.myapp`  |

```json
{
  "targets": ["web", "native-expo"],
  "mobile": {
    "name": "Field Notes",
    "slug": "field-notes",
    "appId": "org.sample.notes",
    "scheme": "org.sample.notes"
  }
}
```

The application id is used for both the iOS bundle identifier and the Android
package. The scheme is the client id the server knows the app by, and sign-in
returns to `<scheme>://oauth/callback`. The values are written to
`mobile/expo/app.json`, which is the only place the app reads them from, and to
the example `AUTH_NATIVE_APPLICATIONS` line in `backend/.env.example`,
`.env.docker.example` and `backend/README.md`. The defaults start with
`com.example`, so replace them before a release.

The installer does not create the native iOS or Android project, sign a build
or start a simulator. Expo creates the native project the first time
`pnpm --filter @app/mobile-expo run ios` runs, which needs Xcode and CocoaPods.

Without `--yes` and without a terminal, name the clients with `--targets`, and
give all four values when a mobile app is among them.
