import { feedback } from '@/store/feedbackStore';
import { userErrorMessage } from '@/utils/userMessage';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { TextInput } from 'react-native';

import { useAuthStore } from '@/store/authStore';
import { OtpVerificationView } from './OtpVerificationView';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;

/** One input retains paste, backspace and OS SMS autofill across all six boxes. */
export function OtpScreen() {
  const router = useRouter();
  const phone = useAuthStore(state => state.pending?.phone);
  const intent = useAuthStore(state => state.pending?.intent);
  const verifyOtp = useAuthStore(state => state.verifyOtp);
  const requestOtp = useAuthStore(state => state.requestOtp);
  const inputRef = useRef<TextInput>(null);
  const inFlight = useRef(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const changeNumber = () => {
    if (!inFlight.current) router.replace(intent === 'login' ? '/login' : '/phone');
  };
  const submit = async (value: string) => {
    if (inFlight.current || !phone || !/^\d{6}$/.test(value)) return;
    inFlight.current = true;
    setLoading(true);
    setError(undefined);
    try {
      const { destination } = await verifyOtp(value);
      const destinationPath = {
        home: '/home', 'driver-onboarding': '/driver-onboarding',
        'driver-dashboard': '/driver-dashboard', 'driver-status': '/driver-status',
      } as const;
      router.replace(destinationPath[destination]);
    } catch (reason) {
      setError(userErrorMessage(reason, 'Verification failed. Try again.'));
      setCode('');
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };
  const onChange = (text: string) => {
    if (inFlight.current) return;
    const next = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(next);
    setError(undefined);
    if (next.length === CODE_LENGTH) void submit(next);
  };
  const onResend = async () => {
    if (seconds > 0 || !phone || inFlight.current) return;
    inFlight.current = true;
    setResending(true);
    setCode('');
    setError(undefined);
    try {
      await requestOtp(phone);
      setSeconds(RESEND_SECONDS);
      feedback.success('A new verification code has been sent.');
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (reason) {
      setError(userErrorMessage(reason, 'Could not resend your code. Try again.'));
    } finally {
      inFlight.current = false;
      setResending(false);
    }
  };

  if (!phone) return <Redirect href="/phone" />;
  return <OtpVerificationView phone={phone} code={code} inputRef={inputRef} error={error}
    loading={loading} resending={resending} seconds={seconds} onBack={changeNumber} onChangeNumber={changeNumber}
    onCodeChange={onChange} onVerify={() => void submit(code)} onResend={() => void onResend()} />;
}
