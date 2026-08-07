import * as THREE from 'three';

/**
 * Converts DeviceOrientation events into a camera quaternion for a world frame
 * where +X = east, +Y = up, -Z = north (compass bearing 0° looks down -Z).
 *
 * On iOS `alpha` has an arbitrary origin, so we substitute the compass heading
 * (`webkitCompassHeading`) to keep the yaw georeferenced.
 */

export interface OrientationSample {
  alpha: number; // deg
  beta: number; // deg
  gamma: number; // deg
  compassHeading: number | null; // deg clockwise from north (iOS)
  absolute: boolean;
}

type OrientationEventWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number };

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
// - PI/2 around the x-axis: look out the back of the device, not the top.
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

export function orientationToQuaternion(
  target: THREE.Quaternion,
  sample: OrientationSample,
  screenAngleDeg: number,
  headingOffsetDeg: number
): THREE.Quaternion {
  const alphaDeg = sample.compassHeading !== null ? 360 - sample.compassHeading : sample.alpha;
  const alpha = THREE.MathUtils.degToRad(alphaDeg + headingOffsetDeg);
  const beta = THREE.MathUtils.degToRad(sample.beta);
  const gamma = THREE.MathUtils.degToRad(sample.gamma);
  const orient = THREE.MathUtils.degToRad(screenAngleDeg);

  euler.set(beta, alpha, -gamma, 'YXZ');
  target.setFromEuler(euler);
  target.multiply(q1);
  target.multiply(q0.setFromAxisAngle(zee, -orient));
  return target;
}

/** Compass heading (deg from north) the camera is currently facing. */
export function headingFromQuaternion(quaternion: THREE.Quaternion): number {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  // Project on the ground plane: north = -Z, east = +X.
  const heading = THREE.MathUtils.radToDeg(Math.atan2(forward.x, -forward.z));
  return (heading + 360) % 360;
}

export function screenAngle(): number {
  if (typeof screen !== 'undefined' && screen.orientation) {
    return screen.orientation.angle ?? 0;
  }
  const legacy = (window as Window & { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

export interface OrientationWatch {
  stop: () => void;
}

/**
 * Subscribes to the best available orientation event source.
 * Prefers `deviceorientationabsolute` (Android Chrome) for georeferenced yaw.
 */
export function watchOrientation(onSample: (sample: OrientationSample) => void): OrientationWatch {
  let sawAbsolute = false;

  const handleAbsolute = (event: DeviceOrientationEvent) => {
    if (event.alpha === null) return;
    sawAbsolute = true;
    onSample(toSample(event, true));
  };

  const handleRelative = (event: DeviceOrientationEvent) => {
    if (event.alpha === null) return;
    const compass = (event as OrientationEventWithCompass).webkitCompassHeading;
    // Ignore the non-absolute stream when an absolute source exists,
    // unless it carries an iOS compass heading.
    if (sawAbsolute && typeof compass !== 'number') return;
    onSample(toSample(event, event.absolute === true));
  };

  window.addEventListener('deviceorientationabsolute', handleAbsolute as EventListener, true);
  window.addEventListener('deviceorientation', handleRelative, true);

  return {
    stop: () => {
      window.removeEventListener('deviceorientationabsolute', handleAbsolute as EventListener, true);
      window.removeEventListener('deviceorientation', handleRelative, true);
    },
  };
}

function toSample(event: DeviceOrientationEvent, absolute: boolean): OrientationSample {
  const compass = (event as OrientationEventWithCompass).webkitCompassHeading;
  return {
    alpha: event.alpha ?? 0,
    beta: event.beta ?? 0,
    gamma: event.gamma ?? 0,
    compassHeading: typeof compass === 'number' && !Number.isNaN(compass) ? compass : null,
    absolute,
  };
}
