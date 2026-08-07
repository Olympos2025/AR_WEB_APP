declare module 'shpjs' {
  type ShpFeatureCollection = GeoJSON.FeatureCollection & { fileName?: string };

  export function parseShp(
    buffer: ArrayBuffer | Uint8Array,
    prj?: string | false
  ): GeoJSON.Geometry[];
  export function parseDbf(
    buffer: ArrayBuffer | Uint8Array,
    cpg?: string
  ): Record<string, unknown>[];
  export function combine(
    data: [GeoJSON.Geometry[], Record<string, unknown>[]]
  ): ShpFeatureCollection;
  export function parseZip(
    buffer: ArrayBuffer | Uint8Array
  ): Promise<ShpFeatureCollection | ShpFeatureCollection[]>;

  export default function shp(
    input: ArrayBuffer | Uint8Array | string
  ): Promise<ShpFeatureCollection | ShpFeatureCollection[]>;
}
