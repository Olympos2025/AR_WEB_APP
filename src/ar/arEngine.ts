import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { GpsFilter } from '../geo/gpsFilter';
import { LatLon, toENU } from '../geo/geoUtils';
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
  basemap: BasemapKey;
  basemapOpacity: number;
  fov: number; // vertical fov in degrees
}

export const DEFAULT_AR_SETTINGS: ARSettings = {
  headingOffset: 0,
  heightOffset: 0,
  useAltitudes: false,
  basemap: 'none',
  basemapOpacity: 0.85,
  fov: 65,
};

export interface ARTelemetry {
  accuracy: number | null; // raw accuracy of the latest GPS fix
  estimatedAccuracy: number | null; // filtered estimate; improves over time
  heading: number | null;
  position: LatLon | null; // filtered current position
  originSet: boolean;
  trackedFeatures: number;
  cameraState: 'pending' | 'ok' | 'error';
  orientationSeen: boolean;
}

const EYE_HEIGHT = 1.6;

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
    this.rebuildContent();
  }

  setSettings(settings: ARSettings) {
    const needsRebuild = settings.useAltitudes !== this.settings.useAltitudes;
    const previousBasemap = this.settings.basemap;
    this.settings = { ...settings };
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.basemap.setBasemap(settings.basemap);
    this.basemap.setOpacity(settings.basemapOpacity);
    if (needsRebuild) this.rebuildContent();
    if (settings.basemap !== previousBasemap && this.origin) {
      const current = this.currentPosition();
      if (current) this.basemap.update(current);
    }
  }

  private currentPosition(): LatLon | null {
    return this.gpsFilter.current;
  }

  private handlePosition(pos: GeolocationPosition) {
    this.accuracy = pos.coords.accuracy ?? null;
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
      this.rebuildContent();
    }

    const enu = toENU(this.origin, filtered);
    this.targetCameraPosition.set(
      enu.east,
      EYE_HEIGHT + this.settings.heightOffset,
      -enu.north
    );
    this.basemap.update(filtered);
  }

  private rebuildContent() {
    this.clearContent();
    if (!this.origin) return;
    const built = buildLayers(this.layers, this.origin, this.settings.useAltitudes);
    this.contentGroup = built.group;
    this.lineMaterials = built.lineMaterials;
    this.trackedFeatures = built.featureCount;
    this.scene.add(built.group);
    this.updateLineResolutions();
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
    this.onTelemetry({
      accuracy: this.accuracy,
      estimatedAccuracy: this.estimatedAccuracy,
      heading: this.hasOrientation ? headingFromQuaternion(this.camera.quaternion) : null,
      position: this.currentPosition(),
      originSet: this.origin !== null,
      trackedFeatures: this.trackedFeatures,
      cameraState: this.cameraState,
      orientationSeen: this.hasOrientation,
    });
  }
}
