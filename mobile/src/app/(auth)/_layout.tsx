import { Stack } from 'expo-router';

/** Stack for the logged-out auth flow (welcome → phone → otp → profile). */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
