import { useEffect, useRef, useState } from 'react';
import { LatLon, smoothPositions } from '../geo/geoUtils';
import { OverlayOptions, ensureScene, renderGeoJSON, teardownScene } from './arScene';

type PermissionState = 'idle' | 'denied' | 'granted';

interface Props {
  data: GeoJSON.FeatureCollection | null;
  origin: LatLon | null;
  options: OverlayOptions;
  active: boolean;
  mount?: HTMLElement | null;
}

export function useARRenderer({ data, origin, options, active, mount }: Props) {
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [permission, setPermission] = useState<PermissionState>('idle');
  const positions = useRef<LatLon[]>([]);
  const sceneRef = useRef<HTMLElement | null>(null);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      stop();
      return;
    }
    if (!data) return;
    const scene = ensureScene(mount ?? undefined);
    scene.style.display = 'block';
    sceneRef.current = scene;
    requestSensors();
    startTracking();
    return () => stop();
  }, [active, data, options, mount]);

  useEffect(() => {
    if (!active || !data || !origin || !sceneRef.current) return;
    renderGeoJSON(sceneRef.current, origin, data, options);
  }, [active, data, origin, options]);

  function requestSensors() {
    const isSecure = window.isSecureContext;
    if (!isSecure) {
      setPermission('denied');
      return;
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && (DeviceOrientationEvent as any).requestPermission) {
      (DeviceOrientationEvent as any)
        .requestPermission()
        .then((response: string) => {
          setPermission(response === 'granted' ? 'granted' : 'denied');
        })
        .catch(() => setPermission('denied'));
    } else {
      setPermission('granted');
    }
  }

  function startTracking() {
    if (watchId.current !== null) return;
    if (!navigator.geolocation) return;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsAccuracy(pos.coords.accuracy ?? null);
        positions.current.push({ lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude ?? 0 });
        const smoothed = smoothPositions(positions.current);
        if (smoothed && data && sceneRef.current) {
          renderGeoJSON(sceneRef.current, smoothed, data, options);
        }
      },
      () => setPermission('denied'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
    );

    window.addEventListener('deviceorientation', handleOrientation, true);
  }

  function handleOrientation(event: DeviceOrientationEvent) {
    if (event.absolute && typeof event.alpha === 'number') {
      setHeading(event.alpha);
    }
  }

  function stop() {
    positions.current = [];
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    window.removeEventListener('deviceorientation', handleOrientation, true);
    if (sceneRef.current) {
      clearScene(sceneRef.current);
      sceneRef.current.style.display = 'none';
    }
    positions.current = [];
  }

  return { gpsAccuracy, heading, permission };
}
