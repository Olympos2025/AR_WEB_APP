import {distance,activeInterval} from './domain.mjs';
export const CITIES=[{key:'thessaloniki',label:'Θεσσαλονίκη',lat:40.632,lng:22.945},{key:'athens',label:'Αθήνα',lat:37.9755,lng:23.7348},{key:'patra',label:'Πάτρα',lat:38.2466,lng:21.7346},{key:'larisa',label:'Λάρισα',lat:39.639,lng:22.419},{key:'heraklio',label:'Ηράκλειο',lat:35.339,lng:25.134},{key:'ioannina',label:'Ιωάννινα',lat:39.665,lng:20.853}];
export const validPoint=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&p.lat>=34&&p.lat<=42&&p.lng>=19&&p.lng<=30;
export const cityFor=p=>CITIES.reduce((a,b)=>distance(p,a)<distance(p,b)?a:b);
export const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function rankRoutes(rows,routes,time,sort='eta'){
 const ranked=rows.map((r,i)=>{const route=routes?.[i],seconds=Number.isFinite(route?.seconds)?route.seconds:null,interval=activeInterval(r,time);return {...r,seconds,meters:route?.meters,reachable:seconds!==null&&r.open&&!!interval&&time+seconds*1000+300000<interval.end}});
 if(sort==='eta')ranked.sort((a,b)=>Number(b.reachable)-Number(a.reachable)||(a.seconds??Infinity)-(b.seconds??Infinity)||a.km-b.km);
 else ranked.sort((a,b)=>a.km-b.km);
 return ranked;
}
export function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}}
