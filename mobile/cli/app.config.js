const {
  configureNativeSignIn,
  readNativeBuildSettings,
} = require('@app/native-adapters/build-config');

module.exports = ({ config }) =>
  configureNativeSignIn(config, readNativeBuildSettings(process.env));
