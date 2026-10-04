import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dns from 'dns/promises';
import net from 'net';
import { generateText } from 'ai';

const DIR=dirname(fileURLToPath(import.meta.url));
const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'1mb'}));
app.use(express.static(join(DIR,'public'),{maxAge:'1h'}));
const HOME=readFileSync(join(DIR,'public','index.html'),'utf8');
const GATEWAY_MODEL='perplexity/sonar';
const LOOKBACK_HOURS=8;
const MAX_RADIUS=80;
const VERSION='2.6.0';
const gc=new Map(), rc=new Map(), pc=new Map(), laneCache=new Map(), reverseInflight=new Map();
const CACHE_TTL_MS=5*60*1000;
const clean=s=>String(s??'').trim();
const hostOf=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return''}};
const norm=s=>clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9α-ωάέήίόύώϊϋΐΰ]+/giu,' ').trim();
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function hav(a,b,c,d){const R=6371,r=x=>x*Math.PI/180,dp=r(c-a),dl=r(d-b),q=Math.sin(dp/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(q))}
function mapsUrl(e){if(Number.isFinite(+e.lat)&&Number.isFinite(+e.lon))return `https://www.google.com/maps/search/?api=1&query=${+e.lat},${+e.lon}`;return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.venue,e.address].filter(Boolean).join(' '))}`}
function key(e){return [norm(e.title),norm(e.venue),clean(e.start).slice(0,13)].join('|')}
function publicItem(e,lat,lon){const x={...e}; for(const k of ['title','venue','address','start','end','acts','description','eventType','category','url','sourceName','venueUrl','imageUrl'])x[k]=clean(x[k]);x.lat=Number.isFinite(+x.lat)?+x.lat:null;x.lon=Number.isFinite(+x.lon)?+x.lon:null;x.distanceKm=x.lat!=null&&x.lon!=null?+hav(lat,lon,x.lat,x.lon).toFixed(1):null;x.mapsUrl=mapsUrl(x);x.sourceDomain=hostOf(x.url);return x}
function parseDate(s){if(!s)return null;const d=new Date(s);return isNaN(d)?null:d}
function timeRelevant(e,now=Date.now(),futureHours=48){
  const s=parseDate(e.start),end=parseDate(e.end);
  if(!s)return true;
  if(end&&end.getTime()<now)return false;
  const dt=s.getTime()-now;
  if(dt>futureHours*3600000)return false;
  if(dt>=0)return true;
  if(end&&end.getTime()>=now)return true;
  return dt>=-LOOKBACK_HOURS*3600000;
}
function dedupe(items){const out=[],seen=new Map();for(const raw of items){if(!raw?.title||!raw?.url)continue;const k=key(raw);if(seen.has(k)){const i=seen.get(k),old=out[i];out[i]={...raw,...old,imageUrl:old.imageUrl||raw.imageUrl,venueUrl:old.venueUrl||raw.venueUrl,description:old.description||raw.description,acts:old.acts||raw.acts,end:old.end||raw.end};}else{seen.set(k,out.length);out.push(raw)}}return out}
function sourceDiverse(items,maxPerDomain=3){const counts=new Map(),out=[],rest=[];for(const x of items){const d=x.sourceDomain||hostOf(x.url)||'other',n=counts.get(d)||0;if(n<maxPerDomain){counts.set(d,n+1);out.push(x)}else rest.push(x)}return [...out,...rest]}
function textFromResponse(j){if(typeof j?.output_text==='string')return j.output_text;let s='';for(const o of j?.output||[])for(const c of o?.content||[])if(typeof c?.text==='string')s+=c.text;return s}
function parseJson(text){const t=clean(text).replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();try{return JSON.parse(t)}catch{}const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a>=0&&b>a)return JSON.parse(t.slice(a,b+1));throw new Error('invalid_json')}
async function openaiSearch(prompt,max=10,timeoutMs=6000){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
    const result=await generateText({
      model:GATEWAY_MODEL,
      prompt,
      maxOutputTokens:2400,
      abortSignal:ctl.signal,
      providerOptions:{gateway:{tags:['app:pounapao','version:'+VERSION]}}
    });
    const p=parseJson(result.text);
    return Array.isArray(p?.items)?p.items.slice(0,max):[];
  }catch{return[]}
  finally{clearTimeout(timer)}
}
async function reverseGeocode(lat,lon,locale='en'){const k=`${(+lat).toFixed(3)},${(+lon).toFixed(3)},${locale}`;if(rc.has(k))return rc.get(k);if(reverseInflight.has(k))return reverseInflight.get(k);const work=(async()=>{try{const u=new URL('https://nominatim.openstreetmap.org/reverse');u.search=new URLSearchParams({format:'jsonv2',lat:String(lat),lon:String(lon),zoom:'10',addressdetails:'1','accept-language':locale}).toString();const r=await fetch(u,{signal:AbortSignal.timeout(2200),headers:{'user-agent':`PouNaPao/${VERSION} event discovery`}}),j=await r.json(),a=j.address||{};const v={city:a.city||a.town||a.village||a.municipality||a.county||'',region:a.state||a.region||'',country:a.country||'',countryCode:(a.country_code||'').toUpperCase(),display:j.display_name||''};rc.set(k,v);return v}catch{return{city:'',region:'',country:'',countryCode:'',display:''}}finally{reverseInflight.delete(k)}})();reverseInflight.set(k,work);return work}
async function geocode(q,locale='en'){const k=`${locale}|${norm(q)}`;if(gc.has(k))return gc.get(k);const u=new URL('https://nominatim.openstreetmap.org/search');u.search=new URLSearchParams({format:'jsonv2',q,limit:'5',addressdetails:'1','accept-language':locale}).toString();const r=await fetch(u,{headers:{'user-agent':`PouNaPao/${VERSION} event discovery`}}),j=await r.json();const out=(Array.isArray(j)?j:[]).map(x=>({lat:+x.lat,lon:+x.lon,label:x.display_name}));gc.set(k,out);return out}
async function ticketmaster(lat,lon,radiusKm){
  const now=new Date().toISOString();
  const prompt=`Current time UTC: ${now}. User coordinates ${lat},${lon}. Search within ${radiusKm} km. Find up to 8 very high-confidence events happening now or in the next 36 hours, prioritizing official venue calendars, official event pages, ticketing, concert halls, clubs, bars and festivals. Include events already started in the last ${LOOKBACK_HOURS} hours if likely still running. Return ONLY strict JSON {"items":[...]}. Each item: title, venue, address, start, end, acts, description, eventType, category, url, sourceName, venueUrl, imageUrl, lat, lon. Do not invent anything.`;
  return openaiSearch(prompt,8,3600);
}
function lanePrompt({lane,place,lat,lon,radiusKm,locale,timezone}){
 const now=new Date().toISOString();
 const common=`Current time UTC: ${now}. User coordinates ${lat},${lon}. Approximate place: ${place.city}, ${place.region}, ${place.country}. Timezone: ${timezone||'unknown'}. Search radius ${radiusKm} km. Search in the local language AND English. Return ONLY strict JSON {"items":[...]}. Every item must have: title, venue, address, start, end, acts, description, eventType, category, url, sourceName, venueUrl, imageUrl, lat, lon. Use exact source URLs. Do not invent events, coordinates, times or images. Include events that are UPCOMING in the next 48 hours AND events already started in the last ${LOOKBACK_HOURS} hours if they are likely still running. If an end time is available, include it and keep the event only if it has not ended. Public social-media pages may be used only when they are publicly indexed/searchable; preserve the exact Instagram/Facebook/TikTok URL as the source. Prefer official event/venue/ticketing/social pages. Keep descriptions under 120 characters.`;
 const lanes={
   events:`Find the strongest concrete local events now/tonight and within 48 hours: nightlife, parties, DJ sets, live music, concerts, festivals, theatre, exhibitions and notable local events. Prefer official venue/artist/organizer pages, ticketing, local calendars and publicly indexed social posts. Diversity matters: do not let one local guide dominate the list.`,
   social:`Focus only on concrete events evidenced by PUBLICLY INDEXED Instagram posts/Reels/pages, Facebook Events/Page posts, TikTok venue/event pages, and official venue social pages. Avoid generic profiles with no date/time/event detail.`,
   food:`Find food/drink destinations and event-like dining experiences: Τσιπουροκατάσταση, Τσιπουροκατάσταση + Live, Ταβέρνα/Taverna, Fine Dining. For Tsipouro + Live require evidence of live music. Restaurants may omit start/end and can be returned as destinations. Prefer official venue sites and official social pages.`
 };
 return `${common}\nTASK: ${lanes[lane]||lanes.events}\nReturn up to 10 high-confidence items. Prioritize accuracy and speed over exhaustiveness.`;
}
async function searchLane(body){
  const started=Date.now(),lat=+body.lat,lon=+body.lon,radiusKm=clamp(+body.radiusKm||20,5,MAX_RADIUS),locale=body.locale||'en',timezone=body.timezone||'UTC',lane=clean(body.lane||'events');
  if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error('bad_location');
  const bucket=`${(+lat).toFixed(2)}|${(+lon).toFixed(2)}|${radiusKm}|${locale}|${lane}`;
  const cached=laneCache.get(bucket);
  if(cached && Date.now()-cached.at<CACHE_TTL_MS) return {...cached.value,cached:true,durationMs:Date.now()-started};
  const blankPlace={city:'',region:'',country:'',countryCode:'',display:''};
  const place=lane==='fast'?blankPlace:await Promise.race([reverseGeocode(lat,lon,locale),new Promise(resolve=>setTimeout(()=>resolve(blankPlace),650))]);
  let raw=[];
  if(lane==='fast') raw=await ticketmaster(lat,lon,radiusKm);
  else {
    const timeout=lane==='social'?6200:lane==='food'?5000:4600;
    raw=await openaiSearch(lanePrompt({lane,place,lat,lon,radiusKm,locale,timezone}),10,timeout);
  }
  let items=dedupe(raw).map(e=>publicItem(e,lat,lon)).filter(e=>timeRelevant(e)).filter(e=>e.distanceKm==null||e.distanceKm<=radiusKm+2);
  items.sort((a,b)=>(a.distanceKm??999)-(b.distanceKm??999)||(parseDate(a.start)?.getTime()??1e20)-(parseDate(b.start)?.getTime()??1e20));
  const value={lane,place,radiusKm,items:sourceDiverse(items,2),lookbackHours:LOOKBACK_HOURS};
  laneCache.set(bucket,{at:Date.now(),value});
  return {...value,cached:false,durationMs:Date.now()-started};
}

function safeRemote(u){try{const x=new URL(u);if(!['http:','https:'].includes(x.protocol))return false;const h=x.hostname.toLowerCase();if(h==='localhost'||h.endsWith('.local')||net.isIP(h))return false;return true}catch{return false}}
async function metaImage(u){if(!safeRemote(u))return null;try{const h=hostOf(u);const addrs=await dns.lookup(h,{all:true});if(addrs.some(a=>net.isIP(a.address)))return null;const r=await fetch(u,{redirect:'follow',signal:AbortSignal.timeout(2600),headers:{'user-agent':`Mozilla/5.0 PouNaPao/${VERSION}`}});if(!r.ok)return null;const type=r.headers.get('content-type')||'';if(type.startsWith('image/'))return{mediaUrl:r.url,mediaType:'image'};const html=(await r.text()).slice(0,350000);const pats=[/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i,/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i,/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)/i];for(const p of pats){const m=html.match(p);if(m?.[1])return{mediaUrl:new URL(m[1],r.url).href,mediaType:'image'}}return null}catch{return null}}
app.get('/',(q,r)=>r.type('html').send(HOME));
app.get('/pnp/health',(q,r)=>r.json({ok:true,version:VERSION,staged:true,socialDiscovery:true,ongoing:true,lookbackHours:LOOKBACK_HOURS,search:true,ticketing:false,gateway:true}));
app.get('/pnp/config',(q,r)=>r.json({radiusKm:20,maxRadiusKm:MAX_RADIUS,lookbackHours:LOOKBACK_HOURS,version:VERSION}));
app.post('/pnp/geocode',async(q,r)=>{try{r.json({items:await geocode(clean(q.body?.q),q.body?.locale||'en')})}catch(e){r.status(500).json({error:e.message})}});
app.post('/pnp/search-lane',async(q,r)=>{try{r.set('cache-control','no-store');r.json(await searchLane(q.body||{}))}catch(e){r.status(400).json({error:e.message,items:[]})}});
app.post('/pnp/events',async(q,r)=>{try{const lanes=['fast','events','social','food'];const results=await Promise.allSettled(lanes.map(lane=>searchLane({...q.body,lane})));let all=[];for(const x of results)if(x.status==='fulfilled')all.push(...x.value.items);const lat=+q.body.lat,lon=+q.body.lon;let items=sourceDiverse(dedupe(all).map(e=>publicItem(e,lat,lon))).filter(e=>timeRelevant(e));r.json({items,radiusKm:clamp(+q.body.radiusKm||20,5,MAX_RADIUS),lookbackHours:LOOKBACK_HOURS})}catch(e){r.status(500).json({error:e.message,items:[]})}});
app.get('/pnp/preview',async(q,r)=>{const urls=[clean(q.query.url),clean(q.query.venueUrl)].filter(Boolean);const ck=urls.join('|');if(pc.has(ck))return r.json(pc.get(ck));const found=await Promise.all(urls.map(u=>metaImage(u)));const out=found.find(Boolean)||{};pc.set(ck,out);r.set('cache-control','public,max-age=3600');r.json(out)});
app.get('/manifest.webmanifest',(q,r)=>r.type('application/manifest+json').send(JSON.stringify({name:'PouNaPao — Events κοντά σου',short_name:'PouNaPao',start_url:'/?source=pwa',scope:'/',display:'standalone',background_color:'#070914',theme_color:'#070914'})));
app.get('/sw.js',(q,r)=>{r.set('service-worker-allowed','/');r.type('application/javascript').send(`self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));`) });
export default app;