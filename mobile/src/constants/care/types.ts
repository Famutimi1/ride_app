import type { ComponentProps } from 'react';
import type { RideIcon } from '@/components/common/RideIcon';

export type CareRole = 'rider' | 'driver';
export type CareIcon = ComponentProps<typeof RideIcon>['name'];
export type CareDestination = 'trip' | 'history' | 'wallet' | 'account' | 'vehicle-documents' | 'driver-services' | 'application';
export interface CareContext { passenger: boolean; courier: boolean }
export interface CareArticle { id: string; question: string; answer: string }
export interface CareTip { icon: CareIcon; text: string }
export interface CareShortcut { icon: CareIcon; label: string; destination: CareDestination }
export interface CareContent {
  safetyTitle: string; safetyHeading: string; tips: CareTip[]; safetyArticles: CareArticle[];
  supportTitle: string; supportIntro: string; shortcuts: CareShortcut[]; answers: CareArticle[];
  safetyContactTitle: string; safetyContactDetail: string;
}
