// Start during the tap, before any async permission checks. Safari's
// Permissions API is not a reliable gate for a native location request.
export function requestLocation(geolocation, signal, {singleRequest = false} = {}) {
  return new Promise((resolve, reject) => {
    let done = false, watchId, fallbackStarted = false, lastError;
    let deadline, fallbackTimer;
    const cleanup = () => {
      clearTimeout(deadline);
      clearTimeout(fallbackTimer);
      signal?.removeEventListener('abort', abort);
      if (watchId !== undefined) {
        geolocation.clearWatch(watchId);
        watchId = undefined;
      }
    };
    const finish = (error, value) => {
      if (done) return;
      done = true; cleanup();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish({code: 'cancelled'});
    const success = position => {
      if (done) return;
      const {latitude, longitude, accuracy} = position?.coords || {};
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
          !Number.isFinite(accuracy) || accuracy < 0) {
        failure({code: 2});
        return;
      }
      finish(null, position);
    };
    const failure = error => {
      if (done) return;
      lastError = error;
      // A denied permission is final. A watch can emit a temporary failure
      // and still deliver a position later: do not clear it on errors 2 or 3.
      if (error?.code === 1 || ![2, 3].includes(error?.code)) finish(error);
      else if (singleRequest && fallbackStarted) finish(error);
      else fallback();
    };
    const fallback = () => {
      if (done || fallbackStarted) return;
      fallbackStarted = true;
      // Allow Wi-Fi/network positioning alongside GPS, through the same
      // browser API and permission. Never estimate the user's position by IP.
      try {
        geolocation.getCurrentPosition(success, failure,
          {enableHighAccuracy: false, timeout: 20000, maximumAge: 0});
      } catch (error) { failure(error); }
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, {once:true});
    // Allow time for a permission prompt and a cold GPS start, then clean up.
    deadline = setTimeout(() => finish(lastError || {code: 3}), 60000);
    if (!singleRequest) fallbackTimer = setTimeout(fallback, 12000);
    try {
      if (singleRequest) {
        // A standalone app first requests a single position directly from the
        // activation button. Continuous tracking starts only after success.
        // Do not issue overlapping prompts or retry a denied permission.
        geolocation.getCurrentPosition(success, failure,
          {enableHighAccuracy: true, timeout: 20000, maximumAge: 0});
      } else if (typeof geolocation.watchPosition === 'function') {
        watchId = geolocation.watchPosition(success, failure,
          {enableHighAccuracy: true, timeout: 20000, maximumAge: 0});
        if (done) cleanup();
      } else fallback();
    } catch (error) { failure(error); }
  });
}

export function locationFailureCode(error, {secure = true, embedded = false, policyAllowed = true} = {}) {
  if (!secure) return 'secure';
  if (!policyAllowed) return 'policy';
  const code = String(error?.code || 'unknown');
  if (code === '1' && embedded) return 'embedded';
  return code;
}
