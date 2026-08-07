import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LatLon, toENU } from '../geo/geoUtils';
import { LayerData, LayerStyle, featureLabel } from '../state/layerTypes';
import { createLabelSprite } from './labelSprite';

/**
 * Builds THREE content for geospatial layers in a local world frame anchored at
 * `origin`: +X = east, +Y = up, -Z = north. Every vertex of every geometry is
 * converted individually, so lines and polygons keep their full shape.
 */

export interface BuiltLayers {
  group: THREE.Group;
  lineMaterials: LineMaterial[];
  featureCount: number;
}

interface BuildContext {
  origin: LatLon;
  style: LayerStyle;
  useAltitudes: boolean;
  lineMaterials: LineMaterial[];
  group: THREE.Group;
}

export function buildLayers(
  layers: LayerData[],
  origin: LatLon,
  useAltitudes: boolean
): BuiltLayers {
  const root = new THREE.Group();
  root.name = 'fieldar-layers';
  const lineMaterials: LineMaterial[] = [];
  let featureCount = 0;

  layers.forEach((layer) => {
    if (!layer.visible) return;
    const group = new THREE.Group();
    group.name = layer.id;
    const ctx: BuildContext = { origin, style: layer.style, useAltitudes, lineMaterials, group };
    layer.geojson.features.forEach((feature) => {
      if (!feature.geometry) return;
      buildFeature(feature, ctx);
      featureCount += 1;
    });
    root.add(group);
  });

  return { group: root, lineMaterials, featureCount };
}

function toWorld(ctx: BuildContext, position: number[]): THREE.Vector3 {
  const [lon, lat, alt] = position;
  const hasAlt = ctx.useAltitudes && typeof alt === 'number' && !Number.isNaN(alt) && alt !== 0;
  const enu = toENU(ctx.origin, { lat, lon, alt: hasAlt ? alt : ctx.origin.alt ?? 0 });
  // Features without usable altitude are draped on the local ground plane (y=0).
  return new THREE.Vector3(enu.east, hasAlt ? enu.up : 0, -enu.north);
}

function buildFeature(feature: GeoJSON.Feature, ctx: BuildContext) {
  const geometry = feature.geometry;
  const label = ctx.style.showLabels ? featureLabel(feature, ctx.style) : '';

  switch (geometry.type) {
    case 'Point':
      addPoint(ctx, geometry.coordinates, label);
      break;
    case 'MultiPoint':
      geometry.coordinates.forEach((coords, i) => addPoint(ctx, coords, i === 0 ? label : ''));
      break;
    case 'LineString':
      addLine(ctx, geometry.coordinates, label);
      break;
    case 'MultiLineString':
      geometry.coordinates.forEach((coords, i) => addLine(ctx, coords, i === 0 ? label : ''));
      break;
    case 'Polygon':
      addPolygon(ctx, geometry.coordinates, label);
      break;
    case 'MultiPolygon':
      geometry.coordinates.forEach((rings, i) => addPolygon(ctx, rings, i === 0 ? label : ''));
      break;
    default:
      break;
  }
}

function addPoint(ctx: BuildContext, position: number[], label: string) {
  const world = toWorld(ctx, position);
  const radius = 0.5 * ctx.style.pointSize;
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 14),
    new THREE.MeshBasicMaterial({
      color: ctx.style.pointColor,
      transparent: true,
      opacity: ctx.style.opacity,
      depthTest: false,
    })
  );
  sphere.position.copy(world).setY(world.y + radius);
  sphere.renderOrder = 10;
  ctx.group.add(sphere);

  // Vertical pin so ground points stay visible from afar.
  const pin = buildLine(
    ctx,
    [world.clone().setY(world.y), world.clone().setY(world.y + 6)],
    ctx.style.pointColor,
    Math.max(1.5, ctx.style.lineWidth / 2)
  );
  ctx.group.add(pin);

  addLabel(ctx, label, world.clone().setY(world.y + 7));
}

function addLine(ctx: BuildContext, coordinates: number[][], label: string) {
  if (coordinates.length < 2) return;
  const points = coordinates.map((c) => toWorld(ctx, c));
  ctx.group.add(buildLine(ctx, points, ctx.style.lineColor, ctx.style.lineWidth));

  // Small vertex markers make individual nodes visible on site.
  addVertexMarkers(ctx, points, ctx.style.lineColor);

  const mid = points[Math.floor(points.length / 2)];
  addLabel(ctx, label, mid.clone().setY(mid.y + 2));
}

function addPolygon(ctx: BuildContext, rings: number[][][], label: string) {
  if (!rings.length || rings[0].length < 3) return;
  const worldRings = rings.map((ring) => {
    const points = ring.map((c) => toWorld(ctx, c));
    // Drop a duplicated closing vertex.
    if (points.length > 1 && points[0].distanceToSquared(points[points.length - 1]) < 1e-8) {
      points.pop();
    }
    return points;
  });
  const [outer, ...holes] = worldRings;
  if (outer.length < 3) return;

  // Triangulate on the ground plane (x = east, z = -north -> use -z as "north").
  const contour = outer.map((p) => new THREE.Vector2(p.x, -p.z));
  const validHoles = holes.filter((ring) => ring.length >= 3);
  const holeContours = validHoles.map((ring) => ring.map((p) => new THREE.Vector2(p.x, -p.z)));

  let triangles: number[][] = [];
  try {
    triangles = THREE.ShapeUtils.triangulateShape(contour, holeContours);
  } catch {
    triangles = [];
  }

  if (triangles.length) {
    const allPoints = [...outer, ...validHoles.flat()];
    const positions = new Float32Array(allPoints.length * 3);
    allPoints.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y + 0.05; // avoid z-fighting with the basemap plane
      positions[i * 3 + 2] = p.z;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(triangles.flat());
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: ctx.style.polygonFill,
        transparent: true,
        opacity: ctx.style.polygonOpacity * ctx.style.opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    mesh.renderOrder = 2;
    ctx.group.add(mesh);
  }

  // Outline every ring, closing the loop, and mark the vertices.
  worldRings.forEach((ring) => {
    if (ring.length < 2) return;
    const closed = [...ring, ring[0]];
    ctx.group.add(buildLine(ctx, closed, ctx.style.polygonStroke, ctx.style.polygonWidth));
    addVertexMarkers(ctx, ring, ctx.style.polygonStroke);
  });

  const centroid = outer
    .reduce((acc, p) => acc.add(p), new THREE.Vector3())
    .divideScalar(outer.length);
  addLabel(ctx, label, centroid.setY(centroid.y + 2));
}

function buildLine(
  ctx: BuildContext,
  points: THREE.Vector3[],
  color: string,
  width: number
): Line2 {
  const geometry = new LineGeometry();
  geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  const material = new LineMaterial({
    color: new THREE.Color(color).getHex(),
    linewidth: width, // pixels (worldUnits: false)
    transparent: true,
    opacity: ctx.style.opacity,
    depthTest: false,
  });
  material.worldUnits = false;
  ctx.lineMaterials.push(material);
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  line.renderOrder = 5;
  return line;
}

function addVertexMarkers(ctx: BuildContext, points: THREE.Vector3[], color: string) {
  if (points.length > 400) return; // keep very dense geometries light
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map((p) => p.clone().setY(p.y + 0.05))
  );
  const material = new THREE.PointsMaterial({
    color,
    size: 6,
    sizeAttenuation: false,
    transparent: true,
    opacity: ctx.style.opacity,
    depthTest: false,
  });
  const markers = new THREE.Points(geometry, material);
  markers.renderOrder = 6;
  ctx.group.add(markers);
}

function addLabel(ctx: BuildContext, label: string, position: THREE.Vector3) {
  if (!label) return;
  const sprite = createLabelSprite(label, ctx.style.labelColor, ctx.style.labelSize);
  if (!sprite) return;
  sprite.position.copy(position);
  ctx.group.add(sprite);
}

/** Recursively dispose geometries, materials and textures of a built group. */
export function disposeGroup(group: THREE.Object3D) {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function disposeMaterial(material: THREE.Material) {
  const textured = material as THREE.Material & { map?: THREE.Texture | null };
  if (textured.map) textured.map.dispose();
  material.dispose();
}
