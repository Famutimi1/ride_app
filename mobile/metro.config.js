const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// Metro must have CSS support enabled for the web bundler to process
// `global.css` through NativeWind's Tailwind transformer.
const config = getDefaultConfig(__dirname, { isCSSEnabled: true });

module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
