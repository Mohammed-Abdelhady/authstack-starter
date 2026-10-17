const {
  configureNativeSignIn,
  readNativeBuildSettings,
} = require('@app/native-adapters/build-config');

module.exports = ({ config }) => {
  const configured = configureNativeSignIn(config, readNativeBuildSettings(process.env));
  return {
    ...configured,
    plugins: [
      './plugins/with-google-modules', // feature:google
      ...(configured.plugins ?? []),
    ],
  };
};
