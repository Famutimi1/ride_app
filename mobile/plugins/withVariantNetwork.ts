import configPlugins from 'expo/config-plugins.js';
import type { ConfigPlugin } from 'expo/config-plugins';

const { AndroidConfig, withAndroidManifest, withInfoPlist } = configPlugins;

/** Test builds may reach a Mac over HTTP; production keeps transport security. */
const withVariantNetwork: ConfigPlugin<{ testApp: boolean }> = (config, { testApp }) => {
  config = withAndroidManifest(config, value => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(value.modResults);
    application.$['android:usesCleartextTraffic'] = testApp ? 'true' : 'false';
    return value;
  });
  return withInfoPlist(config, value => {
    const transport = value.modResults.NSAppTransportSecurity;
    value.modResults.NSAppTransportSecurity = {
      ...(transport && typeof transport === 'object' && !Array.isArray(transport) ? transport : {}),
      NSAllowsArbitraryLoads: testApp,
      NSAllowsLocalNetworking: testApp,
    };
    if (testApp) value.modResults.NSLocalNetworkUsageDescription = 'Allow Rakky Ride Test to connect to your local development server.';
    return value;
  });
};

export default withVariantNetwork;
