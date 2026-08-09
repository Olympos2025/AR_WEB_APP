import * as THREE from 'three';
import { LatLon, toENU } from '../geo/geoUtils';

/**
 * Pilot feature: drapes raster map tiles (streets / topo / imagery) on the
 * local ground plane around the user, so the basemap shows up through the
 * camera in correct geographic alignment.
 */

export type BasemapKey = 'none' | 'streets' | 'topo' | 'imagery';

interface TileProvider {
  url: (z: number, x: number, y: number) => string;
  zoom: number;
  attribution: string;
}

export const AR_BASEMAPS: Record<Exclude<BasemapKey, 'none'>, TileProvider> = {
  streets: {
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    zoom: 18,
    attribution: '© OpenStreetMap contributors',
  },
  topo: {
    url: (z, x, y) => `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`,
    zoom: 16,
    attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)',
  },
  imagery: {
    url: (z, x, y) =>
      `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    zoom: 18,
    attribution: '© Esri & contributors',
  },
};

const RADIUS_METERS = 260;
const REFRESH_DISTANCE_METERS = 60;
const TERRAIN_SEGMENTS = 8;
const EARTH_RADIUS = 6371000;

type ElevationSampler = (lat: number, lon: number) => Promise<number | null>;

export class BasemapGround {
  readonly group = new THREE.Group();
  private readonly loader = new THREE.TextureLoader();
  private tiles = new Map<string, THREE.Mesh>();
  private key: BasemapKey = 'none';
  private opacity = 0.85;
  private origin: LatLon | null = null;
  private lastCenter: LatLon | null = null;
  private elevationSampler: ElevationSampler | null = null;
  private originElevation: number | null = null;

  constructor() {
    this.group.name = 'fieldar-basemap';
    this.loader.setCrossOrigin('anonymous');
  }

  setOrigin(origin: LatLon) {
    this.origin = origin;
    this.lastCenter = null;
  }

  /** Enable 3D terrain-following tiles; pass null to go back to a flat carpet. */
  setTerrain(sampler: ElevationSampler | null, originElevation: number | null) {
    const changed = (sampler !== null) !== (this.elevationSampler !== null) ||
      originElevation !== this.originElevation;
    this.elevationSampler = sampler;
    this.originElevation = originElevation;
    if (changed) {
      this.clear();
      this.lastCenter = null;
    }
  }

  setBasemap(key: BasemapKey) {
    if (key === this.key) return;
    this.key = key;
    this.clear();
    this.lastCenter = null;
  }

  setOpacity(opacity: number) {
    this.opacity = opacity;
    this.tiles.forEach((mesh) => {
      (mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    });
  }

  /** Rebuild the tile carpet when the user has moved far enough. */
  update(position: LatLon) {
    if (!this.origin || this.key === 'none') return;
    if (this.lastCenter) {
      const enu = toENU(this.lastCenter, position);
      if (Math.hypot(enu.east, enu.north) < REFRESH_DISTANCE_METERS) return;
    }
    this.lastCenter = position;
    this.rebuildTiles(position);
  }

  dispose() {
    this.clear();
  }

  private clear() {
    this.tiles.forEach((mesh) => this.disposeTile(mesh));
    this.tiles.clear();
  }

  private disposeTile(mesh: THREE.Mesh) {
    this.group.remove(mesh);
    mesh.geometry.dispose();
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
  }

  private rebuildTiles(center: LatLon) {
    const provider = AR_BASEMAPS[this.key as Exclude<BasemapKey, 'none'>];
    const zoom = provider.zoom;
    const scale = 2 ** zoom;
    const centerX = lonToTileX(center.lon, scale);
    const centerY = latToTileY(center.lat, scale);

    const tileWidthMeters = (40075016.686 * Math.cos((center.lat * Math.PI) / 180)) / scale;
    const range = Math.max(1, Math.ceil(RADIUS_METERS / tileWidthMeters));

    const wanted = new Set<string>();
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        const x = Math.floor(centerX) + dx;
        const y = Math.floor(centerY) + dy;
        if (x < 0 || y < 0 || x >= scale || y >= scale) continue;
        const id = `${this.key}/${zoom}/${x}/${y}`;
        wanted.add(id);
        if (!this.tiles.has(id)) {
          this.addTile(id, provider, zoom, x, y, scale);
        }
      }
    }

    Array.from(this.tiles.keys()).forEach((id) => {
      if (!wanted.has(id)) {
        this.disposeTile(this.tiles.get(id)!);
        this.tiles.delete(id);
      }
    });
  }

  private addTile(id: string, provider: TileProvider, zoom: number, x: number, y: number, scale: number) {
    if (!this.origin) return;
    const west = tileXToLon(x, scale);
    const east = tileXToLon(x + 1, scale);
    const north = tileYToLat(y, scale);
    const south = tileYToLat(y + 1, scale);

    const nw = toENU(this.origin, { lat: north, lon: west });
    const se = toENU(this.origin, { lat: south, lon: east });
    const width = se.east - nw.east;
    const height = nw.north - se.north;
    const centerEast = (nw.east + se.east) / 2;
    const centerNorth = (nw.north + se.north) / 2;

    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: this.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const useTerrain = this.elevationSampler !== null && this.originElevation !== null;
    const geometry = new THREE.PlaneGeometry(
      width,
      height,
      useTerrain ? TERRAIN_SEGMENTS : 1,
      useTerrain ? TERRAIN_SEGMENTS : 1
    );
    // Lay the plane on the ground: local (x, y) -> world (east, -north offset).
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(centerEast, -0.2, -centerNorth);
    mesh.renderOrder = -10;
    mesh.visible = false;

    this.loader.load(provider.url(zoom, x, y), (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      material.map = texture;
      material.needsUpdate = true;
      mesh.visible = true;
    });

    if (useTerrain) {
      void this.applyTerrainHeights(id, mesh, centerEast, centerNorth);
    }

    this.tiles.set(id, mesh);
    this.group.add(mesh);
  }

  /** Lift each grid vertex of the tile onto the DEM surface. */
  private async applyTerrainHeights(
    id: string,
    mesh: THREE.Mesh,
    centerEast: number,
    centerNorth: number
  ) {
    const sampler = this.elevationSampler;
    const originElevation = this.originElevation;
    const origin = this.origin;
    if (!sampler || originElevation === null || !origin) return;

    const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const latRad = (origin.lat * Math.PI) / 180;
    const points: Array<{ lat: number; lon: number }> = [];
    for (let i = 0; i < positions.count; i++) {
      const east = centerEast + positions.getX(i);
      const north = centerNorth - positions.getZ(i);
      points.push({
        lat: origin.lat + (north / EARTH_RADIUS) * (180 / Math.PI),
        lon: origin.lon + (east / (EARTH_RADIUS * Math.cos(latRad))) * (180 / Math.PI),
      });
    }
    const elevations = await Promise.all(points.map((p) => sampler(p.lat, p.lon)));
    if (this.tiles.get(id) !== mesh) return; // tile was replaced meanwhile
    for (let i = 0; i < positions.count; i++) {
      const elev = elevations[i];
      if (elev !== null) positions.setY(i, elev - originElevation);
    }
    positions.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  }
}

function lonToTileX(lon: number, scale: number): number {
  return ((lon + 180) / 360) * scale;
}

function latToTileY(lat: number, scale: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale;
}

function tileXToLon(x: number, scale: number): number {
  return (x / scale) * 360 - 180;
}

function tileYToLat(y: number, scale: number): number {
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
