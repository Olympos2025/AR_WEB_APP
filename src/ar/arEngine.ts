import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { densifyGeometry } from '../geo/densify';
import { ElevationService } from '../geo/elevation';
import { GpsFilter } from '../geo/gpsFilter';
import { LatLon, haversineDistance, toENU } from '../geo/geoUtils';
import { forEachPosition } from '../geo/transform';
import { LayerData } from '../state/layerTypes';
import { BasemapGround, BasemapKey } from './basemapGround';
import { buildLayers, disposeGroup } from './geometryBuilder';
import {
  OrientationSample,
  OrientationWatch,
  headingFromQuaternion,
  orientationToQuaternion,
  screenAngle,
  watchOrientation,
} from './orientation';
import { requestDeviceOrientationPermission, startCameraStream, stopStream } from './sensors';

export interface ARSettings {
  headingOffset: number; // deg, manual compass calibration
  heightOffset: number; // m, camera height above ground
  useAltitudes: boolean; // honor per-vertex altitudes from the file
  drapeToTerrain: boolean; // drape geometry on real terrain elevations (DEM)
  // Camera height from the device's GPS altitude instead of assuming the user
  // stands on the DEM surface — needed on rooftops, balconies, bridges.
  useGpsAltitude: boolean;
  basemap: BasemapKey;
  basemapOpacity: number;
  fov: number; // vertical fov in degrees
}

export const DEFAULT_AR_SETTINGS: ARSettings = {
  headingOffset: 0,
  heightOffset: 0,
  useAltitudes: false,
  drapeToTerrain: true,
  useGpsAltitude: false,
  basemap: 'none',
  basemapOpacity: 0.85,
  fov: 65,
};

export type TerrainState = 'off' | 'loading' | 'active' | 'unavailable';

export interface ARTelemetry {
  accuracy: number | null; // raw accuracy of the latest GPS fix
  estimatedAccuracy: number | null; // filtered estimate; improves over time
  heading: number | null;
  position: LatLon | null; // filtered current position
  originSet: boolean;
  trackedFeatures: number;
  cameraState: 'pending' | 'ok' | 'error';
  orientationSeen: boolean;
  terrain: TerrainState;
  originElevation: number | null; // meters at the anchor, when terrain is active
  /** Camera height above the DEM ground (m) when GPS-altitude mode is on. */
  heightAboveGround: number | null;
  gpsAltitudeSeen: boolean; // device reports an altitude at all
}

const EYE_HEIGHT = 1.6;

function positionKey(lon: number, lat: number): string {
  return `${lon.toFixed(7)},${lat.toFixed(7)}`;
}

const ALTITUDE_BIAS_KEY = 'fieldar.altitudeBias';

function readStoredAltitudeBias(): number {
  try {
    const raw = localStorage.getItem(ALTITUDE_BIAS_KEY);
    const value = raw === null ? 0 : Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export class AREngine {
  private container: HTMLElement;
  private video: HTMLVideoElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private basemap = new BasemapGround();

  private stream: MediaStream | null = null;
  private geoWatchId: number | null = null;
  private orientationWatch: OrientationWatch | null = null;
  private animationFrame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private telemetryTimer: number | null = null;

  private layers: LayerData[] = [];
  private settings: ARSettings = { ...DEFAULT_AR_SETTINGS };

  private origin: LatLon | null = null;
  private gpsFilter = new GpsFilter();
  private estimatedAccuracy: number | null = null;
  private elevation = new ElevationService();
  private buildToken = 0;
  private originGroundElev: number | null = null; // absolute meters at the anchor
  private originElevFailed = false;
  private terrainRetryTimer: number | null = null;
  private cameraElevCache: { at: LatLon; y: number } | null = null;
  private gpsAltSmoothed: number | null = null;
  // Difference between the device altitude datum and the DEM datum; set by the
  // "I am at ground level" calibration and persisted per device.
  private altitudeBias = readStoredAltitudeBias();
  private lastHeightAboveGround: number | null = null;
  private targetCameraPosition = new THREE.Vector3(0, EYE_HEIGHT, 0);
  private targetQuaternion = new THREE.Quaternion();
  private hasOrientation = false;
  private lastSample: OrientationSample | null = null;
  private accuracy: number | null = null;
  private cameraState: ARTelemetry['cameraState'] = 'pending';
  private contentGroup: THREE.Group | null = null;
  private lineMaterials: LineMaterial[] = [];
  private trackedFeatures = 0;
  private running = false;

  onTelemetry: ((telemetry: ARTelemetry) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    Object.assign(this.video.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    } as CSSStyleDeclaration);
    container.appendChild(this.video);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    Object.assign(this.renderer.domElement.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
    } as CSSStyleDeclaration);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.1, 120000);
    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.scene.add(this.basemap.group);
  }

  async start(layers: LayerData[], settings: ARSettings) {
    this.layers = layers;
    this.settings = { ...settings };
    this.running = true;

    this.handleResize();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    // iOS requires an explicit permission request from a user gesture.
    await requestDeviceOrientationPermission();

    this.orientationWatch = watchOrientation((sample) => {
      this.lastSample = sample;
      this.hasOrientation = true;
    });

    if (navigator.geolocation) {
      this.geoWatchId = navigator.geolocation.watchPosition(
        (pos) => this.handlePosition(pos),
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      );
    }

    try {
      this.stream = await startCameraStream(this.video);
      this.cameraState = 'ok';
    } catch {
      this.cameraState = 'error';
    }

    this.telemetryTimer = window.setInterval(() => this.emitTelemetry(), 500);
    this.renderLoop();
  }

  stop() {
    this.running = false;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    if (this.telemetryTimer !== null) window.clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
    this.orientationWatch?.stop();
    this.orientationWatch = null;
    if (this.geoWatchId !== null) navigator.geolocation?.clearWatch(this.geoWatchId);
    this.geoWatchId = null;
    stopStream(this.stream);
    this.stream = null;
    this.video.srcObject = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearContent();
    this.basemap.dispose();
    this.renderer.dispose();
    this.video.remove();
    this.renderer.domElement.remove();
  }

  setLayers(layers: LayerData[]) {
    this.layers = layers;
    void this.rebuildContent();
  }

  setSettings(settings: ARSettings) {
    const needsRebuild =
      settings.useAltitudes !== this.settings.useAltitudes ||
      settings.drapeToTerrain !== this.settings.drapeToTerrain;
    const previousBasemap = this.settings.basemap;
    this.settings = { ...settings };
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.basemap.setBasemap(settings.basemap);
    this.basemap.setOpacity(settings.basemapOpacity);
    this.basemap.setTerrain(
      settings.drapeToTerrain ? (lat, lon) => this.elevation.elevationAt(lat, lon) : null,
      this.originGroundElev
    );
    if (needsRebuild) void this.rebuildContent();
    const current = this.currentPosition();
    if (current) {
      void this.updateCameraTarget(current);
      if (settings.basemap !== previousBasemap && this.origin) this.basemap.update(current);
    }
  }

  private currentPosition(): LatLon | null {
    return this.gpsFilter.current;
  }

  private handlePosition(pos: GeolocationPosition) {
    this.accuracy = pos.coords.accuracy ?? null;
    const rawAlt = pos.coords.altitude;
    if (rawAlt !== null && !Number.isNaN(rawAlt)) {
      this.gpsAltSmoothed =
        this.gpsAltSmoothed === null
          ? rawAlt
          : this.gpsAltSmoothed + 0.25 * (rawAlt - this.gpsAltSmoothed);
    }
    // Accuracy-weighted filtering: the position estimate converges on its own
    // as GPS quality improves, so the overlay self-corrects over time.
    const filtered = this.gpsFilter.update({
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      alt: pos.coords.altitude ?? 0,
      accuracy: pos.coords.accuracy ?? 30,
      timestamp: pos.timestamp ?? Date.now(),
    });
    this.estimatedAccuracy = filtered.estimatedAccuracy;

    if (!this.origin) {
      // Anchor the world at the first fix; all geometry is built relative to it.
      // The anchor only defines the local frame — camera placement always uses
      // the latest filtered fix, so an imprecise first fix costs nothing.
      this.origin = filtered;
      this.basemap.setOrigin(filtered);
      void this.rebuildContent();
    }

    void this.updateCameraTarget(filtered);
    this.basemap.update(filtered);
  }

  /** Horizontal position from the filtered fix; height from DEM or GPS altitude. */
  private async updateCameraTarget(fix: LatLon) {
    if (!this.origin) return;
    const enu = toENU(this.origin, fix);
    this.targetCameraPosition.x = enu.east;
    this.targetCameraPosition.z = -enu.north;

    let groundY = 0;
    if (this.settings.drapeToTerrain && this.originGroundElev !== null) {
      if (this.cameraElevCache && haversineDistance(this.cameraElevCache.at, fix) < 3) {
        groundY = this.cameraElevCache.y;
      } else {
        const elev = await this.elevation.elevationAt(fix.lat, fix.lon);
        if (!this.running) return;
        if (elev !== null) {
          groundY = elev - this.originGroundElev;
          this.cameraElevCache = { at: fix, y: groundY };
        }
      }
    }

    if (
      this.settings.useGpsAltitude &&
      this.gpsAltSmoothed !== null &&
      this.originGroundElev !== null
    ) {
      // Height above the world datum straight from the (bias-corrected) GPS
      // altitude, so rooftops/bridges place the camera above the DEM surface.
      const y = this.gpsAltSmoothed - this.altitudeBias - this.originGroundElev;
      const clamped = Math.max(y, groundY + 0.5); // never below the ground
      this.lastHeightAboveGround = clamped - groundY;
      this.targetCameraPosition.y = clamped + this.settings.heightOffset;
    } else {
      this.lastHeightAboveGround = null;
      this.targetCameraPosition.y = groundY + EYE_HEIGHT + this.settings.heightOffset;
    }
  }

  /**
   * "I am at ground level" calibration: aligns the device altitude datum with
   * the DEM so GPS-altitude mode measures true height above the ground.
   */
  async calibrateGroundLevel(): Promise<boolean> {
    const fix = this.currentPosition();
    if (!fix || this.gpsAltSmoothed === null) return false;
    const elev = await this.elevation.elevationAt(fix.lat, fix.lon);
    if (elev === null) return false;
    this.altitudeBias = this.gpsAltSmoothed - elev;
    try {
      localStorage.setItem(ALTITUDE_BIAS_KEY, String(this.altitudeBias));
    } catch {
      // storage may be unavailable; the bias still applies for this session
    }
    void this.updateCameraTarget(fix);
    return true;
  }

  private async rebuildContent() {
    const token = ++this.buildToken;
    this.clearContent();
    if (!this.origin) return;

    let layers = this.layers;
    let groundYAt: (lon: number, lat: number) => number = () => 0;
    let altitudeReference = this.origin.alt ?? 0;

    if (this.settings.drapeToTerrain) {
      const originElev = await this.ensureOriginElevation();
      if (token !== this.buildToken || !this.running) return;
      if (originElev !== null) {
        altitudeReference = originElev;
        // Densify long segments so lines/outlines follow the slope, then
        // sample the DEM once for every distinct vertex.
        layers = this.layers.map((layer) => ({
          ...layer,
          geojson: {
            type: 'FeatureCollection' as const,
            features: layer.geojson.features.map((feature) =>
              feature.geometry
                ? { ...feature, geometry: densifyGeometry(feature.geometry) }
                : feature
            ),
          },
        }));

        const wanted = new Map<string, { lat: number; lon: number }>();
        layers
          .filter((layer) => layer.visible)
          .forEach((layer) =>
            layer.geojson.features.forEach((feature) => {
              if (!feature.geometry) return;
              forEachPosition(feature.geometry, ([lon, lat]) => {
                wanted.set(positionKey(lon, lat), { lat, lon });
              });
            })
          );

        const points = Array.from(wanted.values());
        const elevations = await this.elevation.sampleMany(points);
        if (token !== this.buildToken || !this.running) return;
        const lookup = new Map<string, number>();
        points.forEach((point, i) => {
          const elev = elevations[i];
          if (elev !== null) lookup.set(positionKey(point.lon, point.lat), elev - originElev);
        });
        groundYAt = (lon, lat) => lookup.get(positionKey(lon, lat)) ?? 0;
      }
    }

    const built = buildLayers(layers, this.origin, {
      useAltitudes: this.settings.useAltitudes,
      groundYAt,
      altitudeReference,
    });
    this.contentGroup = built.group;
    this.lineMaterials = built.lineMaterials;
    this.trackedFeatures = built.featureCount;
    this.scene.add(built.group);
    this.updateLineResolutions();

    // Field-debugging hook: inspectable from the browser console / E2E tests.
    const bounds = new THREE.Box3().setFromObject(built.group);
    (window as unknown as { __fieldarDebug?: unknown }).__fieldarDebug = {
      drapeToTerrain: this.settings.drapeToTerrain,
      originGroundElev: this.originGroundElev,
      trackedFeatures: built.featureCount,
      contentYRange: built.featureCount ? [bounds.min.y, bounds.max.y] : null,
      cameraY: this.targetCameraPosition.y,
    };
  }

  private async ensureOriginElevation(): Promise<number | null> {
    if (!this.origin) return null;
    if (this.originGroundElev === null) {
      this.originGroundElev = await this.elevation.elevationAt(this.origin.lat, this.origin.lon);
      this.originElevFailed = this.originGroundElev === null;
      this.basemap.setTerrain(
        this.settings.drapeToTerrain && this.originGroundElev !== null
          ? (lat, lon) => this.elevation.elevationAt(lat, lon)
          : null,
        this.originGroundElev
      );
      // Network hiccup: keep retrying so terrain kicks in as soon as tiles load.
      if (this.originElevFailed && this.terrainRetryTimer === null) {
        this.terrainRetryTimer = window.setTimeout(() => {
          this.terrainRetryTimer = null;
          if (this.running && this.settings.drapeToTerrain && this.originGroundElev === null) {
            void this.rebuildContent();
          }
        }, 10000);
      }
    }
    return this.originGroundElev;
  }

  private clearContent() {
    if (this.contentGroup) {
      this.scene.remove(this.contentGroup);
      disposeGroup(this.contentGroup);
    }
    this.contentGroup = null;
    this.lineMaterials = [];
    this.trackedFeatures = 0;
  }

  private handleResize() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.updateLineResolutions();
  }

  private updateLineResolutions() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.lineMaterials.forEach((material) => material.resolution.set(width, height));
  }

  private renderLoop = () => {
    if (!this.running) return;
    this.animationFrame = requestAnimationFrame(this.renderLoop);

    if (this.lastSample) {
      orientationToQuaternion(
        this.targetQuaternion,
        this.lastSample,
        screenAngle(),
        this.settings.headingOffset
      );
      // Low-pass filter to damp sensor noise.
      this.camera.quaternion.slerp(this.targetQuaternion, 0.25);
    }
    this.camera.position.lerp(this.targetCameraPosition, 0.08);

    this.renderer.render(this.scene, this.camera);
  };

  private emitTelemetry() {
    if (!this.onTelemetry) return;
    let terrain: TerrainState = 'off';
    if (this.settings.drapeToTerrain) {
      if (this.originGroundElev !== null) terrain = 'active';
      else if (this.originElevFailed) terrain = 'unavailable';
      else terrain = 'loading';
    }
    this.onTelemetry({
      accuracy: this.accuracy,
      estimatedAccuracy: this.estimatedAccuracy,
      heading: this.hasOrientation ? headingFromQuaternion(this.camera.quaternion) : null,
      position: this.currentPosition(),
      originSet: this.origin !== null,
      trackedFeatures: this.trackedFeatures,
      cameraState: this.cameraState,
      orientationSeen: this.hasOrientation,
      terrain,
      originElevation: this.originGroundElev,
      heightAboveGround: this.lastHeightAboveGround,
      gpsAltitudeSeen: this.gpsAltSmoothed !== null,
    });
  }
}
