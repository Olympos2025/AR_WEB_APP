/* eslint-disable @typescript-eslint/no-explicit-any */
import { LatLon, toENU } from '../geo/geoUtils';
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
  pointSymbol: 'sphere' | 'box' | 'cone';
  showLabels: boolean;
  heightOffset: number;
  simplifyTolerance: number;
  transparency: number;
}

export function ensureScene(): HTMLElement {
  let scene = document.querySelector('a-scene');
  if (!scene) {
    scene = document.createElement('a-scene');
    scene.setAttribute('embedded', '');
    scene.setAttribute('vr-mode-ui', 'enabled: false');
    scene.setAttribute('renderer', 'logarithmicDepthBuffer: true;');
    scene.setAttribute('arjs', 'sourceType: webcam; debugUIEnabled: false;');
    scene.innerHTML = '<a-entity gps-camera rotation-reader></a-entity>';
    document.body.appendChild(scene);
  }
  return scene as HTMLElement;
}

export function clearScene(scene: HTMLElement) {
  const children = scene.querySelectorAll('[data-fieldar]');
  children.forEach((c) => c.remove());
}

export function renderGeoJSON(
  scene: HTMLElement,
  origin: LatLon,
  collection: GeoJSON.FeatureCollection,
  options: OverlayOptions
) {
  clearScene(scene);
  collection.features.forEach((feature) => {
    if (!feature.geometry) return;
    renderGeometry(scene, origin, feature.geometry, feature.properties, options);
  });
}

function renderGeometry(
  scene: HTMLElement,
  origin: LatLon,
  geometry: GeoJSON.Geometry,
  properties: any,
  options: OverlayOptions
) {
  switch (geometry.type) {
    case 'Point':
      renderPoint(scene, origin, geometry, properties, options);
      break;
    case 'MultiPoint':
      geometry.coordinates.forEach(([lon, lat, alt]) =>
        renderPoint(scene, origin, { type: 'Point', coordinates: [lon, lat, alt] }, properties, options)
      );
      break;
    case 'LineString':
      renderLine(scene, origin, geometry, options);
      break;
    case 'MultiLineString':
      geometry.coordinates.forEach((coords) =>
        renderLine(scene, origin, { type: 'LineString', coordinates: coords }, options)
      );
      break;
    case 'Polygon':
      renderPolygon(scene, origin, geometry, options);
      break;
    case 'MultiPolygon':
      geometry.coordinates.forEach((coords) =>
        renderPolygon(scene, origin, { type: 'Polygon', coordinates: coords }, options)
      );
      break;
    default:
      break;
  }
}

function renderPoint(
  scene: HTMLElement,
  origin: LatLon,
  geometry: GeoJSON.Point,
  properties: any,
  options: OverlayOptions
) {
  const [lon, lat] = geometry.coordinates;
  const pos = toENU(origin, { lat, lon, alt: (geometry.coordinates[2] as number | undefined) || 0 });
  const entity = document.createElement('a-entity');
  entity.setAttribute('data-fieldar', 'point');
  entity.setAttribute('gps-entity-place', `latitude: ${lat}; longitude: ${lon};`);
  entity.setAttribute('position', `${pos.east} ${options.heightOffset + pos.up} ${-pos.north}`);
  const primitive = options.pointSymbol;
  const geometryProps =
    primitive === 'cone'
      ? 'primitive: cone; radiusBottom: 0.7; radiusTop: 0.1; height: 1.2'
      : primitive === 'box'
        ? 'primitive: box; depth: 1; height: 1; width: 1'
        : 'primitive: sphere; radius: 0.8';

  entity.setAttribute('geometry', geometryProps);
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

function renderLine(scene: HTMLElement, origin: LatLon, geometry: GeoJSON.LineString, options: OverlayOptions) {
  const points = geometry.coordinates.map(([lon, lat, alt]) => toENU(origin, { lat, lon, alt: alt || 0 }));
  const simplified = douglasPeucker(points.map(({ east, north }) => ({ east, north })), options.simplifyTolerance || 0);
  const finalPoints = simplified.map((p) => `${p.east} ${options.heightOffset} ${-p.north}`).join(',');
  const entity = document.createElement('a-entity');
  entity.setAttribute('data-fieldar', 'line');
  entity.setAttribute(
    'line',
    `color: ${options.lineColor}; path: ${finalPoints}; linewidth: ${options.lineWidth}; opacity: ${1 - options.transparency}`
  );
  scene.appendChild(entity);
}

function renderPolygon(scene: HTMLElement, origin: LatLon, geometry: GeoJSON.Polygon, options: OverlayOptions) {
  const [outer] = geometry.coordinates;
  const enu = outer.map(([lon, lat, alt]) => toENU(origin, { lat, lon, alt: alt || 0 }));
  const simplified = douglasPeucker(
    enu.map(({ east, north }) => ({ east, north } as Vec2)),
    options.simplifyTolerance || 0
  );
  const shape = simplified.map((p) => `${p.east} ${options.heightOffset} ${-p.north}`).join(',');

  const poly = document.createElement('a-entity');
  poly.setAttribute('data-fieldar', 'polygon');
  poly.setAttribute(
    'shape',
    `shape: ${shape}; color: ${options.polygonFill}; opacity: ${options.polygonOpacity * (1 - options.transparency)};`
  );
  const outline = document.createElement('a-entity');
  outline.setAttribute(
    'line',
    `color: ${options.polygonStroke}; path: ${shape}; linewidth: ${options.polygonWidth}; opacity: ${1 - options.transparency}`
  );
  poly.appendChild(outline);
  scene.appendChild(poly);
}
