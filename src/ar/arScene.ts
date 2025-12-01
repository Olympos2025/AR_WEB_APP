/* eslint-disable @typescript-eslint/no-explicit-any */
import { LatLon, toLocalGroundFrame } from '../geo/geoUtils';
import { douglasPeucker, Vec2 } from '../geo/simplify';

declare const AFRAME: any;

export interface OverlayOptions {
  polygonFill: string;
  polygonOpacity: number;
  polygonStroke: string;
  polygonWidth: number;
  lineColor: string;
  lineWidth: number;
  pointColor: string;
  showLabels: boolean;
  heightOffset: number;
  simplifyTolerance: number;
  transparency: number;
}

const DEFAULT_EYE_HEIGHT = 1.7; // meters; approximates a handheld device above ground

export function ensureScene(parent?: HTMLElement): HTMLElement {
  const target = parent ?? document.body;
  let scene = target.querySelector('a-scene');
  if (!scene) {
    scene = document.createElement('a-scene');
    scene.setAttribute('embedded', '');
    scene.setAttribute('vr-mode-ui', 'enabled: false');
    scene.setAttribute('renderer', 'logarithmicDepthBuffer: true;');
    scene.setAttribute('arjs', 'sourceType: webcam; debugUIEnabled: false;');
    scene.innerHTML = '<a-entity gps-camera rotation-reader></a-entity>';
    target.appendChild(scene);
  } else if (scene.parentElement !== target) {
    scene.parentElement.removeChild(scene);
    target.appendChild(scene);
  }
  scene.classList.add('fieldar-scene');
  const style = scene.style;
  style.width = '100%';
  style.height = '100%';
  style.position = 'absolute';
  style.inset = '0';
  style.display = style.display || 'none';
  return scene as HTMLElement;
}

export function clearScene(scene: HTMLElement) {
  const children = scene.querySelectorAll('[data-fieldar]');
  children.forEach((c) => c.remove());
}

export function teardownScene(scene: HTMLElement) {
  clearScene(scene);
  if (scene.parentNode) {
    scene.parentNode.removeChild(scene);
  }
}

export function renderGeoJSON(
  scene: HTMLElement,
  origin: LatLon,
  collection: GeoJSON.FeatureCollection,
  options: OverlayOptions
) {
  clearScene(scene);
  const groundAltitude = computeGroundAltitude(origin, options);
  collection.features.forEach((feature) => {
    if (!feature.geometry) return;
    const type = feature.geometry.type;
    if (type === 'Point') {
      renderPoint(scene, origin, feature.geometry as GeoJSON.Point, feature.properties, options, groundAltitude);
    } else if (type === 'LineString') {
      renderLine(scene, origin, feature.geometry as GeoJSON.LineString, options, groundAltitude);
    } else if (type === 'Polygon') {
      renderPolygon(scene, origin, feature.geometry as GeoJSON.Polygon, options, groundAltitude);
    }
  });
}

function computeGroundAltitude(origin: LatLon, options: OverlayOptions): number {
  const originAlt = origin.alt ?? 0;
  // Treat the user's eyes/camera as sitting above the ground; heightOffset allows tuning.
  // The resulting ground altitude is used so y=0 maps to the estimated terrain level locally.
  return originAlt - (DEFAULT_EYE_HEIGHT + (options.heightOffset ?? 0));
}

function renderPoint(
  scene: HTMLElement,
  origin: LatLon,
  geometry: GeoJSON.Point,
  properties: any,
  options: OverlayOptions,
  groundAltitude: number
) {
  const [lon, lat] = geometry.coordinates;
  const pos = toLocalGroundFrame(origin, {
    lat,
    lon,
    alt: (geometry.coordinates[2] as number | undefined) ?? groundAltitude,
  }, groundAltitude);
  const entity = document.createElement('a-entity');
  entity.setAttribute('data-fieldar', 'point');
  entity.setAttribute('gps-entity-place', `latitude: ${lat}; longitude: ${lon};`);
  entity.setAttribute('position', `${pos.east} ${pos.up} ${-pos.north}`);
  entity.setAttribute('geometry', 'primitive: sphere; radius: 0.8');
  entity.setAttribute('material', `color: ${options.pointColor}; opacity: ${1 - options.transparency}`);
  if (options.showLabels) {
    const text = document.createElement('a-text');
    text.setAttribute('value', properties?.name || 'Point');
    text.setAttribute('align', 'center');
    text.setAttribute('position', '0 1.5 0');
    text.setAttribute('look-at', '[gps-camera]');
    entity.appendChild(text);
  }
  scene.appendChild(entity);
}

function renderLine(
  scene: HTMLElement,
  origin: LatLon,
  geometry: GeoJSON.LineString,
  options: OverlayOptions,
  groundAltitude: number
) {
  const points = geometry.coordinates.map(([lon, lat, alt]) =>
    toLocalGroundFrame(origin, { lat, lon, alt: alt ?? groundAltitude }, groundAltitude)
  );
  const simplified = douglasPeucker(points.map(({ east, north }) => ({ east, north })), options.simplifyTolerance || 0);
  const finalPoints = simplified.map((p) => `${p.east} ${p.up} ${-p.north}`).join(',');
  const entity = document.createElement('a-entity');
  entity.setAttribute('data-fieldar', 'line');
  entity.setAttribute('line', `color: ${options.lineColor}; path: ${finalPoints}; linewidth: ${options.lineWidth}`);
  scene.appendChild(entity);
}

function renderPolygon(
  scene: HTMLElement,
  origin: LatLon,
  geometry: GeoJSON.Polygon,
  options: OverlayOptions,
  groundAltitude: number
) {
  const [outer] = geometry.coordinates;
  if (!outer || outer.length < 3) {
    console.warn('Skipping polygon with insufficient coordinates', geometry);
    return;
  }
  const enu = outer.map(([lon, lat, alt]) =>
    toLocalGroundFrame(origin, { lat, lon, alt: alt ?? groundAltitude }, groundAltitude)
  );
  const simplified = douglasPeucker(
    enu.map(({ east, north }) => ({ east, north } as Vec2)),
    options.simplifyTolerance || 0
  );
  if (simplified.length < 3) {
    console.warn('Skipping polygon after simplification due to insufficient vertices', geometry);
    return;
  }
  // Local y=0 corresponds to the estimated ground plane derived from the origin altitude.
  const groundShape = simplified.map((p) => `${p.east} 0 ${-p.north}`).join(',');

  // Ground footprint
  const poly = document.createElement('a-entity');
  poly.setAttribute('data-fieldar', 'polygon');
  poly.setAttribute(
    'shape',
    `shape: ${groundShape}; color: ${options.polygonFill}; opacity: ${options.polygonOpacity * (1 - options.transparency)};`
  );

  // Outline at ground level
  const outline = document.createElement('a-entity');
  outline.setAttribute('line', `color: ${options.polygonStroke}; path: ${groundShape}; linewidth: ${options.polygonWidth}`);
  poly.appendChild(outline);

  // Vertical "fence" for spatial awareness in AR.
  const fenceHeight = 4; // meters above ground
  for (let i = 0; i < simplified.length; i++) {
    const current = simplified[i];
    const next = simplified[(i + 1) % simplified.length];
    const segment = document.createElement('a-entity');
    segment.setAttribute('data-fieldar', 'polygon-fence');
    const path = [
      `${current.east} 0 ${-current.north}`,
      `${next.east} 0 ${-next.north}`,
      `${next.east} ${fenceHeight} ${-next.north}`,
      `${current.east} ${fenceHeight} ${-current.north}`,
      `${current.east} 0 ${-current.north}`,
    ].join(',');
    segment.setAttribute(
      'line',
      `color: ${options.polygonStroke}; path: ${path}; linewidth: ${Math.max(1, options.polygonWidth)};`
    );
    poly.appendChild(segment);
  }

  scene.appendChild(poly);
}
