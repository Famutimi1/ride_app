import configPlugins from 'expo/config-plugins.js';
import type { ConfigPlugin } from 'expo/config-plugins';

const { withProjectBuildGradle } = configPlugins;
const marker = '// Rakky Ride: use the project NDK for native libraries.';

/** Keep native libraries on Expo's NDK instead of AGP's separate default. */
const withAndroidNdkVersion: ConfigPlugin = (config) =>
  withProjectBuildGradle(config, (value) => {
    if (value.modResults.language !== 'groovy') {
      throw new Error('The Android NDK configuration requires a Groovy build.gradle.');
    }

    if (!value.modResults.contents.includes(marker)) {
      value.modResults.contents += `

${marker}
subprojects { subproject ->
  subproject.plugins.withId('com.android.library') {
    subproject.android.ndkVersion = rootProject.ext.ndkVersion
  }
}
`;
    }
    return value;
  });

export default withAndroidNdkVersion;
