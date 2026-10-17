import type { TripRow, TripStatus } from '../trips/trip.types';
import type { CreateNotificationInput } from './notifications.types';

type TripTarget = Pick<TripRow, 'id' | 'rider_id' | 'driver_id' | 'service_type' | 'scheduled_at'>;

const tripLink = (recipient: 'rider' | 'driver') => recipient === 'driver' ? '/driver-trip' : '/ongoing-trip';

export function tripStatusNotifications(trip: TripTarget, status: TripStatus): CreateNotificationInput[] {
  const courier = trip.service_type === 'courier';
  const result: CreateNotificationInput[] = [];
  const riderCategory = trip.scheduled_at && (status === 'searching' || (status === 'cancelled' && !trip.driver_id)) ? 'scheduled_reminders' : 'trip_updates';
  const rider = (type: string, title: string, body: string, priority: 'normal' | 'high' = 'normal') => result.push({
    userId: trip.rider_id, type, category: riderCategory, priority,
    eventKey: `trip:${trip.id}:${type}:rider`, title, body, data: { tripId: trip.id, status }, deepLink: tripLink('rider'),
  });
  const driver = (type: string, title: string, body: string, priority: 'normal' | 'high' = 'normal') => {
    if (!trip.driver_id) return;
    result.push({ userId: trip.driver_id, type, category: 'trip_updates', priority,
      eventKey: `trip:${trip.id}:${type}:driver`, title, body, data: { tripId: trip.id, status }, deepLink: tripLink('driver') });
  };

  if (status === 'searching' && trip.scheduled_at) rider('scheduled_ride_starting', 'Your scheduled ride is starting soon', 'We are finding a driver for your scheduled pickup.', 'high');
  if (status === 'driver_assigned') rider('driver_assigned', courier ? 'Delivery driver assigned' : 'Your driver is on the way', courier ? 'A driver is heading to collect your package.' : 'Follow the driver in Rakky Ride.');
  if (status === 'driver_arrived') rider('driver_arrived', courier ? 'Driver is at pickup' : 'Your driver has arrived', courier ? 'Meet the driver and hand over the sealed package.' : 'Meet your driver at the pickup point.', 'high');
  if (status === 'in_progress') rider('trip_started', courier ? 'Package collected' : 'Your trip has started', courier ? 'Track the delivery from the Rakky Ride app.' : 'Your destination is available in the live trip screen.');
  if (status === 'returning') rider('courier_returning', 'Package returning to you', 'Open Rakky Ride for return and handoff details.', 'high');
  if (status === 'completed') {
    rider('trip_completed', courier ? 'Package delivered' : 'Trip completed', courier ? 'The recipient confirmed the package handoff.' : 'Your receipt is ready in Rakky Ride.');
    driver('trip_completed', courier ? 'Delivery completed' : 'Trip completed', 'Your earnings have been recorded.');
  }
  if (status === 'returned') {
    rider('courier_returned', 'Package returned', 'The package return has been confirmed.');
    driver('courier_returned', 'Package return completed', 'Your earnings have been recorded.');
  }
  if (status === 'cancelled') {
    rider('trip_cancelled', courier ? 'Delivery cancelled' : 'Ride cancelled', 'Open Rakky Ride for the latest trip details.', 'high');
    driver('trip_cancelled', courier ? 'Delivery cancelled' : 'Ride cancelled', 'This request is no longer active.', 'high');
  }
  if (status === 'no_drivers_found') rider('no_drivers_found', 'No drivers found', 'Try requesting again in a few minutes.');
  return result;
}

export function driverOfferNotification(input: {
  driverId: string; tripId: string; serviceType: string; fareKobo: number; distanceToPickupM: number; expiresAt: Date;
}): CreateNotificationInput {
  const courier = input.serviceType === 'courier';
  return {
    userId: input.driverId,
    type: 'ride_offer',
    category: 'driver_offers',
    priority: 'high',
    eventKey: `trip:${input.tripId}:offer:${input.driverId}`,
    title: courier ? 'New courier offer' : 'New ride offer',
    body: `Pickup is ${Math.max(1, Math.round(input.distanceToPickupM / 100)) / 10} km away · ₦${Math.round(input.fareKobo / 100).toLocaleString('en-NG')}`,
    data: { tripId: input.tripId, serviceType: input.serviceType, kind: 'ride_offer' },
    deepLink: '/driver-dashboard',
    expiresAt: input.expiresAt,
  };
}

export function walletNotification(input: {
  userId: string; eventKey: string; type: string; title: string; body: string; referenceId: string; tripId?: string; priority?: 'normal' | 'high';
}): CreateNotificationInput {
  return {
    userId: input.userId,
    type: input.type,
    category: 'wallet_updates',
    priority: input.priority ?? 'normal',
    eventKey: input.eventKey,
    title: input.title,
    body: input.body,
    data: { referenceId: input.referenceId, ...(input.tripId ? { tripId: input.tripId } : {}) },
    deepLink: '/account/driver-wallet',
  };
}

export function driverApplicationNotification(input: {
  userId: string; status: 'pending' | 'approved' | 'rejected'; reason?: string | null; version?: string;
}): CreateNotificationInput {
  const approved = input.status === 'approved';
  const rejected = input.status === 'rejected';
  return {
    userId: input.userId,
    type: `driver_application_${input.status}`,
    category: 'support',
    priority: rejected ? 'high' : 'normal',
    eventKey: `driver-application:${input.userId}:${input.status}:${input.version ?? 'current'}`,
    title: approved ? 'Your service application was reviewed' : rejected ? 'Driver application needs attention' : 'Driver application submitted',
    body: approved ? 'Open your dashboard to see approved services and choose which requests to receive.' : rejected ? (input.reason?.trim() || 'Review your application details and submit again.') : 'We will notify you when the review is complete.',
    data: { status: input.status },
    deepLink: approved ? '/driver-dashboard' : '/driver-status',
  };
}

export function careNotification(input:{userId:string;kind:'support'|'safety';careId:string;status:string;version:number}):CreateNotificationInput{
  const safety=input.kind==='safety';
  return{userId:input.userId,type:`${input.kind}_${input.status}`,category:safety?'safety_security':'support',priority:safety?'high':'normal',eventKey:`care:${input.kind}:${input.careId}:${input.status}:${input.version}`,title:safety?'Safety update available':'Support case updated',body:safety?'Open Rakky Ride to review an important safety update.':`Your support case is now ${input.status.replaceAll('_',' ')}.`,data:{careId:input.careId,status:input.status},deepLink:'/account/support'};
}
