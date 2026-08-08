import { LatLon } from './geoUtils';

/**
 * Accuracy-weighted GPS filter (1D Kalman per axis, shared variance).
 *
 * Every fix is weighted by its reported accuracy: precise fixes pull the
 * estimate strongly, imprecise ones barely move it, and implausible jumps are
 * heavily discounted. The estimate therefore converges automatically as the
 * receiver's accuracy improves over time — no user input needed — while still
 * following the user when they walk (process noise).
 */

export interface GpsSample {
  lat: number;
  lon: number;
  alt: number;
  accuracy: number; // meters, 1-sigma as reported by the device
  timestamp: number; // ms
}

export interface FilteredFix extends LatLon {
  alt: number;
  /** 1-sigma uncertainty of the estimate in meters (improves over time). */
  estimatedAccuracy: number;
}

const EARTH_RADIUS = 6371000;
// Process noise: how fast uncertainty grows between fixes. Sized for walking.
const PROCESS_NOISE = 2.25; // (1.5 m/s)^2 -> m^2 per second
const MIN_ACCURACY = 3; // meters; phones over-report confidence below this

export class GpsFilter {
  private refLat: number | null = null;
  private refLon: number | null = null;
  private east = 0;
  private north = 0;
  private variance = 0; // m^2
  private alt = 0;
  private lastTimestamp: number | null = null;

  reset() {
    this.refLat = null;
    this.refLon = null;
    this.lastTimestamp = null;
  }

  get current(): FilteredFix | null {
    if (this.refLat === null || this.refLon === null) return null;
    return this.toFix();
  }

  update(sample: GpsSample): FilteredFix {
    const accuracy = Math.max(sample.accuracy || 30, MIN_ACCURACY);
    const measurementVariance = accuracy * accuracy;

    if (this.refLat === null || this.refLon === null) {
      this.refLat = sample.lat;
      this.refLon = sample.lon;
      this.east = 0;
      this.north = 0;
      this.alt = sample.alt;
      this.variance = measurementVariance;
      this.lastTimestamp = sample.timestamp;
      return this.toFix();
    }

    const dt = Math.min(
      Math.max((sample.timestamp - (this.lastTimestamp ?? sample.timestamp)) / 1000, 0.05),
      10
    );
    this.lastTimestamp = sample.timestamp;
    this.variance += PROCESS_NOISE * dt;

    const [sampleEast, sampleNorth] = this.toMeters(sample.lat, sample.lon);
    const jump = Math.hypot(sampleEast - this.east, sampleNorth - this.north);
    // Gate implausible jumps: distrust them instead of dropping them entirely,
    // so the filter still recovers if the user genuinely moved fast.
    const gate = 3 * Math.sqrt(this.variance) + 2 * accuracy;
    const effectiveVariance = jump > gate ? jump * jump : measurementVariance;

    const gain = this.variance / (this.variance + effectiveVariance);
    this.east += gain * (sampleEast - this.east);
    this.north += gain * (sampleNorth - this.north);
    this.variance *= 1 - gain;
    this.alt += 0.3 * (sample.alt - this.alt);

    return this.toFix();
  }

  private toMeters(lat: number, lon: number): [number, number] {
    const latRad = ((this.refLat ?? 0) * Math.PI) / 180;
    const east = (((lon - (this.refLon ?? 0)) * Math.PI) / 180) * EARTH_RADIUS * Math.cos(latRad);
    const north = (((lat - (this.refLat ?? 0)) * Math.PI) / 180) * EARTH_RADIUS;
    return [east, north];
  }

  private toFix(): FilteredFix {
    const latRad = ((this.refLat ?? 0) * Math.PI) / 180;
    const lat = (this.refLat ?? 0) + (this.north / EARTH_RADIUS) * (180 / Math.PI);
    const lon =
      (this.refLon ?? 0) + (this.east / (EARTH_RADIUS * Math.cos(latRad))) * (180 / Math.PI);
    return { lat, lon, alt: this.alt, estimatedAccuracy: Math.sqrt(this.variance) };
  }
}
