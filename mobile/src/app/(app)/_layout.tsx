import { Stack } from 'expo-router';

/** Stack for the signed-in area. Just the placeholder home for now; the real
 *  rider/driver screens (tabs, maps, etc.) get added here in later build steps. */
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
