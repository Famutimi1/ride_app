import { driverCareContent } from './driver';
import { riderCareContent } from './rider';
import type { CareContext, CareRole } from './types';
export type { CareArticle, CareContent, CareContext, CareDestination, CareRole } from './types';
export const getCareContent = (role: CareRole, context: CareContext) => role === 'driver' ? driverCareContent(context) : riderCareContent;
