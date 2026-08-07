import proj4 from 'proj4';
import shp, { parseShp, parseDbf, combine } from 'shpjs';
import { parseKmlOrKmz } from './kmlLoader';
import { parseGpxString } from './gpxLoader';

export interface ParsedLayer {
  name: string;
  sourceFormat: string;
  geojson: GeoJSON.FeatureCollection;
}

// GGRS87 / Greek Grid — very common CRS for Greek geospatial data.
const EPSG_2100 =
  '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs';
proj4.defs('EPSG:2100', EPSG_2100);

const SHAPEFILE_PARTS = ['shp', 'dbf', 'prj', 'shx', 'cpg'];

/**
 * Parse a set of user-selected files into geospatial layers (WGS84 GeoJSON).
 * Shapefile sidecars (.shp/.dbf/.prj/...) that share a basename are combined
 * into a single layer; every other file becomes its own layer.
 */
export async function parseFiles(files: File[]): Promise<ParsedLayer[]> {
  const layers: ParsedLayer[] = [];
  const shapefileGroups = new Map<string, Map<string, File>>();

  for (const file of files) {
    const ext = extensionOf(file.name);
    if (SHAPEFILE_PARTS.includes(ext)) {
      const base = file.name.slice(0, -(ext.length + 1)).toLowerCase();
      if (!shapefileGroups.has(base)) shapefileGroups.set(base, new Map());
      shapefileGroups.get(base)!.set(ext, file);
      continue;
    }
    layers.push(await parseSingleFile(file, ext));
  }

  for (const [base, parts] of shapefileGroups) {
    layers.push(await parseLooseShapefile(base, parts));
  }

  return layers;
}

async function parseSingleFile(file: File, ext: string): Promise<ParsedLayer> {
  const name = baseName(file.name);
  switch (ext) {
    case 'kml':
    case 'kmz':
      return { name, sourceFormat: ext, geojson: normalize(await parseKmlOrKmz(file)) };
    case 'geojson':
    case 'json': {
      const geojson = parseGeoJson(await file.text());
      return { name, sourceFormat: 'geojson', geojson: normalize(geojson) };
    }
    case 'gpx':
      return { name, sourceFormat: 'gpx', geojson: normalize(parseGpxString(await file.text())) };
    case 'zip': {
      const parsed = await shp(await file.arrayBuffer());
      const collections = Array.isArray(parsed) ? parsed : [parsed];
      const merged: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: collections.flatMap((c) => c.features ?? []),
      };
      return { name, sourceFormat: 'shapefile', geojson: normalize(merged) };
    }
    default:
      throw new Error(`UNSUPPORTED_FORMAT:${ext}`);
  }
}

async function parseLooseShapefile(base: string, parts: Map<string, File>): Promise<ParsedLayer> {
  const shpFile = parts.get('shp');
  if (!shpFile) {
    throw new Error('SHAPEFILE_MISSING_SHP');
  }
  const prj = parts.has('prj') ? await parts.get('prj')!.text() : undefined;
  const cpg = parts.has('cpg') ? await parts.get('cpg')!.text() : undefined;
  const geometries = parseShp(await shpFile.arrayBuffer(), prj);
  const properties = parts.has('dbf')
    ? parseDbf(await parts.get('dbf')!.arrayBuffer(), cpg)
    : geometries.map(() => ({}));
  const collection = combine([geometries, properties]) as GeoJSON.FeatureCollection;
  const geojson = prj ? collection : reprojectIfNeeded(collection);
  return { name: base, sourceFormat: 'shapefile', geojson: normalize(geojson) };
}

export function parseGeoJson(text: string): GeoJSON.FeatureCollection {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('INVALID_JSON');
  }
  const collection = toFeatureCollection(raw);
  return reprojectIfNeeded(collection, detectCrs(raw));
}

function toFeatureCollection(raw: unknown): GeoJSON.FeatureCollection {
  const obj = raw as { type?: string; features?: GeoJSON.Feature[]; geometry?: GeoJSON.Geometry };
  if (obj?.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    return { type: 'FeatureCollection', features: obj.features };
  }
  if (obj?.type === 'Feature' && obj.geometry) {
    return { type: 'FeatureCollection', features: [obj as unknown as GeoJSON.Feature] };
  }
  if (obj?.type && ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection'].includes(obj.type)) {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: obj as unknown as GeoJSON.Geometry, properties: {} }],
    };
  }
  throw new Error('INVALID_GEOJSON');
}

function detectCrs(raw: unknown): string | null {
  const crs = (raw as { crs?: { properties?: { name?: string } } })?.crs?.properties?.name;
  if (!crs) return null;
  const match = /EPSG:*:*(\d+)/i.exec(crs);
  return match ? `EPSG:${match[1]}` : null;
}

/**
 * Reproject projected coordinates back to WGS84. Handles the declared CRS when
 * present; otherwise falls back to a Greek Grid (EPSG:2100) heuristic, since
 * coordinates far outside [-180, 180] cannot be geographic.
 */
export function reprojectIfNeeded(
  collection: GeoJSON.FeatureCollection,
  declaredCrs: string | null = null
): GeoJSON.FeatureCollection {
  const sample = firstCoordinate(collection);
  if (!sample) return collection;
  const [x, y] = sample;
  const looksGeographic = Math.abs(x) <= 180 && Math.abs(y) <= 90;

  let source: string | null = null;
  if (declaredCrs && declaredCrs !== 'EPSG:4326' && declaredCrs !== 'EPSG:CRS84') {
    source = declaredCrs;
  } else if (!looksGeographic) {
    if (x > 60_000 && x < 1_030_000 && y > 3_700_000 && y < 4_730_000) {
      source = 'EPSG:2100'; // Greek Grid heuristic
    } else {
      throw new Error('UNKNOWN_CRS');
    }
  }
  if (!source) return collection;

  let transform: proj4.Converter;
  try {
    transform = proj4(source, 'EPSG:4326');
  } catch {
    throw new Error('UNKNOWN_CRS');
  }

  const reprojectPosition = (position: number[]): number[] => {
    const [px, py, ...rest] = position;
    const [lon, lat] = transform.forward([px, py]);
    return [lon, lat, ...rest];
  };

  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => ({
      ...feature,
      geometry: feature.geometry ? mapGeometryPositions(feature.geometry, reprojectPosition) : feature.geometry,
    })),
  };
}

export function mapGeometryPositions(
  geometry: GeoJSON.Geometry,
  fn: (position: number[]) => number[]
): GeoJSON.Geometry {
  switch (geometry.type) {
    case 'Point':
      return { ...geometry, coordinates: fn(geometry.coordinates) };
    case 'MultiPoint':
    case 'LineString':
      return { ...geometry, coordinates: geometry.coordinates.map(fn) };
    case 'MultiLineString':
    case 'Polygon':
      return { ...geometry, coordinates: geometry.coordinates.map((ring) => ring.map(fn)) };
    case 'MultiPolygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((poly) => poly.map((ring) => ring.map(fn))),
      };
    case 'GeometryCollection':
      return { ...geometry, geometries: geometry.geometries.map((g) => mapGeometryPositions(g, fn)) };
    default:
      return geometry;
  }
}

function firstCoordinate(collection: GeoJSON.FeatureCollection): number[] | null {
  for (const feature of collection.features) {
    if (!feature.geometry) continue;
    const found = firstPosition(feature.geometry);
    if (found) return found;
  }
  return null;
}

function firstPosition(geometry: GeoJSON.Geometry): number[] | null {
  switch (geometry.type) {
    case 'Point':
      return geometry.coordinates;
    case 'MultiPoint':
    case 'LineString':
      return geometry.coordinates[0] ?? null;
    case 'MultiLineString':
    case 'Polygon':
      return geometry.coordinates[0]?.[0] ?? null;
    case 'MultiPolygon':
      return geometry.coordinates[0]?.[0]?.[0] ?? null;
    case 'GeometryCollection':
      for (const g of geometry.geometries) {
        const found = firstPosition(g);
        if (found) return found;
      }
      return null;
    default:
      return null;
  }
}

/** Drop empty features and explode GeometryCollections into plain features. */
export function normalize(collection: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  collection.features.forEach((feature) => {
    if (!feature?.geometry) return;
    if (feature.geometry.type === 'GeometryCollection') {
      feature.geometry.geometries.forEach((geometry, index) => {
        features.push({
          type: 'Feature',
          geometry,
          properties: { ...(feature.properties ?? {}), _part: index },
        });
      });
    } else {
      features.push(feature);
    }
  });
  return { type: 'FeatureCollection', features };
}

export function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : '';
}

function baseName(fileName: string): string {
  const ext = extensionOf(fileName);
  return ext ? fileName.slice(0, -(ext.length + 1)) : fileName;
}

export const ACCEPTED_EXTENSIONS =
  '.kml,.kmz,.geojson,.json,.gpx,.zip,.shp,.dbf,.prj,.shx,.cpg';
