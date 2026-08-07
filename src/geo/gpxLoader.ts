/**
 * Minimal GPX -> GeoJSON converter covering waypoints (wpt), routes (rte)
 * and tracks (trk/trkseg), including elevation when present.
 */
export function parseGpxString(text: string): GeoJSON.FeatureCollection {
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  if (dom.getElementsByTagName('parsererror').length) {
    throw new Error('INVALID_GPX');
  }

  const features: GeoJSON.Feature[] = [];

  Array.from(dom.getElementsByTagName('wpt')).forEach((wpt, index) => {
    const position = readPosition(wpt);
    if (!position) return;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: position },
      properties: readMeta(wpt, `Waypoint ${index + 1}`),
    });
  });

  Array.from(dom.getElementsByTagName('rte')).forEach((rte, index) => {
    const coordinates = Array.from(rte.getElementsByTagName('rtept'))
      .map(readPosition)
      .filter(Boolean) as number[][];
    if (coordinates.length < 2) return;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: readMeta(rte, `Route ${index + 1}`),
    });
  });

  Array.from(dom.getElementsByTagName('trk')).forEach((trk, index) => {
    const segments = Array.from(trk.getElementsByTagName('trkseg'))
      .map((seg) =>
        Array.from(seg.getElementsByTagName('trkpt'))
          .map(readPosition)
          .filter(Boolean) as number[][]
      )
      .filter((coords) => coords.length >= 2);
    if (!segments.length) return;
    const properties = readMeta(trk, `Track ${index + 1}`);
    if (segments.length === 1) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: segments[0] }, properties });
    } else {
      features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: segments }, properties });
    }
  });

  return { type: 'FeatureCollection', features };
}

function readPosition(el: Element): number[] | null {
  const lat = Number(el.getAttribute('lat'));
  const lon = Number(el.getAttribute('lon'));
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  const eleText = el.getElementsByTagName('ele')[0]?.textContent;
  const ele = eleText ? Number(eleText) : NaN;
  return Number.isNaN(ele) ? [lon, lat] : [lon, lat, ele];
}

function readMeta(el: Element, fallbackName: string): Record<string, unknown> {
  const name = directChildText(el, 'name') ?? fallbackName;
  const desc = directChildText(el, 'desc');
  const properties: Record<string, unknown> = { name };
  if (desc) properties.description = desc;
  return properties;
}

function directChildText(el: Element, tag: string): string | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName === tag) return child.textContent;
  }
  return null;
}
