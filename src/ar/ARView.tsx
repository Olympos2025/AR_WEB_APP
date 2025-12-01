import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LatLon } from '../geo/geoUtils';
import { extractTargets, normalizeBearing, relativeBearing } from './geodesy';
import {
  PermissionState,
  requestDeviceOrientationPermission,
  startCameraStream,
  startGeolocationWatch,
  startOrientationWatch,
  stopStream,
} from './sensors';

interface Telemetry {
  accuracy: number | null;
  heading: number | null;
  overlays: number;
  permission: PermissionState;
  visibleFeatures: number;
  totalFeatures: number;
}

interface Props {
  data: GeoJSON.FeatureCollection | null;
  active: boolean;
  onStop: () => void;
  onTelemetry?: (telemetry: Telemetry) => void;
}

const FIELD_OF_VIEW = 65; // degrees for simple projection
export const VISIBLE_RADIUS_METERS = 50_000;

export default function ARView({ data, active, onStop, onTelemetry }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopGeo = useRef<(() => void) | null>(null);
  const stopOrientation = useRef<(() => void) | null>(null);

  const [origin, setOrigin] = useState<LatLon | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [permission, setPermission] = useState<PermissionState>('idle');
  const [overlayCount, setOverlayCount] = useState(0);
  const [visibleFeatureCount, setVisibleFeatureCount] = useState(0);
  const [totalFeatureCount, setTotalFeatureCount] = useState(0);

  const targets = useMemo(() => {
    if (!data || !origin) return [];
    return extractTargets({ origin, collection: data });
  }, [data, origin]);

  useEffect(() => {
    const distinctFeatures = new Set(targets.map((target) => target.featureIndex)).size;
    setTotalFeatureCount(distinctFeatures || data?.features?.length || 0);
  }, [targets, data]);

  useEffect(() => {
    if (!active) {
      teardown();
      return;
    }

    (async () => {
      const perm = await requestDeviceOrientationPermission();
      setPermission(perm);
      if (perm === 'denied') return;
      if (!videoRef.current) return;

      streamRef.current = await startCameraStream(videoRef.current);
      startSensors();
    })();

    return () => teardown();
  }, [active]);

  useEffect(() => {
    drawOverlay();
  }, [targets, heading]);

  useEffect(() => {
    onTelemetry?.({
      accuracy,
      heading,
      overlays: overlayCount,
      permission,
      visibleFeatures: visibleFeatureCount,
      totalFeatures: totalFeatureCount,
    });
  }, [accuracy, heading, overlayCount, permission, visibleFeatureCount, totalFeatureCount, onTelemetry]);

  function startSensors() {
    stopGeo.current = startGeolocationWatch(
      (pos) => {
        setAccuracy(pos.coords.accuracy ?? null);
        setOrigin({ lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude ?? 0 });
      },
      () => setPermission('denied')
    );

    stopOrientation.current = startOrientationWatch((value) => setHeading(value));
  }

  function drawOverlay() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const width = (canvas.width = canvas.clientWidth);
    const height = (canvas.height = canvas.clientHeight);

    ctx.clearRect(0, 0, width, height);
    if (!heading) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '16px sans-serif';
      ctx.fillText('Move your device to calibrate heading...', 16, 32);
      setOverlayCount(0);
      setVisibleFeatureCount(0);
      return;
    }

    const withinRange = targets.filter((t) => t.distance <= VISIBLE_RADIUS_METERS);
    const visible = withinRange.filter((t) => Math.abs(relativeBearing(t.bearing, heading)) <= FIELD_OF_VIEW / 2);
    setOverlayCount(visible.length);
    setVisibleFeatureCount(new Set(visible.map((target) => target.featureIndex)).size);

    visible.forEach((target) => {
      const diff = relativeBearing(target.bearing, heading);
      const ratio = diff / (FIELD_OF_VIEW / 2);
      const x = width / 2 + (ratio * width) / 2;
      const y = height * 0.4 + Math.min(target.distance / 3000, 1) * height * 0.3;

      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(14,165,233,0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(14,165,233,1)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'white';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${target.label ?? 'Target'}`, x, y - 16);
      ctx.fillText(`${formatDistance(target.distance)} • ${normalizeBearing(target.bearing).toFixed(0)}°`, x, y + 26);
    });
  }

  function teardown() {
    stopGeo.current?.();
    stopGeo.current = null;
    stopOrientation.current?.();
    stopOrientation.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    setOverlayCount(0);
    setVisibleFeatureCount(0);
    setTotalFeatureCount(0);
  }

  return active ? (
    <div className="fixed inset-0 bg-black z-50">
      <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0" />

      <div className="absolute top-4 left-4 bg-slate-900/80 text-white px-3 py-2 rounded shadow">
        <div className="text-sm font-semibold">HUD</div>
        <div className="text-xs">Accuracy: {accuracy ? `±${accuracy.toFixed(1)}m` : 'N/A'}</div>
        <div className="text-xs">Heading: {heading ? `${heading.toFixed(0)}°` : 'N/A'}</div>
        <div className="text-xs">Overlays: {overlayCount}</div>
        <div className="text-xs">Features: {visibleFeatureCount}/{totalFeatureCount}</div>
        <div className="text-xs">Sensors: {permission}</div>
      </div>

      <button
        onClick={() => {
          teardown();
          onStop();
        }}
        className="absolute top-4 right-4 bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded shadow"
      >
        Stop AR
      </button>
    </div>
  ) : null;
}

function formatDistance(distance: number): string {
  if (distance >= 1000) {
    return `${(distance / 1000).toFixed(2)} km`;
  }
  return `${distance.toFixed(0)} m`;
}
