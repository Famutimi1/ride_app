import type { CareContent } from './types';

export const riderCareContent: CareContent = {
  safetyTitle: 'Rider safety', safetyHeading: 'Before and during your ride',
  tips: [
    { icon: 'vehicle', text: 'Match the driver, car and plate.' },
    { icon: 'seatbelt', text: 'Wear your seat belt.' },
    { icon: 'lock', text: 'Keep login codes private.' },
  ],
  safetyArticles: [
    { id: 'rider-safety', question: 'The driver or vehicle does not match', answer: 'Check the driver and vehicle details in your current trip before boarding. If they do not match, do not enter the vehicle. Use emergency services for immediate danger and contact support for follow-up.' },
    { id: 'ride-safety', question: 'I feel unsafe during a ride', answer: 'Prioritise your safety. Use emergency services for immediate danger. When it is safe, contact support with the trip reference and a factual description of your concern.' },
  ],
  supportTitle: 'Rider help & support', supportIntro: 'Help with your rides, payments and account.',
  shortcuts: [
    { icon: 'receipt', label: 'Ride history & receipts', destination: 'history' },
    { icon: 'wallet', label: 'Wallet & payments', destination: 'wallet' },
    { icon: 'passenger', label: 'Account & phone', destination: 'account' },
  ],
  answers: [
    { id: 'receipt', question: 'Where can I find my receipt?', answer: 'Open Ride history and select a completed trip to view its receipt. Other requests show trip details.' },
    { id: 'hold', question: 'Why is money held in my wallet?', answer: 'A ride hold reserves funds for a wallet trip. Payment shows hold, release and top-up entries. A hold release is not a new top-up.' },
    { id: 'lost-item', question: 'I left something in the vehicle', answer: 'Find the trip in Ride history and note its trip reference. Contact support using the details below. Avoid including payment credentials or login codes in your message.' },
  ],
  safetyContactTitle: 'Contact support about rider safety',
  safetyContactDetail: 'For driver, vehicle or ride concerns. Use emergency services for immediate danger.',
};
