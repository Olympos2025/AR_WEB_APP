import * as THREE from 'three';

/**
 * Adaptive orientation smoothing for handheld AR.
 *
 * The compass (yaw) is far noisier than the accelerometer/gyro tilt, so the
 * two are filtered separately: yaw goes through a One-Euro filter that damps
 * hard while the device is steady but opens up instantly during fast turns
 * (no perceptible lag); tilt gets a lighter adaptive low-pass. The result is
 * an overlay that sits still when you hold still and follows immediately
 * when you move.
 */

const UP = new THREE.Vector3(0, 1, 0);

function smoothingAlpha(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

export function shortestAngleDiff(target: number, from: number): number {
  let diff = (target - from) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

export function normalizeAngle(value: number): number {
  return ((value % 360) + 360) % 360;
}

/** One-Euro filter on a circular quantity (degrees), wrap-aware. */
export class OneEuroAngle {
  private initialized = false;
  private value = 0; // continuous (unwrapped) degrees
  private velocity = 0; // deg/s, low-passed

  constructor(
    private minCutoff: number, // Hz — smoothing at rest (lower = steadier)
    private beta: number, // extra cutoff per deg/s of motion (responsiveness)
    private dCutoff = 1 // Hz — smoothing of the velocity estimate
  ) {}

  filter(rawDeg: number, dt: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.value = rawDeg;
      this.velocity = 0;
      return normalizeAngle(this.value);
    }
    const diff = shortestAngleDiff(rawDeg, this.value);
    const rawVelocity = diff / dt;
    this.velocity += smoothingAlpha(this.dCutoff, dt) * (rawVelocity - this.velocity);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.velocity);
    this.value += smoothingAlpha(cutoff, dt) * diff;
    return normalizeAngle(this.value);
  }

  reset() {
    this.initialized = false;
    this.velocity = 0;
  }
}

export class OrientationSmoother {
  // Yaw: heavy damping at rest (compass jitter), fast during turns.
  private yawFilter = new OneEuroAngle(0.04, 0.03, 0.6);
  private tilt = new THREE.Quaternion();
  private hasTilt = false;
  private lastYawDeg: number | null = null;

  private readonly forward = new THREE.Vector3();
  private readonly yawQuat = new THREE.Quaternion();
  private readonly invYawQuat = new THREE.Quaternion();
  private readonly tiltTarget = new THREE.Quaternion();

  /** Filters `target` and writes the smoothed orientation into `out`. */
  apply(target: THREE.Quaternion, dt: number, out: THREE.Quaternion) {
    this.forward.set(0, 0, -1).applyQuaternion(target);

    let yawDeg: number;
    if (Math.abs(this.forward.y) < 0.98) {
      yawDeg = THREE.MathUtils.radToDeg(Math.atan2(this.forward.x, -this.forward.z));
      this.lastYawDeg = yawDeg;
    } else {
      // Looking almost straight up/down: yaw is ill-defined, keep the last one.
      yawDeg = this.lastYawDeg ?? 0;
    }
    const filteredYaw = this.yawFilter.filter(yawDeg, dt);

    // Split the raw orientation into yaw * tilt using the RAW yaw, then filter
    // the two parts independently.
    this.yawQuat.setFromAxisAngle(UP, THREE.MathUtils.degToRad(-yawDeg));
    this.invYawQuat.copy(this.yawQuat).invert();
    this.tiltTarget.copy(this.invYawQuat).multiply(target);

    if (!this.hasTilt) {
      this.hasTilt = true;
      this.tilt.copy(this.tiltTarget);
    } else {
      const angleDeg = THREE.MathUtils.radToDeg(this.tilt.angleTo(this.tiltTarget));
      const speed = angleDeg / dt;
      const cutoff = 0.3 + 0.05 * speed; // light damping, opens with motion
      this.tilt.slerp(this.tiltTarget, Math.min(smoothingAlpha(cutoff, dt), 1));
    }

    this.yawQuat.setFromAxisAngle(UP, THREE.MathUtils.degToRad(-filteredYaw));
    out.copy(this.yawQuat).multiply(this.tilt);
  }

  reset() {
    this.yawFilter.reset();
    this.hasTilt = false;
    this.lastYawDeg = null;
  }
}
