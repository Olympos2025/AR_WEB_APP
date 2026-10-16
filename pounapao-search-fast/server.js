import express from "express";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "512kb" }));

const VERSION = "3.0.0-fast";
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
  const hit=cache.get(ck);if(hit&&Date.now()-hit.at<5*60*1000)return {...hit.value,cached:true,durationMs:Date.now()-started};
  const place=lane==="fast"?"":await reversePlace(lat,lon,locale);
  let items=[],error="";
  if(lane==="fast"){
    const [tm,web]=await Promise.all([ticketmaster(lat,lon,radiusKm),askWeb(promptFor("fast",place,lat,lon,radiusKm,locale,timezone),3800,8)]);
    items=[...tm,...web.items];error=web.error;
  }else{
    const ms=lane==="social"?6000:lane==="food"?5000:5000;
    const web=await askWeb(promptFor(lane,place,lat,lon,radiusKm,locale,timezone),ms,lane==="events"?12:10);
    items=web.items;error=web.error;
  }
  items=dedupe(items).map(e=>publicItem(e,lat,lon)).filter(timeRelevant).filter(e=>e.distanceKm==null||e.distanceKm<=radiusKm+3);
  items.sort((a,b)=>(a.distanceKm??999)-(b.distanceKm??999)||(parseDate(a.start)?.getTime()??1e20)-(parseDate(b.start)?.getTime()??1e20));
  const value={lane,items,error:items.length?"":error,engine:"direct",radiusKm};
  cache.set(ck,{at:Date.now(),value});
  return {...value,cached:false,durationMs:Date.now()-started};
}
app.get("/pnp/health",(q,r)=>r.json({ok:true,version:VERSION,openai:!!OPENAI_API_KEY,ticketmaster:!!TICKETMASTER_API_KEY,direct:true}));
app.post("/pnp/search-lane",async(q,r)=>{r.set("cache-control","no-store");r.json(await searchLane(q.body||{}));});
app.post("/pnp/events",async(q,r)=>{
  const lanes=["fast","events","social","food"];
  const rs=await Promise.all(lanes.map(lane=>searchLane({...q.body,lane})));
  const lat=+q.body.lat,lon=+q.body.lon;
  const items=dedupe(rs.flatMap(x=>x.items)).map(e=>publicItem(e,lat,lon)).filter(timeRelevant);
  r.set("cache-control","no-store");r.json({items,version:VERSION,errors:rs.map(x=>x.error).filter(Boolean)});
});
app.get("/pnp/diag-thess",async(q,r)=>{
  const body={lat:40.6401,lon:22.9444,radiusKm:30,locale:"el-GR",timezone:"Europe/Athens"};
  const t=Date.now(),rs=await Promise.all(["fast","events","social","food"].map(lane=>searchLane({...body,lane})));
  const items=dedupe(rs.flatMap(x=>x.items));
  r.set("cache-control","no-store");r.json({version:VERSION,count:items.length,durationMs:Date.now()-t,lanes:rs.map(x=>({lane:x.lane,count:x.items.length,error:x.error,durationMs:x.durationMs})),sample:items.slice(0,8).map(x=>({title:x.title,venue:x.venue,start:x.start,source:x.sourceName,url:x.url}))});
});
app.get("*",(q,r)=>r.status(404).json({error:"not_found"}));
export default app;