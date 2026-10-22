import type { CareContent, CareContext } from './types';

/** Driver operational help stays independent of the rider's booking/payment copy. */
export function driverCareContent(context: CareContext): CareContent {
  return {
    safetyTitle: 'Driver safety', safetyHeading: 'Before and during your work',
    tips: [
      { icon: 'vehicle', text: 'Check your vehicle before going online.' },
      { icon: 'location', text: 'Choose a safe place to stop for pickup.' },
      { icon: 'device', text: 'Stop safely before using your phone.' },
      { icon: 'lock', text: 'Keep login and payout codes private.' },
    ],
    safetyArticles: [
      ...(context.passenger ? [{ id: 'passenger-safety', question: 'Passenger behaviour or an unsafe pickup', answer: 'If you feel unsafe, prioritise your safety and move to a safe place if possible. Use emergency services for immediate danger. For follow-up, contact support with the trip reference and a factual description of what happened.' }] : []),
      { id: 'vehicle-safety', question: 'An accident or vehicle breakdown', answer: 'Stop somewhere safe if possible. Use emergency services if anyone is in immediate danger. Open your current trip for its details and contact support when it is safe.' },
      ...(context.courier ? [{ id: 'courier-safety', question: 'A suspicious package or unsafe handoff', answer: 'Do not open a suspicious package or confront anyone. Move to safety and use emergency services if there is immediate danger. Contact support for follow-up. For an ordinary delivery problem, use the delivery and return instructions in your current trip.' }] : []),
    ],
    supportTitle: 'Driver help & support', supportIntro: 'Help with trips, earnings and your driver account.',
    shortcuts: [
      { icon: 'receipt', label: 'Driver trips & earnings', destination: 'history' },
      { icon: 'wallet', label: 'Earnings, withdrawals & payouts', destination: 'wallet' },
      { icon: 'id-card', label: 'Vehicle & documents', destination: 'vehicle-documents' },
      { icon: 'swap', label: 'Services & request preferences', destination: 'driver-services' },
      { icon: 'clock', label: 'Application status', destination: 'application' },
      { icon: 'passenger', label: 'Account & phone', destination: 'account' },
    ],
    answers: [
      ...(context.passenger ? [{ id: 'pickup', question: 'The passenger is missing or the pickup is wrong', answer: 'Open the current trip to check its pickup and contact options. If the trip cannot proceed, use the cancellation options available there. For a fare or cancellation dispute, contact support with the trip reference.' }] : []),
      { id: 'earnings', question: 'A fare, cash payment or earnings looks wrong', answer: 'Open Driver trips and select the trip to compare the recorded fare, commission and earnings. Cash collected and wallet earnings settle differently. Contact support with the trip reference if something does not match.' },
      { id: 'payout', question: 'My withdrawal is pending or failed', answer: 'Open Driver wallet to review the payout status and bank account. Pending withdrawals reserve earnings while processing. Contact support with the payout reference if you need help; submitting again does not resolve an existing pending payout.' },
      { id: 'documents', question: 'I cannot go online or my documents need attention', answer: 'Check Application status and Vehicle & documents. Then check Services & request preferences for each service’s approval and consent. An uploaded document does not by itself mean the application is approved. Contact support if a correction is needed.' },
      ...(context.courier ? [{ id: 'courier', question: 'The delivery code fails or the recipient is unavailable', answer: 'Use the delivery-code, contact and return options shown in your active courier trip. Do not mark a package delivered before the app confirms the handoff. Contact support if the trip cannot be resolved through those options.' }] : []),
    ],
    safetyContactTitle: 'Contact support about driver safety',
    safetyContactDetail: `For ${context.passenger ? 'passenger, pickup and vehicle' : 'pickup and vehicle'}${context.courier ? ', including delivery' : ''} concerns. Use emergency services for immediate danger.`,
  };
}
