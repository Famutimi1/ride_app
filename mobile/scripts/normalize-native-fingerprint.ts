import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// masked-view 0.3.2's Gradle script removes this legacy package attribute
// during Android builds. Apply the same change before fingerprinting so a
// previously built local install matches a fresh install on EAS.
const packageRoot = resolve('node_modules/@react-native-masked-view/masked-view');
const manifestPath = resolve(packageRoot, 'android/src/main/AndroidManifest.xml');
if (existsSync(manifestPath)) {
  const gradle = readFileSync(resolve(packageRoot, 'android/build.gradle'), 'utf8');
  const manifest = readFileSync(manifestPath, 'utf8');
  const legacyPackage = 'package="org.reactnative.maskedview"';
  if (manifest.includes(legacyPackage)) {
    if (!gradle.includes('manifestOutFile.write(manifestContent)')
      || !gradle.includes('namespace = "org.reactnative.maskedview"')) {
      throw new Error('Review masked-view manifest normalization after its Gradle configuration changes.');
    }
    writeFileSync(manifestPath, manifest.replace(legacyPackage, ''));
    console.info('Normalized masked-view manifest before native fingerprinting.');
  }
}
