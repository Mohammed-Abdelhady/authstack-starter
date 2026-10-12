# @app/device-key

An ES256 (P-256) signing key that lives in the phone's secure hardware, behind the `DeviceKeyPort`
of `@app/native-auth`. The sign-in engine uses it to sign the proof that goes with a code exchange,
a refresh and a revoke, so a refresh token that leaves the phone cannot be used without the phone.

The package has two halves. The native half is an Expo module, `AppDeviceKey`, in Swift and Kotlin.
The TypeScript half turns that module into the port. It imports no native module: the shell that
owns `expo` loads `AppDeviceKey` and hands it in, the same rule `@app/native-adapters` follows.

## What the key guarantees

- The private key is generated inside the Secure Enclave on iOS and inside the Android Keystore on
  Android. No API returns it, and this package never holds it.
- The key is not synced and not part of a backup. A copy of the app's data on another device has no
  key.
- Signing needs no user presence. A refresh in the background does not prompt, so the port never
  answers `cancelled`.
- Each client id, environment and protection choice has its own key. Two apps, or a staging and a
  production build of one app, never share one.
- Under `hardwareOnly` the module never makes a software key. A device without secure hardware gets
  a failure, not a weaker key.

## What it does not guarantee

- Code running inside the app can ask the key to sign. The key protects a token that leaves the
  phone. It does not protect against a compromised app, an injected library or a debugger attached
  to the process.
- It is not attestation. The server sees a public key and cannot tell from it that the key is in
  hardware.
- It does not check that the point it exports is on the curve. The server verifies every signature.
- A software key (`softwareAllowed` on a device with no secure hardware) has none of the hardware
  properties. It exists so a simulator or emulator can run the bound flow.

## Using it

```ts
import { createDeviceKey, KEY_PROTECTION, NATIVE_MODULE_NAME } from '@app/device-key';
import type { DeviceKeyNativeApi } from '@app/device-key';
import { requireNativeModule } from 'expo';

const deviceKey = createDeviceKey(requireNativeModule<DeviceKeyNativeApi>(NATIVE_MODULE_NAME), {
  clientId: configuration.clientId,
  environment: configuration.environment,
  protection: KEY_PROTECTION.HARDWARE_ONLY,
});

const readiness = await deviceKey.prepare();
const engine = createAuthEngine(configuration, {
  ...ports,
  makeTransport,
  ...(readiness.kind === 'noSecureHardware' ? {} : { deviceKey }),
});
```

Build one per app start. Calls run one at a time, so two first uses create one key between them.

`protection` has no default.

| Value             | On a device with secure hardware | On a device without               |
| ----------------- | -------------------------------- | --------------------------------- |
| `hardwareOnly`    | Hardware key                     | No key. `prepare()` says so       |
| `softwareAllowed` | Hardware key                     | Software key, under its own alias |

Use `softwareAllowed` for development builds only. The two choices use different aliases, so a
software key made during development can never answer for a `hardwareOnly` build.

### No secure hardware

The module does not fall back to a software key by itself. A silent fallback would let the app and
the server believe a session is bound to hardware when it is bound to a file. The choice belongs to
the shell and is visible in two places:

- `protection` decides whether a software key may exist at all.
- `prepare()` answers `noSecureHardware`. The shell then leaves `deviceKey` out of the engine, and
  the session is an ordinary unbound one. If the server requires binding, sign-in is refused with
  `deviceBindingRequired`, which is the honest result for that device.

Through the port alone, `noSecureHardware` reads as `unavailable`, because the port has no other
word for it. An engine given a key that can never exist cannot sign in, so call `prepare()` first.

## The port's answers

| Situation                                                                | `publicKey()`                       | `sign()`         |
| ------------------------------------------------------------------------ | ----------------------------------- | ---------------- |
| Key exists                                                               | `success`                           | `success`        |
| No key, no marker (first use, or a fresh install)                        | creates the key, `success`          | `keyInvalidated` |
| No key, marker present (the system dropped a key this app made)          | `keyInvalidated` once, then creates | `keyInvalidated` |
| The system refuses to use the key again                                  | `keyInvalidated`, key removed       | same             |
| Keystore or keychain out of reach, device not unlocked since it started  | `unavailable`                       | `unavailable`    |
| No secure hardware under `hardwareOnly`                                  | `unavailable`                       | `keyInvalidated` |
| A failure the module does not recognise                                  | `unavailable`                       | `unavailable`    |
| The platform returned something that is not a key or not a DER signature | `unavailable`                       | `unavailable`    |
| A prompt was cancelled                                                   | cannot happen                       | cannot happen    |

`sign()` never creates a key. The engine always reads the public key first, so a missing key at
signing time means it disappeared in between.

An unknown failure is `unavailable` on purpose. The engine keeps the session on `unavailable` and
drops it on `keyInvalidated`, so a wrong guess of `keyInvalidated` would sign a person out for a
keystore that was only busy.

After `keyInvalidated` the dead key and its marker are gone, so the next `publicKey()` creates a new
key. The engine never loops: it asks for sign-in, and that sign-in binds the new key.

The native module rejects with one of five codes, exported as `NATIVE_ERROR_CODE`.

| Code                           | Meaning                                    | Port             |
| ------------------------------ | ------------------------------------------ | ---------------- |
| `ERR_DEVICE_KEY_UNAVAILABLE`   | Out of reach for now                       | `unavailable`    |
| `ERR_DEVICE_KEY_NO_HARDWARE`   | No secure hardware, and software not asked | `unavailable`    |
| `ERR_DEVICE_KEY_NOT_FOUND`     | Asked to sign with a key that is not there | `keyInvalidated` |
| `ERR_DEVICE_KEY_INVALIDATED`   | The system will not use this key again     | `keyInvalidated` |
| `ERR_DEVICE_KEY_INVALID_ALIAS` | An alias this package would never produce  | `unavailable`    |

## Lifecycle

- **Create** on the first `publicKey()` or `prepare()`.
- **Read** on every later one. The public key is read from the system each time and not cached.
- **Delete** with `deviceKey.delete()`. Do not call it at sign-out. The engine signs the revoke with
  this key, and that request can still be in flight after `signOut()` resolves. A later sign-in
  also signs a quiet revoke of an older session with it. The key belongs to the app and its
  environment, not to one session, and the port the engine sees has no delete. Use `delete()` for
  "erase this app's data" and as the way out for a key that only ever answers `unavailable`.
  After a delete, a session bound to the old key needs sign-in.

The marker is an empty file per alias. The module writes it when it hands out a key and removes it
on delete. It is the only way to tell "the system dropped my key" from "I never had one".

| Event                                 | iOS                                                                                                  | Android                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| App restart, device restart           | Same key. Unreadable until the first unlock after a restart: `unavailable`                           | Same key                                                                     |
| Uninstall and reinstall on one device | The keychain item survives, the marker does not. The key is picked up again and a new marker written | The key is deleted with the app. A new key on first use                      |
| Reinstall with app data restored      | Same as above                                                                                        | If Auto Backup brings the marker back: `keyInvalidated` once, then a new key |
| Restore or transfer to another device | The key stays behind, the marker travels: `keyInvalidated` once, then a new key                      | Same, when backup is on. With backup off: a new key on first use             |
| Biometric or passcode change          | No effect. The key has no user presence rule                                                         | No effect, for the same reason                                               |
| "Clear storage" in system settings    | Not offered                                                                                          | Key and marker both removed. A new key on first use                          |

A restored marker costs one `keyInvalidated`. To keep it from landing in the middle of a sign-in,
call `prepare()` at app start, before the engine restores: it reports the lost key once and the next
call creates a new one. The engine reaches the right state either way, because it compares the key's
thumbprint with the one stored in the session.

## Platform differences

|                      | iOS                                                                                  | Android                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Where the key lives  | Secure Enclave (`kSecAttrTokenIDSecureEnclave`)                                      | StrongBox when the device has it, otherwise the trusted execution environment                          |
| Access               | After first unlock, this device only. Access control `privateKeyUsage`, nothing else | `PURPOSE_SIGN`, SHA-256, `secp256r1`, user authentication not required                                 |
| Public key export    | X9.63 point, 65 bytes                                                                | DER SubjectPublicKeyInfo of the key's certificate, 91 bytes                                            |
| Signature            | DER, from `SecKeyCreateSignature` with `ecdsaSignatureMessageX962SHA256`             | DER, from `Signature` with `SHA256withECDSA`                                                           |
| How hardware is told | `SecureEnclave.isAvailable` before, and the key's token id after                     | `KeyInfo` after generation. A software key is deleted before anything is returned                      |
| Reported protection  | `secureEnclave` or `software`                                                        | `strongBox`, `trustedEnvironment` or `software`. Before API 31 StrongBox reads as `trustedEnvironment` |
| Marker               | `Application Support/app-device-key/<alias>.marker`                                  | `files/app-device-key/<alias>.marker`                                                                  |

Both platforms hand their answers to TypeScript as base64 text. The DER signature becomes the raw
64-byte `r || s` the engine expects, with each half exactly 32 bytes. The public key becomes a JWK
with `x` and `y` of exactly 32 bytes, 43 characters each. One implementation serves both platforms
and is tested in Node against `node:crypto`.

The alias is `devicekey.<hw|sw>.<client id>.<environment>`. Every character outside letters, digits
and `-` is escaped as `_` and four hex digits, including the separator, so different settings never
join to the same name. An alias over 200 characters is refused when the key is built.

## Limits

- The engine gives each port call five seconds. StrongBox is the slowest hardware here, and a first
  key generation on it has not been timed.
- Calls run one at a time. A native call that never settles holds up the ones behind it.
- A key that fails for a reason the module does not recognise stays `unavailable`, and the session
  stays signed in with requests failing. `delete()` is the way out.
- iOS has no confirmed error for "the Secure Enclave rejected this key". `errSecAuthFailed` is read
  as invalidated and everything else as unavailable.
- On Android the keystore's `UnrecoverableKeyException` can mean busy or gone. It is read as
  unavailable.
- The Kotlin code reads `KeyInfo.isInsideSecureHardware` below API 31, which newer SDKs mark
  deprecated. It is the only way to ask on those versions.
- The Swift code has compiled and run on an iOS 27 simulator only, in the Expo app and in the
  bare app, where the key reported `secureEnclave`. It has not run on a phone. The Kotlin code
  has not been compiled or run.

## Tests

```sh
pnpm --filter @app/device-key run lint
pnpm --filter @app/device-key run typecheck
pnpm --filter @app/device-key run test
```

`@app/device-key/testing` exports `FakeDeviceKeyNative`, a stand-in for the native module with the
same six functions, failure injection and a marker store. It imports nothing from Node, so a shell
test can use it with `cannedKeySource()`, whose signatures are well formed and not valid for the
data. This package's own tests give the fake real P-256 keys from `node:crypto` and verify every
signature and public key with `node:crypto`.
