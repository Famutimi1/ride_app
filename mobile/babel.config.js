module.exports = function (api) {
  api.cache(true);

  return {
    presets: [
      // nativewind/babel also injects react-native-worklets/plugin, so disable
      // the preset's duplicate injection.
      ['babel-preset-expo', { jsxImportSource: 'nativewind', worklets: false }],
      'nativewind/babel',
    ],
  };
};
