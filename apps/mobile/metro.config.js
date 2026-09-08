// Expo SDK 57 enables its native fetch implementation unless this flag is set
// while Metro evaluates the bundle. Keep the React Native implementation for
// every bundle, including local or emergency OTA commands that omit an EAS
// environment selection. The native request queue is unsafe for the app's
// frequent AbortController cancellations.
process.env.EXPO_PUBLIC_USE_RN_FETCH = '1';

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  /(^|[/\\])\._[^/\\]*$/,
  /(^|[/\\])\.__[^/\\]*$/,
];

module.exports = config;
