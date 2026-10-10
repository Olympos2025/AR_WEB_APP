import {distance, normalized} from './domain.mjs';

export function rankPlaces(places, query, origin) {
  const target = normalized(query);
  const relevance = place => {
    const name = normalized(place.name || place.label.split(',')[0]);
    return name === target ? 0 : name.startsWith(target) ? 1 : 2;
  };
  return [...places].sort((a, b) => relevance(a) - relevance(b) || distance(origin, a) - distance(origin, b));
}
