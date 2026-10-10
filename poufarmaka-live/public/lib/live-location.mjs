import {distance} from './domain.mjs';

// Keep native position updates alive until cancellation or revoked permission.
export function watchLocation(geolocation, {signal, onPosition, onError}) {
  let stopped=false, id;
  const stop=()=>{stopped=true;if(id!==undefined){geolocation.clearWatch(id);id=undefined}signal?.removeEventListener('abort',stop)};
  if(signal?.aborted)return stop;
  signal?.addEventListener('abort',stop,{once:true});
  try {
    id=geolocation.watchPosition(position=>{
      if(stopped)return;
      const c=position?.coords;
      if(!c||![c.latitude,c.longitude,c.accuracy].every(Number.isFinite)||Math.abs(c.latitude)>90||Math.abs(c.longitude)>180||c.accuracy<0)return;
      onPosition(position);
    },error=>{
      if(stopped)return;
      if(error.code===1)stop();
      onError(error);
    },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    if(stopped&&id!==undefined){geolocation.clearWatch(id);id=undefined}
  }catch(error){stop();onError(error)}
  return stop;
}

// The map gets every fix. Refresh routes only after useful movement, avoiding
// a new route request for every GPS jitter event while standing still.
export function shouldRefreshSearch(previous, next, now) {
  if(!previous)return true;
  const metres=distance(previous.position,next)*1000;
  const elapsed=now-previous.at;
  return (elapsed>=5000&&metres>=50)||(elapsed>=15000&&metres>=15)||
    (elapsed>=5000&&previous.position.accuracy>1000&&next.accuracy<100);
}
