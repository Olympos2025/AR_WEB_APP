/**
 * Terrain elevations from the AWS Open Data "terrarium" tiles
 * (https://registry.opendata.aws/terrain-tiles/) — free, no API key.
 * Elevation is encoded in PNG channels: (R*256 + G + B/256) - 32768 meters.
 *
 * Tiles are fetched once, decoded to ImageData and cached, so sampling
 * thousands of vertices in the same area costs a handful of requests.
 */

const TILE_SIZE = 256;
const ZOOM = 14; // ~7-10 m/pixel at mid latitudes

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export class ElevationService {
  private tiles = new Map<string, Promise<ImageData | null>>();

  async elevationAt(lat: number, lon: number): Promise<number | null> {
    const scale = 2 ** ZOOM;
    const xf = ((lon + 180) / 360) * scale;
    const latRad = (lat * Math.PI) / 180;
    const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
    const tileX = Math.floor(xf);
    const tileY = Math.floor(yf);
    if (tileX < 0 || tileY < 0 || tileX >= scale || tileY >= scale) return null;

    const image = await this.tile(tileX, tileY);
    if (!image) return null;

    // Bilinear sample inside the tile (clamped at the borders).
    const px = Math.min(Math.max((xf - tileX) * TILE_SIZE - 0.5, 0), TILE_SIZE - 1);
    const py = Math.min(Math.max((yf - tileY) * TILE_SIZE - 0.5, 0), TILE_SIZE - 1);
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = Math.min(x0 + 1, TILE_SIZE - 1);
    const y1 = Math.min(y0 + 1, TILE_SIZE - 1);
    const fx = px - x0;
    const fy = py - y0;

    const at = (x: number, y: number) => {
      const i = (y * TILE_SIZE + x) * 4;
      return decodeTerrarium(image.data[i], image.data[i + 1], image.data[i + 2]);
    };

    const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
    const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
    return top * (1 - fy) + bottom * fy;
  }

  async sampleMany(points: Array<{ lat: number; lon: number }>): Promise<Array<number | null>> {
    return Promise.all(points.map((p) => this.elevationAt(p.lat, p.lon)));
  }

  private tile(x: number, y: number): Promise<ImageData | null> {
    const key = `${ZOOM}/${x}/${y}`;
    let promise = this.tiles.get(key);
    if (!promise) {
      promise = fetchTileImage(
        `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${x}/${y}.png`
      );
      this.tiles.set(key, promise);
    }
    return promise;
  }
}

async function fetchTileImage(url: string): Promise<ImageData | null> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  } catch {
    return null;
  }
}
