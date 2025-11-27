export type PermissionState = 'idle' | 'granted' | 'denied';

export interface GeolocationReading {
  coords: GeolocationCoordinates;
  timestamp: number;
}

export function requestDeviceOrientationPermission(): Promise<PermissionState> {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    return Promise.resolve('denied');
  }

  const DeviceOrientationEventAny = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
  };

  if (DeviceOrientationEventAny && typeof DeviceOrientationEventAny.requestPermission === 'function') {
    return DeviceOrientationEventAny.requestPermission()
      .then((response) => (response === 'granted' ? 'granted' : 'denied'))
      .catch(() => 'denied');
  }

  return Promise.resolve('granted');
}

export function deriveHeading(event: DeviceOrientationEvent): number | null {
  if (typeof event.webkitCompassHeading === 'number') {
    return event.webkitCompassHeading;
  }

  if (event.absolute && typeof event.alpha === 'number') {
    // alpha is degrees from device facing to magnetic north; convert to compass bearing
    const heading = 360 - event.alpha;
    return (heading + 360) % 360;
  }

  return null;
}

export function startOrientationWatch(callback: (heading: number | null, event: DeviceOrientationEvent) => void) {
  const handler = (event: DeviceOrientationEvent) => {
    const heading = deriveHeading(event);
    callback(heading, event);
  };

  window.addEventListener('deviceorientation', handler, true);
  return () => window.removeEventListener('deviceorientation', handler, true);
}

export function startGeolocationWatch(
  onSuccess: (position: GeolocationPosition) => void,
  onError: (err: GeolocationPositionError) => void,
  options: PositionOptions = { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
) {
  if (!navigator.geolocation) return null;
  const watchId = navigator.geolocation.watchPosition(onSuccess, onError, options);
  return () => navigator.geolocation.clearWatch(watchId);
}

export async function startCameraStream(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
    },
    audio: false,
  });

  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
