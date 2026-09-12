# Follow Trip rollout

Follow Trip is disabled by default. Do not enable it before deploying the updated
Firestore rules: the previous authenticated-user fallback permits all signed-in
users to read new collections.

1. Deploy `firestore.rules` to the intended Firebase project with
   `firebase deploy --only firestore:rules --project myway-gps`.
2. Verify with three accounts that the driver and selected participants can read
   `sharedTrips/{driverId}`, an unselected account cannot, and only the driver can write.
3. Set `VITE_FOLLOW_TRIP_ENABLED=true` in the build environment and restart/build.
4. On two phones, start a shared trip, follow it, reroute, stop sharing, cancel,
   arrive, disconnect GPS/network, and check the displayed freshness timestamp.

The first version sends in-app departure/arrival notices while connected. It does
not yet send operating-system push notifications while the follower app is closed.
The displayed trip estimate comes from the existing navigation route; it is not
a separately calculated live traffic ETA. Closed/crashed driver apps cannot publish
an end event; followers see the last GPS timestamp and a stale-location warning.

The latest trip per driver replaces the previous one. Ending sharing clears live
coordinates and route geometry while retaining the destination and end status for
arrival/ended notices to the original participants. No trip-history archive is created.
