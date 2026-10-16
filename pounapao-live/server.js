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
let lastSearchError='';
let lastLegacyError='';
const LEGACY_SEARCH_URL='https://pnp-legacy-search.vercel.app/pnp/events';
const DIRECT_SEARCH_BASE='https://pnp-legacy-search.vercel.app';
const legacyCache=new Map(),legacyInflight=new Map();
const LOOKBACK_HOURS=8;
const MAX_RADIUS=80;
const VERSION='2.7.5';
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
  }catch(e){lastSearchError=(e?.name||'Error')+': '+clean(e?.message||e).slice(0,300);return[]}
  finally{clearTimeout(timer)}
}
async function reverseGeocode(lat,lon,locale='en'){const k=`${(+lat).toFixed(3)},${(+lon).toFixed(3)},${locale}`;if(rc.has(k))return rc.get(k);if(reverseInflight.has(k))return reverseInflight.get(k);const work=(async()=>{try{const u=new URL('https://nominatim.openstreetmap.org/reverse');u.search=new URLSearchParams({format:'jsonv2',lat:String(lat),lon:String(lon),zoom:'10',addressdetails:'1','accept-language':locale}).toString();const r=await fetch(u,{signal:AbortSignal.timeout(2200),headers:{'user-agent':`PouNaPao/${VERSION} event discovery`}}),j=await r.json(),a=j.address||{};const v={city:a.city||a.town||a.village||a.municipality||a.county||'',region:a.state||a.region||'',country:a.country||'',countryCode:(a.country_code||'').toUpperCase(),display:j.display_name||''};rc.set(k,v);return v}catch{return{city:'',region:'',country:'',countryCode:'',display:''}}finally{reverseInflight.delete(k)}})();reverseInflight.set(k,work);return work}
async function geocode(q,locale='en'){const k=`${locale}|${norm(q)}`;if(gc.has(k))return gc.get(k);const u=new URL('https://nominatim.openstreetmap.org/search');u.search=new URLSearchParams({format:'jsonv2',q,limit:'5',addressdetails:'1','accept-language':locale}).toString();const r=await fetch(u,{headers:{'user-agent':`PouNaPao/${VERSION} event discovery`}}),j=await r.json();const out=(Array.isArray(j)?j:[]).map(x=>({lat:+x.lat,lon:+x.lon,label:x.display_name}));gc.set(k,out);return out}
async function ticketmaster(lat,lon,radiusKm){
  const now=new Date().toISOString();
  const prompt=`Current time UTC: ${now}. User coordinates ${lat},${lon}. Search within ${radiusKm} km. Find up to 8 very high-confidence events happening now or in the next 36 hours, prioritizing official venue calendars, official event pages, ticketing, concert halls, clubs, bars and festivals. Include events already started in the last ${LOOKBACK_HOURS} hours if likely still running. Return ONLY strict JSON {"items":[...]}. Each item: title, venue, address, start, end, acts, description, eventType, category, url, sourceName, venueUrl, imageUrl, lat, lon. Do not invent anything.`;
  return openaiSearch(prompt,8,3600);
}
async function legacySearch(body){
  const lat=+body.lat,lon=+body.lon,radiusKm=clamp(+body.radiusKm||30,5,50);
  const key=`${lat.toFixed(2)}|${lon.toFixed(2)}|${radiusKm}`;
  const hit=legacyCache.get(key);
  if(hit&&Date.now()-hit.at<5*60*1000)return hit.items;
  if(legacyInflight.has(key))return legacyInflight.get(key);
  const work=(async()=>{const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),16000);try{
    const r=await fetch(LEGACY_SEARCH_URL,{method:'POST',signal:ctl.signal,headers:{'content-type':'application/json','user-agent':`PouNaPao/${VERSION} fallback`},body:JSON.stringify({lat,lon,radiusKm,locale:body.locale||'el-GR',timezone:body.timezone||'Europe/Athens',hours:36})});
    if(!r.ok)throw new Error('legacy_http_'+r.status);
    const j=await r.json(),items=Array.isArray(j?.items)?j.items:[];
    legacyCache.set(key,{at:Date.now(),items});lastLegacyError='';return items;
  }catch(e){lastLegacyError=(e?.name||'Error')+': '+clean(e?.message||e).slice(0,300);return[]}
  finally{clearTimeout(timer);legacyInflight.delete(key)}})();
  legacyInflight.set(key,work);return work;
}
function legacyLane(items,lane){
  if(lane==='social')return items.filter(e=>/instagram|facebook|tiktok/i.test(hostOf(e.url)||''));
  if(lane==='food')return items.filter(e=>e.category==='Φαγητό/Ποτό'||/Τσιπουρο|Tsipouro|Ταβέρνα|Tavern|Fine Dining/i.test(e.eventType||''));
  if(lane==='fast')return items.filter(e=>e.start||/Party|DJ|Live|Συναυλία|Concert|Festival|Φεστιβάλ/i.test(e.eventType||'')).slice(0,8);
  return items;
}
function lanePrompt({lane,place,lat,lon,radiusKm,locale,timezone}){
 const now=new Date().toISOString();
 const common=`Current time UTC: ${now}. User coordinates ${lat},${lon}. Approximate place: ${place.city}, ${place.region}, ${place.country}. Timezone: ${timezone||'unknown'}. Search radius ${radiusKm} km. Prioritize the nearest results first (0-5 km, then 5-20 km, then 20-30 km when radius allows). Search in the local language AND English. Return ONLY strict JSON {"items":[...]}. Every item must have: title, venue, address, start, end, acts, description, eventType, category, url, sourceName, venueUrl, imageUrl, lat, lon. Use exact source URLs. Do not invent events, coordinates, times or images. Include events that are UPCOMING in the next 48 hours AND events already started in the last ${LOOKBACK_HOURS} hours if they are likely still running. If an end time is available, include it and keep the event only if it has not ended. Public social-media pages may be used only when they are publicly indexed/searchable; preserve the exact Instagram/Facebook/TikTok URL as the source. Prefer official event/venue/ticketing/social pages. Keep descriptions under 120 characters.`;
 const lanes={
   events:`Find the strongest concrete local events now/tonight and within 48 hours: nightlife, parties, DJ sets, live music, concerts, festivals, theatre, exhibitions and notable local events. Prefer official venue/artist/organizer pages, ticketing, local calendars and publicly indexed social posts. Diversity matters: do not let one local guide dominate the list.`,
   social:`Focus only on concrete events evidenced by PUBLICLY INDEXED Instagram posts/Reels/pages, Facebook Events/Page posts, TikTok venue/event pages, and official venue social pages. Avoid generic profiles with no date/time/event detail.`,
   food:`Find food/drink destinations and event-like dining experiences: Τσιπουροκατάσταση, Τσιπουροκατάσταση + Live, Ταβέρνα/Taverna, Fine Dining. For Tsipouro + Live require evidence of live music. Restaurants may omit start/end and can be returned as destinations. Prefer official venue sites and official social pages.`
 };
 return `${common}\nTASK: ${lanes[lane]||lanes.events}\nReturn up to 10 high-confidence items. Prioritize accuracy and speed over exhaustiveness.`;
}
async function searchLane(body){
  const started=Date.now(),lane=clean(body?.lane||'events');
  const timeoutMs=lane==='fast'?8000:lane==='social'?19000:lane==='food'?16000:17000;
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
    const r=await fetch(DIRECT_SEARCH_BASE+'/pnp/search-lane',{
      method:'POST',signal:ctl.signal,
      headers:{'content-type':'application/json','user-agent':'PouNaPao/'+VERSION+' direct'},
      body:JSON.stringify(body||{})
    });
    if(!r.ok)throw new Error('direct_http_'+r.status);
    const j=await r.json();
    return {...j,engine:j.engine||'direct-backend',durationMs:Date.now()-started};
  }catch(e){
    return {lane,items:[],engine:'direct-backend',error:(e?.name||'Error')+': '+clean(e?.message||e).slice(0,180),durationMs:Date.now()-started};
  }finally{clearTimeout(timer)}
}

function safeRemote(u){try{const x=new URL(u);if(!['http:','https:'].includes(x.protocol))return false;const h=x.hostname.toLowerCase();if(h==='localhost'||h.endsWith('.local')||net.isIP(h))return false;return true}catch{return false}}
async function metaImage(u){if(!safeRemote(u))return null;try{const h=hostOf(u);const addrs=await dns.lookup(h,{all:true});if(addrs.some(a=>net.isIP(a.address)))return null;const r=await fetch(u,{redirect:'follow',signal:AbortSignal.timeout(2600),headers:{'user-agent':`Mozilla/5.0 PouNaPao/${VERSION}`}});if(!r.ok)return null;const type=r.headers.get('content-type')||'';if(type.startsWith('image/'))return{mediaUrl:r.url,mediaType:'image'};const html=(await r.text()).slice(0,350000);const pats=[/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i,/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i,/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)/i];for(const p of pats){const m=html.match(p);if(m?.[1])return{mediaUrl:new URL(m[1],r.url).href,mediaType:'image'}}return null}catch{return null}}
app.get('/',(q,r)=>{r.set('cache-control','no-store');r.set('permissions-policy','geolocation=(self)');r.type('html').send(HOME)});
app.get('/pnp/health',(q,r)=>r.json({ok:true,version:VERSION,staged:true,socialDiscovery:true,ongoing:true,lookbackHours:LOOKBACK_HOURS,search:true,directBackend:true,gateway:false}));
app.get('/pnp/diag',async(q,r)=>{let probe={ok:false,error:''};try{const x=await generateText({model:GATEWAY_MODEL,prompt:'Reply with exactly OK',maxOutputTokens:8});probe={ok:/OK/i.test(x.text||''),text:clean(x.text).slice(0,40)}}catch(e){probe={ok:false,error:(e?.name||'Error')+': '+clean(e?.message||e).slice(0,300)}}r.set('cache-control','no-store');r.json({version:VERSION,model:GATEWAY_MODEL,probe,lastSearchError,lastLegacyError,legacyFallback:true})});
app.get('/pnp/diag-thess',async(q,r)=>{const t=Date.now();try{
  const j=await searchLane({lat:40.6401,lon:22.9444,radiusKm:30,locale:'el-GR',timezone:'Europe/Athens',lane:'fast'});
  r.set('cache-control','no-store');r.json({version:VERSION,count:j.items?.length||0,durationMs:Date.now()-t,engine:j.engine,error:j.error||'',sample:(j.items||[]).slice(0,8).map(x=>({title:x.title,venue:x.venue,start:x.start,source:x.sourceName,image:!!x.imageUrl}))});
}catch(e){r.status(500).json({version:VERSION,error:(e?.name||'Error')+': '+clean(e?.message||e)})}});
app.get('/pnp/config',(q,r)=>r.json({radiusKm:5,autoRadii:[5,20,30],maxRadiusKm:MAX_RADIUS,lookbackHours:LOOKBACK_HOURS,version:VERSION}));
app.get('/pnp/ip-location',(q,r)=>{const lat=q.get('x-vercel-ip-latitude'),lon=q.get('x-vercel-ip-longitude'),city=q.get('x-vercel-ip-city'),region=q.get('x-vercel-ip-country-region'),country=q.get('x-vercel-ip-country'),timezone=q.get('x-vercel-ip-timezone');r.set('cache-control','no-store');r.json({ok:Number.isFinite(+lat)&&Number.isFinite(+lon),lat:lat?+lat:null,lon:lon?+lon:null,city:city?decodeURIComponent(city):'',region:region||'',country:country||'',timezone:timezone||'',accuracy:'approximate'});});
app.post('/pnp/geocode',async(q,r)=>{try{r.json({items:await geocode(clean(q.body?.q),q.body?.locale||'en')})}catch(e){r.status(500).json({error:e.message})}});
app.post('/pnp/search-lane',async(q,r)=>{try{r.set('cache-control','no-store');r.json(await searchLane(q.body||{}))}catch(e){r.status(400).json({error:e.message,items:[]})}});
app.post('/pnp/events',async(q,r)=>{try{const lanes=['fast','events','social','food'];const results=await Promise.allSettled(lanes.map(lane=>searchLane({...q.body,lane})));let all=[];for(const x of results)if(x.status==='fulfilled')all.push(...x.value.items);const lat=+q.body.lat,lon=+q.body.lon;let items=sourceDiverse(dedupe(all).map(e=>publicItem(e,lat,lon))).filter(e=>timeRelevant(e));r.json({items,radiusKm:clamp(+q.body.radiusKm||20,5,MAX_RADIUS),lookbackHours:LOOKBACK_HOURS})}catch(e){r.status(500).json({error:e.message,items:[]})}});
app.get('/pnp/preview',async(q,r)=>{const urls=[clean(q.query.url),clean(q.query.venueUrl)].filter(Boolean);const ck=urls.join('|');if(pc.has(ck))return r.json(pc.get(ck));const found=await Promise.all(urls.map(u=>metaImage(u)));const out=found.find(Boolean)||{};pc.set(ck,out);r.set('cache-control','public,max-age=3600');r.json(out)});
app.get('/manifest.webmanifest',(q,r)=>r.type('application/manifest+json').send(JSON.stringify({id:'/',name:'PouNaPao — Events κοντά σου',short_name:'PouNaPao',description:'Events, nightlife και μέρη κοντά σου',start_url:'/?source=pwa&v=271',scope:'/',display:'standalone',display_override:['standalone'],orientation:'portrait',background_color:'#080809',theme_color:'#080809',categories:['entertainment','lifestyle']})));
app.get('/sw.js',(q,r)=>{r.set('service-worker-allowed','/');r.type('application/javascript').send(`self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));`) });
export default app;