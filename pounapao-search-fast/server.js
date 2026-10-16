import express from "express";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "512kb" }));

const VERSION = "3.3.2-fast";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY || "";
const MODEL = "gpt-5.6-luna";
const LOOKBACK_HOURS = 8;
const cache = new Map();

const clean = (v) => String(v == null ? "" : v).trim();
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./,""); } catch { return ""; } };
const norm = (s) => clean(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9α-ωάέήίόύώϊϋΐΰ]+/giu," ").trim();
const keyOf = (e) => [norm(e.title),norm(e.venue),clean(e.start).slice(0,13)].join("|");
const rad = (x) => x*Math.PI/180;
const hav = (a,b,c,d) => {
  const R=6371,dp=rad(c-a),dl=rad(d-b);
  const q=Math.sin(dp/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(q));
};

function parseDate(v){ if(!v)return null; const d=new Date(v); return isNaN(d)?null:d; }
function timeRelevant(e){
  if(!e.start)return true;
  const s=parseDate(e.start),end=parseDate(e.end),now=Date.now();
  if(!s)return true;
  if(end && end.getTime()<now)return false;
  if(s.getTime()<now-LOOKBACK_HOURS*3600000 && !end)return false;
  return s.getTime()<now+48*3600000;
}
function parseJson(text){
  const t=clean(text).replace(/^```(?:json)?/i,"").replace(/```$/,"").trim();
  try{return JSON.parse(t)}catch{}
  const a=t.indexOf("{"),b=t.lastIndexOf("}");
  if(a>=0&&b>a){try{return JSON.parse(t.slice(a,b+1))}catch{}}
  return {items:[]};
}
function outputText(j){
  if(typeof j?.output_text==="string")return j.output_text;
  let s="";
  for(const o of j?.output||[])for(const c of o?.content||[])if(typeof c?.text==="string")s+=c.text;
  return s;
}
function dedupe(items){
  const seen=new Set(),perDomain=new Map(),out=[];
  for(const raw of Array.isArray(items)?items:[]){
    if(!raw||!clean(raw.title)||!/^https?:\/\//i.test(clean(raw.url)))continue;
    const e={...raw},k=keyOf(e),d=hostOf(e.url)||"other";
    if(seen.has(k)||(perDomain.get(d)||0)>=3)continue;
    seen.add(k);perDomain.set(d,(perDomain.get(d)||0)+1);out.push(e);
  }
  return out;
}
function publicItem(raw,lat,lon){
  const e={...raw};
  for(const k of ["title","venue","address","start","end","acts","description","eventType","category","url","sourceName","venueUrl","imageUrl"])e[k]=clean(e[k]);
  e.lat=Number.isFinite(+e.lat)?+e.lat:null;e.lon=Number.isFinite(+e.lon)?+e.lon:null;
  e.sourceDomain=hostOf(e.url);
  e.distanceKm=e.lat!=null&&e.lon!=null?+hav(lat,lon,e.lat,e.lon).toFixed(1):null;
  e.mapsUrl=e.lat!=null&&e.lon!=null
    ?"https://www.google.com/maps/search/?api=1&query="+e.lat+","+e.lon
    :"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent([e.venue,e.address].filter(Boolean).join(" "));
  return e;
}
async function reversePlace(lat,lon,locale){
  try{
    const u=new URL("https://nominatim.openstreetmap.org/reverse");
    u.search=new URLSearchParams({format:"jsonv2",lat:String(lat),lon:String(lon),zoom:"10",addressdetails:"1","accept-language":locale||"el"}).toString();
    const r=await fetch(u,{signal:AbortSignal.timeout(1200),headers:{"user-agent":"PouNaPao-fast/3"}});
    const j=await r.json(),a=j.address||{};
    return [a.city||a.town||a.village||a.municipality||a.county||"",a.state||"",a.country||""].filter(Boolean).join(", ");
  }catch{return "";}
}
async function askWeb(prompt,timeoutMs,maxItems){
  if(!OPENAI_API_KEY)return {items:[],error:"openai_key_missing"};
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
    const r=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",signal:ctl.signal,
      headers:{authorization:"Bearer "+OPENAI_API_KEY,"content-type":"application/json"},
      body:JSON.stringify({model:MODEL,tools:[{type:"web_search"}],tool_choice:"auto",max_output_tokens:2600,input:prompt})
    });
    const j=await r.json();
    if(!r.ok)return {items:[],error:"openai_"+r.status+":"+clean(j?.error?.message).slice(0,120)};
    const p=parseJson(outputText(j));
    return {items:Array.isArray(p.items)?p.items.slice(0,maxItems):[],error:""};
  }catch(e){return {items:[],error:(e?.name||"Error")+":"+clean(e?.message||e).slice(0,120)}}
  finally{clearTimeout(timer)}
}
async function ticketmaster(lat,lon,radiusKm){
  if(!TICKETMASTER_API_KEY)return [];
  const now=Date.now();
  const from=new Date(now-LOOKBACK_HOURS*3600000).toISOString().replace(/\.\d{3}Z$/,"Z");
  const to=new Date(now+48*3600000).toISOString().replace(/\.\d{3}Z$/,"Z");
  const u=new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  u.search=new URLSearchParams({apikey:TICKETMASTER_API_KEY,latlong:lat+","+lon,radius:String(radiusKm),unit:"km",size:"30",sort:"date,asc",startDateTime:from,endDateTime:to}).toString();
  try{
    const r=await fetch(u,{signal:AbortSignal.timeout(2500)}),j=await r.json(),arr=j?._embedded?.events||[];
    return arr.map(e=>{
      const v=e?._embedded?.venues?.[0]||{},img=[...(e.images||[])].sort((a,b)=>(b.width||0)-(a.width||0))[0];
      return {
        title:e.name,venue:v.name||"",address:[v.address?.line1,v.city?.name,v.country?.name].filter(Boolean).join(", "),
        start:e.dates?.start?.dateTime||"",end:e.dates?.end?.dateTime||"",
        acts:e?._embedded?.attractions?.map(x=>x.name).slice(0,4).join(", ")||"",
        description:e.info||e.pleaseNote||"",eventType:"Event",category:"Μουσική",
        url:e.url||"",sourceName:"Ticketmaster",venueUrl:v.url||"",imageUrl:img?.url||"",
        lat:v.location?.latitude,lon:v.location?.longitude
      };
    });
  }catch{return []}
}

function stripTags(x){return clean(String(x||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," "))}
function metaTag(html,key){
  const a=new RegExp('<meta[^>]+(?:property|name)=["\\\']'+key+'["\\\'][^>]+content=["\\\']([^"\\\']+)["\\\']','i');
  const b=new RegExp('<meta[^>]+content=["\\\']([^"\\\']+)["\\\'][^>]+(?:property|name)=["\\\']'+key+'["\\\']','i');
  return (html.match(a)||html.match(b)||[])[1]||"";
}
function flattenLd(v,out=[]){if(Array.isArray(v)){for(const x of v)flattenLd(x,out);return out}if(v&&typeof v==="object"){out.push(v);if(v["@graph"])flattenLd(v["@graph"],out)}return out}
function ldEvent(html){
  const scripts=[...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for(const m of scripts){try{const j=JSON.parse(m[1]),all=flattenLd(j,[]);for(const x of all){const t=x["@type"];if(t==="Event"||(Array.isArray(t)&&t.includes("Event")))return x}}catch{}}
  return null;
}
function addressText(a){if(!a)return"";if(typeof a==="string")return a;return [a.streetAddress,a.addressLocality,a.addressRegion,a.postalCode,a.addressCountry].filter(Boolean).join(", ")}
function imageFromLd(x){const im=x?.image;if(typeof im==="string")return im;if(Array.isArray(im)){const v=im[0];return typeof v==="string"?v:(v?.url||"")}return im?.url||""}
async function artDetail(url){
  try{
    const r=await fetch(url,{signal:AbortSignal.timeout(2200),headers:{"user-agent":"Mozilla/5.0 PouNaPao/3.1"}});
    if(!r.ok)return null;const html=await r.text(),ld=ldEvent(html);
    const title=clean(ld?.name)||stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1])||clean(metaTag(html,"og:title"));
    if(!title)return null;
    const loc=ld?.location||{},geo=loc?.geo||{};
    const text=stripTags(html);
    const music=/Μουσική|Συναυλίες|Live|DJ sets|concert|rock|jazz/i.test(text);
    const type=/DJ sets/i.test(text)?"DJ set":/Συναυλίες|Live|concert/i.test(text)?"Live":"Event";
    return {title,venue:clean(loc?.name),address:addressText(loc?.address),start:clean(ld?.startDate),end:clean(ld?.endDate),acts:"",description:clean(ld?.description||metaTag(html,"og:description")).slice(0,160),eventType:type,category:music?"Μουσική":"Πολιτισμός",url:clean(ld?.url)||url,sourceName:"Art&Life",venueUrl:"",imageUrl:imageFromLd(ld)||clean(metaTag(html,"og:image")),lat:geo?.latitude,lon:geo?.longitude};
  }catch{return null}
}
function athensDateParam(){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Athens",day:"2-digit",month:"2-digit",year:"numeric"}).formatToParts(new Date());
  const o={};for(const p of parts)o[p.type]=p.value;return o.day+"/"+o.month+"/"+o.year;
}
async function artAndLife(lat,lon){
  if(hav(lat,lon,40.6401,22.9444)>70)return[];
  const date=athensDateParam();
  const urls=["https://www.artandlife.gr/thessaloniki/events?date="+encodeURIComponent(date),"https://www.artandlife.gr/thessaloniki/concerts_-_live"];
  try{
    const pages=await Promise.all(urls.map(async u=>{try{const r=await fetch(u,{signal:AbortSignal.timeout(1800),headers:{"user-agent":"Mozilla/5.0 PouNaPao/3.1"}});return r.ok?await r.text():""}catch{return""}}));
    const links=[],seen=new Set();
    for(const html of pages){for(const m of html.matchAll(/href\s*=\s*["']([^"']*\/thessaloniki\/events\/[^"'?#]+)["']/gi)){try{const u=new URL(m[1],"https://www.artandlife.gr").href;if(!seen.has(u)){seen.add(u);links.push(u)}}catch{}}}
    const chosen=links.slice(0,18);
    const items=(await Promise.all(chosen.map(artDetail))).filter(Boolean);
    return dedupe(items).slice(0,14);
  }catch{return[]}
}


function guideDecode(x){return stripTags(String(x||"").replace(/&#8211;|&#8212;/g,"-").replace(/&#038;/g,"&").replace(/&hellip;/g,"..."))}
function guideEventLinks(html){
  const out=[],seen=new Set();
  for(const m of String(html||"").matchAll(/href\s*=\s*["'](https?:\/\/(?:www\.)?thessalonikiguide\.gr\/event\/[^"'?#/]+\/?)["']/gi)){
    const u=m[1].replace(/^http:/,"https:");
    if(!seen.has(u)){seen.add(u);out.push(u)}
  }
  for(const m of String(html||"").matchAll(/href\s*=\s*["'](\/event\/[^"'?#/]+\/?)["']/gi)){
    const u=new URL(m[1],"https://www.thessalonikiguide.gr").href;
    if(!seen.has(u)){seen.add(u);out.push(u)}
  }
  return out;
}
function allLdEvents(html){
  const out=[];
  for(const m of String(html||"").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{
      const j=JSON.parse(m[1]);
      const nodes=flattenLd(j,[]);
      for(const x of nodes){const t=x?.["@type"];if(t==="Event"||(Array.isArray(t)&&t.includes("Event")))out.push(x)}
    }catch{}
  }
  return out;
}
function guideDateTimeFallback(html){
  const text=guideDecode(html);
  const m=text.match(/(?:Ημέρες\s*&\s*Ώρες|Ημέρες και Ώρες)[\s\S]{0,220}?(\d{1,2})[:.](\d{2})/i);
  return m?(m[1].padStart(2,"0")+":"+m[2]):"";
}
async function guideDetail(url){
  try{
    const r=await fetch(url,{signal:AbortSignal.timeout(2600),headers:{"user-agent":"Mozilla/5.0 PouNaPao/3.2","accept-language":"el-GR,el;q=0.9,en;q=0.8"}});
    if(!r.ok)return null;
    const html=await r.text(),lds=allLdEvents(html),ld=lds[0]||{};
    const title=clean(ld.name)||guideDecode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1])||clean(metaTag(html,"og:title"));
    if(!title)return null;
    const loc=ld.location||{},geo=loc.geo||{};
    let start=clean(ld.startDate),end=clean(ld.endDate);
    const fallbackTime=guideDateTimeFallback(html);
    if(start&&fallbackTime&&!/T\d{2}:\d{2}/.test(start)){
      const d=start.slice(0,10); if(/^\d{4}-\d{2}-\d{2}$/.test(d))start=d+"T"+fallbackTime+":00+03:00";
    }
    const desc=clean(ld.description||metaTag(html,"og:description"));
    const text=guideDecode(html);
    let eventType=/DJ\s*set|party|club|nightlife/i.test(text)?"Party/DJ":/Συναυλ|Live|concert/i.test(text)?"Live":/festival|Φεστιβάλ/i.test(text)?"Φεστιβάλ":"Event";
    let category=/Μουσικ|DJ|Live|Συναυλ|concert|party/i.test(text)?"Μουσική":/θέατρ|theatre/i.test(text)?"Πολιτισμός":"Άλλο";
    return {title,venue:clean(loc.name),address:addressText(loc.address),start,end,acts:"",description:desc.slice(0,160),eventType,category,url:clean(ld.url)||url,sourceName:"ThessalonikiGuide",venueUrl:"",imageUrl:imageFromLd(ld)||clean(metaTag(html,"og:image")),lat:geo.latitude,lon:geo.longitude};
  }catch{return null}
}
async function thessalonikiGuide(lat,lon){
  if(hav(lat,lon,40.6401,22.9444)>70)return[];
  const urls=[
    "https://www.thessalonikiguide.gr/events/nightlife/",
    "https://www.thessalonikiguide.gr/saturday/",
    "https://www.thessalonikiguide.gr/event/"
  ];
  try{
    const pages=await Promise.all(urls.map(async u=>{try{const r=await fetch(u,{signal:AbortSignal.timeout(2600),headers:{"user-agent":"Mozilla/5.0 PouNaPao/3.2","accept-language":"el-GR,el;q=0.9,en;q=0.8"}});return r.ok?await r.text():""}catch{return""}}));
    const links=[],seen=new Set();
    for(const html of pages){for(const u of guideEventLinks(html)){if(!seen.has(u)){seen.add(u);links.push(u)}}}
    const preferred=links.slice(0,28);
    const settled=await Promise.allSettled(preferred.map(guideDetail));
    const items=settled.filter(x=>x.status==="fulfilled"&&x.value).map(x=>x.value);
    return dedupe(items).filter(timeRelevant).slice(0,18);
  }catch{return[]}
}


function wpText(x){return stripTags(String(x||"").replace(/&#8211;|&#8212;/g,"-").replace(/&#038;/g,"&").replace(/&hellip;/g,"..."))}
function athensYmd(ms=Date.now()){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms));
  const o={};for(const x of p)o[x.type]=x.value;return o.year+"-"+o.month+"-"+o.day;
}
function compactYmd(x){x=clean(x);return /^\d{8}$/.test(x)?x.slice(0,4)+"-"+x.slice(4,6)+"-"+x.slice(6,8):x.slice(0,10)}
function embeddedVenue(post){
  const raw=post?._embedded?.["acf:post"];
  const arr=Array.isArray(raw)?raw.flat(Infinity).filter(Boolean):[];
  const v=arr.find(x=>x&&typeof x==="object")||{};
  const a=v.acf||{};
  const loc=a.location||a.google_map||a.map||{};
  return {
    name:wpText(v?.title?.rendered||v?.name||""),
    address:wpText(a.address||a.place_address||a.location_address||""),
    lat:Number.isFinite(+a.lat)?+a.lat:Number.isFinite(+a.latitude)?+a.latitude:Number.isFinite(+loc.lat)?+loc.lat:null,
    lon:Number.isFinite(+a.lng)?+a.lng:Number.isFinite(+a.lon)?+a.lon:Number.isFinite(+a.longitude)?+a.longitude:Number.isFinite(+loc.lng)?+loc.lng:null
  };
}
function occurrenceForNow(acf){
  const today=athensYmd(),tomorrow=athensYmd(Date.now()+24*3600000),yesterday=athensYmd(Date.now()-24*3600000);
  const reps=Array.isArray(acf?.dates_times_rep)?acf.dates_times_rep:[];
  const candidates=[];
  for(const x of reps){
    const raw=clean(x?.ev_dates_sub); if(!raw)continue;
    const day=raw.slice(0,10),tm=raw.slice(11,19)||"00:00:00";
    if(day===today||day===tomorrow||(day===yesterday&&tm>="18:00:00"))candidates.push({raw,day,tm,end:clean(x?.ev_endtime_sub)});
  }
  candidates.sort((a,b)=>a.raw.localeCompare(b.raw));
  if(candidates.length){
    const nowWall=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date()).replace(",","");
    const upcoming=candidates.find(x=>x.raw>=nowWall);
    return upcoming||candidates[candidates.length-1];
  }
  const start=compactYmd(acf?.start_date),end=compactYmd(acf?.end_date);
  if(start&&end&&start<=tomorrow&&end>=yesterday)return{raw:start+" 00:00:00",day:start,tm:"00:00:00",end:""};
  return null;
}
function wpEventItem(v){
  const acf=v?.acf||{},occ=occurrenceForNow(acf);if(!occ)return null;
  const emb=embeddedVenue(v),yo=v?.yoast_head_json||{};
  const venue=wpText(acf.place_name)||emb.name;
  const address=[wpText(acf.rel_place_address)||emb.address,wpText(acf.rel_place_locality),wpText(acf.rel_place_region)].filter(Boolean).join(", ");
  const title=wpText(acf.only_event_title)||wpText(v?.title?.rendered);
  if(!title||!v?.link)return null;
  const desc=wpText(yo.description||acf.ev_red_info||v?.excerpt?.rendered).slice(0,160);
  const all=(title+" "+desc+" "+wpText(v?.content?.rendered)).slice(0,5000);
  const eventType=/DJ\s*set|party|club|nightlife/i.test(all)?"Party/DJ":/Συναυλ|Live|concert|μουσικ/i.test(all)?"Live":/festival|Φεστιβάλ/i.test(all)?"Φεστιβάλ":/θέατρ|παράσταση/i.test(all)?"Θέατρο":"Event";
  const category=/Μουσικ|DJ|Live|Συναυλ|concert|party/i.test(all)?"Μουσική":/θέατρ|παράσταση/i.test(all)?"Πολιτισμός":"Άλλο";
  const img=yo?.og_image?.[0]?.url||v?._embedded?.["wp:featuredmedia"]?.[0]?.source_url||"";
  let start=occ.raw.replace(" ","T");
  if(/^\d{4}-\d{2}-\d{2}T/.test(start)&&!/[+-]\d{2}:\d{2}$|Z$/.test(start))start+="+03:00";
  let end="";
  if(occ.end&&/^\d{1,2}:\d{2}/.test(occ.end))end=occ.day+"T"+occ.end.padStart(5,"0")+":00+03:00";
  return {title,venue,address,start,end,acts:"",description:desc,eventType,category,url:v.link,sourceName:"ThessalonikiGuide",venueUrl:"",imageUrl:img,lat:emb.lat,lon:emb.lon};
}
async function thessalonikiGuideRest(lat,lon){
  if(hav(lat,lon,40.6401,22.9444)>70)return[];
  try{
    const base="https://www.thessalonikiguide.gr/wp-json/wp/v2/event?per_page=50&_embed=1&orderby=modified&order=desc";
    let rows=[];try{const r=await fetch(base,{signal:AbortSignal.timeout(6500),headers:{"user-agent":"PouNaPao/3.3.2"}});rows=r.ok?await r.json():[]}catch{rows=[]}
    if(!Array.isArray(rows)||!rows.length){try{const r2=await fetch("https://www.thessalonikiguide.gr/wp-json/wp/v2/event?per_page=20&_embed=1&orderby=modified&order=desc",{signal:AbortSignal.timeout(4500),headers:{"user-agent":"PouNaPao/3.3.2-retry"}});rows=r2.ok?await r2.json():[]}catch{rows=[]}}
    const items=(Array.isArray(rows)?rows:[]).map(wpEventItem).filter(Boolean);
    return dedupe(items).slice(0,30);
  }catch{return[]}
}

function promptFor(lane,place,lat,lon,radiusKm,locale,timezone){
  const common =
    "Current UTC time: "+new Date().toISOString()+". Coordinates: "+lat+","+lon+". Place: "+place+
    ". Timezone: "+timezone+". Radius: "+radiusKm+" km. Search in Greek/local language and English. "+
    "Return ONLY strict JSON {\"items\":[...]}. Each item must have title, venue, address, start, end, acts, description, eventType, category, url, sourceName, venueUrl, imageUrl, lat, lon. "+
    "Use exact source URLs. Do not invent. Include events already started within the last "+LOOKBACK_HOURS+" hours if likely still running, and upcoming events in the next 48 hours. "+
    "Prefer official event/venue/ticketing pages; public indexed Instagram/Facebook/TikTok URLs are allowed when they contain concrete event evidence. Descriptions under 120 chars. ";
  if(lane==="social")return common+"Focus on concrete public indexed Instagram, Facebook and TikTok event/venue posts, Reels, pages and Facebook Events. Max 10.";
  if(lane==="food")return common+"Focus on tsipouro/meze places, Σσιπουροκατάσταση + Live, Τσιπουροκατάσταση, Ταβέρνα/Taverna and Fine Dining. Restaurants may have no start time. For +Live require actual evidence of live music. Max 10.";
  if(lane==="fast")return common+"Find high-confidence nightlife/live/concert/party/festival events happening now or tonight. Prioritize official sources and speed. Max 8.";
  return common+"Find the strongest local events now/tonight/tomorrow: parties, DJ sets, live music, concerts, festivals, theatre, exhibitions and notable city events. Ensure source diversity. Max 12.";
}
async function searchLane(body){
  const started=Date.now(),lat=+body.lat,lon=+body.lon,radiusKm=clamp(+body.radiusKm||30,5,50);
  const lane=["fast","events","social","food"].includes(clean(body.lane))?clean(body.lane):"events";
  const locale=body.locale||"el-GR",timezone=body.timezone||"Europe/Athens";
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return {lane,items:[],error:"bad_location"};
  const ck=[lane,lat.toFixed(2),lon.toFixed(2),radiusKm].join("|");
  const hit=cache.get(ck);if(hit&&hit.value?.items?.length&&Date.now()-hit.at<5*60*1000)return {...hit.value,cached:true,durationMs:Date.now()-started};
  const place=lane==="fast"?"":await reversePlace(lat,lon,locale);
  let items=[],error="";
  if(lane==="fast"){
    const [tm,local]=await Promise.all([ticketmaster(lat,lon,radiusKm),thessalonikiGuideRest(lat,lon)]);
    items=[...tm,...local];error="";
  }else{
    const ms=lane==="social"?14000:lane==="food"?10000:12000;
    const web=await askWeb(promptFor(lane,place,lat,lon,radiusKm,locale,timezone),ms,lane==="events"?12:10);
    items=web.items;error=web.error;
  }
  items=dedupe(items).map(e=>publicItem(e,lat,lon)).filter(timeRelevant).filter(e=>e.distanceKm==null||e.distanceKm<=radiusKm+3);
  items.sort((a,b)=>(a.distanceKm??999)-(b.distanceKm??999)||(parseDate(a.start)?.getTime()??1e20)-(parseDate(b.start)?.getTime()??1e20));
  const value={lane,items,error:items.length?"":error,engine:"direct",radiusKm};
  if(items.length)cache.set(ck,{at:Date.now(),value});
  return {...value,cached:false,durationMs:Date.now()-started};
}
app.get("/pnp/diag-wp-events",async(q,r)=>{try{
    const u="https://www.thessalonikiguide.gr/wp-json/wp/v2/event?per_page=5&_embed=1";
    const x=await fetch(u,{signal:AbortSignal.timeout(5000),headers:{"user-agent":"PouNaPao/3.2"}});
    const j=await x.json();
    r.set("cache-control","no-store");r.json({status:x.status,total:x.headers.get("x-wp-total"),pages:x.headers.get("x-wp-totalpages"),sample:(Array.isArray(j)?j:[]).map(v=>({id:v.id,date:v.date,modified:v.modified,link:v.link,title:v.title,keys:Object.keys(v),meta:v.meta,acf:v.acf,yoast:v.yoast_head_json,embeddedKeys:Object.keys(v._embedded||{})}))});
  }catch(e){r.status(500).json({error:(e?.name||"Error")+":"+clean(e?.message||e)})}});
app.get("/pnp/diag-wp-types",async(q,r)=>{try{
    const u="https://www.thessalonikiguide.gr/wp-json/wp/v2/types";
    const x=await fetch(u,{signal:AbortSignal.timeout(4000),headers:{"user-agent":"PouNaPao/3.2"}});
    const j=await x.json();
    r.set("cache-control","no-store");r.json({types:Object.entries(j).map(([key,v])=>({key,name:v?.name,slug:v?.slug,rest_base:v?.rest_base,rest_namespace:v?.rest_namespace})).filter(x=>/event|εκδηλ|agenda/i.test([x.key,x.name,x.slug,x.rest_base].join(" ")))});
  }catch(e){r.status(500).json({error:(e?.name||"Error")+":"+clean(e?.message||e)})}});
app.get("/pnp/debug-guide",async(q,r)=>{try{
    const urls=["https://www.thessalonikiguide.gr/event/","https://www.thessalonikiguide.gr/saturday/","https://www.thessalonikiguide.gr/wp-json/wp/v2/types"];
    const out=[];
    for(const u of urls){try{const x=await fetch(u,{signal:AbortSignal.timeout(4500),headers:{"user-agent":"Mozilla/5.0 PouNaPao/3.1","accept-language":"el-GR,el;q=0.9,en;q=0.8"}});const t=await x.text();out.push({url:u,status:x.status,length:t.length,contentType:x.headers.get("content-type"),sample:t.slice(0,1200),hasEventLinks:/\/event\//i.test(t)})}catch(e){out.push({url:u,error:(e?.name||"Error")+":"+clean(e?.message||e)})}}
    r.set("cache-control","no-store");r.json({out});
  }catch(e){r.status(500).json({error:(e?.name||"Error")+":"+clean(e?.message||e)})}});
app.get("/pnp/debug-art",async(q,r)=>{try{
    const u="https://www.artandlife.gr/thessaloniki/events?date="+encodeURIComponent(athensDateParam());
    const x=await fetch(u,{signal:AbortSignal.timeout(5000),headers:{"user-agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1","accept-language":"el-GR,el;q=0.9,en;q=0.8"}});
    const html=await x.text();
    const hrefs=[...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].slice(0,40).map(m=>m[1]);
    r.set("cache-control","no-store");r.json({status:x.status,length:html.length,url:x.url,hasEventsPath:/\/thessaloniki\/events\//i.test(html),hrefs,sample:html.slice(0,6000)});
  }catch(e){r.status(500).json({error:(e?.name||"Error")+":"+clean(e?.message||e)})}});
app.get("/pnp/health",(q,r)=>r.json({ok:true,version:VERSION,openai:!!OPENAI_API_KEY,ticketmaster:!!TICKETMASTER_API_KEY,direct:true}));
app.post("/pnp/search-lane",async(q,r)=>{r.set("cache-control","no-store");r.json(await searchLane(q.body||{}));});
app.post("/pnp/events",async(q,r)=>{
  const lanes=["fast","events","social","food"];
  const rs=await Promise.all(lanes.map(lane=>searchLane({...q.body,lane})));
  const lat=+q.body.lat,lon=+q.body.lon;
  const items=dedupe(rs.flatMap(x=>x.items)).map(e=>publicItem(e,lat,lon)).filter(timeRelevant);
  r.set("cache-control","no-store");r.json({items,version:VERSION,errors:rs.map(x=>x.error).filter(Boolean)});
});
app.get("/pnp/diag-fast-thess",async(q,r)=>{const t=Date.now(),items=await thessalonikiGuideRest(40.6401,22.9444);r.set("cache-control","no-store");r.json({version:VERSION,count:items.length,durationMs:Date.now()-t,sample:items.slice(0,10).map(x=>({title:x.title,venue:x.venue,start:x.start,source:x.sourceName,url:x.url,image:!!x.imageUrl}))})});
app.get("/pnp/diag-thess",async(q,r)=>{
  const body={lat:40.6401,lon:22.9444,radiusKm:30,locale:"el-GR",timezone:"Europe/Athens"};
  const t=Date.now(),rs=await Promise.all(["fast","events","social","food"].map(lane=>searchLane({...body,lane})));
  const items=dedupe(rs.flatMap(x=>x.items));
  r.set("cache-control","no-store");r.json({version:VERSION,count:items.length,durationMs:Date.now()-t,lanes:rs.map(x=>({lane:x.lane,count:x.items.length,error:x.error,durationMs:x.durationMs})),sample:items.slice(0,8).map(x=>({title:x.title,venue:x.venue,start:x.start,source:x.sourceName,url:x.url}))});
});
app.get("*",(q,r)=>r.status(404).json({error:"not_found"}));
export default app;