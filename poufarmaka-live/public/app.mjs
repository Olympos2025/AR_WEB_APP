import {localDate,localEpoch,addDay,fresh} from './lib/domain.mjs';
import {searchArea} from './lib/search-area.mjs';
import {requestLocation} from './lib/geolocation.mjs';
import {watchLocation,shouldRefreshSearch} from './lib/live-location.mjs';
import {locationBrowser,isStandalone,locationReport} from './lib/location-context.mjs';
import {createLocationStartup} from './lib/location-startup.mjs';
import {BASEMAPS} from './lib/map-layers.mjs';
import {cityFor,validPoint,escapeHtml as esc,rankRoutes,safeUrl} from './lib/app-core.mjs';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const defaultOrigin={lat:40.632,lng:22.945,label:'Αρχική περιοχή: Θεσσαλονίκη, κέντρο'};
const state={origin:defaultOrigin,user:null,rows:[],sources:[],ranked:[],kind:'pharmacy',mode:'driving',radius:5,selected:'',selectionExplicit:false,dataKey:'',loadedAt:0,following:false,tracking:false,picking:false,request:0,routeRequest:0,geometryRequest:0};
let map,baseLayer,userMarker,accuracyCircle,routeLayer,markers=new Map(),routeCache=null,lastSearch=null,geoController,liveController,wantsLive=false,locationAttempt=0,availabilityController,routingController,geometryController,searchController,searchTimer,searchSequence=0,options=[],activeOption=-1,intent=null,firstFit=false,lastFix=0;
const standalone=isStandalone({standalone:navigator.standalone,displayMode:matchMedia('(display-mode: standalone)').matches});
let locationStorage;try{locationStorage=window.localStorage}catch{}
const locationStartup=createLocationStartup({standalone,storage:locationStorage});
const browser=locationBrowser(navigator.userAgent);
const km=n=>n<1?Math.round(n*1000)+' μ.':n.toLocaleString('el-GR',{maximumFractionDigits:1})+' χλμ.';
const stamp=t=>t&&Number.isFinite(Date.parse(t))?new Intl.DateTimeFormat('el-GR',{timeZone:'Europe/Athens',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(t)):'Δεν έχει ληφθεί';
const time=()=>$('#when').value==='now'?Date.now():localEpoch($('#date').value,+$('#hour').value.slice(0,2)*60 + +$('#hour').value.slice(3));
const day=()=>localDate(time());
function notice(id,text){$(id).textContent=text;$(id).hidden=!text}
function status(title,text){$('#statusTitle').textContent=title;$('#statusText').textContent=text}
async function json(url,init={}){const r=await fetch(url,{cache:'no-store',...init});const data=await r.json();if(!r.ok)throw Error(data.error||'Η υπηρεσία δεν απάντησε.');return data}
const post=(url,body,signal)=>json(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
function updateLocationUI(){
 $('#originLabel').textContent=state.origin.label+(state.user&&Number.isFinite(state.user.accuracy)?' · ±'+Math.round(state.user.accuracy)+' μ.':'');
 $('#pauseBtn').hidden=!wantsLive;
 const needsActivation=standalone&&!locationStartup.automatic&&!state.user;
 $('#locBtn').textContent=state.tracking?'◎ ΖΩΝΤΑΝΗ ΘΕΣΗ':needsActivation?'◎ ΕΝΕΡΓΟΠΟΙΗΣΗ ΘΕΣΗΣ':'◎ Η ΘΕΣΗ ΜΟΥ';
 $('.search-region').classList.toggle('needs-location',needsActivation);
 $('#followBtn').hidden=!state.user;
 $('#followBtn').textContent=!state.tracking?'◎ Τελευταία θέση':state.following?'◎ Ακολουθεί τη θέση σου':'◎ Ακολούθησέ με';
 $('#followBtn').setAttribute('aria-pressed',String(state.following&&state.tracking));
 userMarker?.getElement()?.querySelector('.user-dot')?.classList.toggle('live',state.tracking);
}
function follow(value){state.following=value;updateLocationUI()}
function setLayer(key){
 if(!map)return;
 if(baseLayer)map.removeLayer(baseLayer);
 const layer=BASEMAPS[key];baseLayer=L.tileLayer(layer.url,{maxZoom:19,maxNativeZoom:layer.maxNativeZoom,className:layer.className,attribution:layer.attribution}).addTo(map);
 let errors=0;
 baseLayer.on('tileerror',()=>{if(++errors>=3)notice('#mapError','Το υπόβαθρο δεν φορτώθηκε πλήρως. Δοκίμασε το άλλο υπόβαθρο· η λίστα παραμένει διαθέσιμη.')});
 baseLayer.on('tileload',()=>notice('#mapError',''));
 $('#darkBtn').setAttribute('aria-pressed',String(key==='dark'));$('#satelliteBtn').setAttribute('aria-pressed',String(key==='satellite'));
 $('#layerCaption').textContent=key==='dark'?'OpenStreetMap · σκοτεινό υπόβαθρο':'Sentinel-2 · εικόνες 2024 · ανάλυση 10 μ. · όχι ζωντανή εικόνα';
}
function initMap(){
 if(!window.L){notice('#mapError','Δεν φορτώθηκε ο χάρτης. Μπορείς να χρησιμοποιήσεις τη λίστα και τις διαδρομές.');return}
 map=L.map('map',{zoomControl:false}).setView([state.origin.lat,state.origin.lng],13);
 L.control.zoom({position:'bottomright'}).addTo(map);setLayer('dark');
 userMarker=L.marker([state.origin.lat,state.origin.lng],{icon:L.divIcon({className:'',html:'<div class="user-dot manual"></div>',iconSize:[18,18],iconAnchor:[9,9]}),title:'Αφετηρία αναζήτησης',zIndexOffset:1000}).addTo(map);
 map.on('dragstart',()=>follow(false));map.on('popupopen',()=>follow(false));
 map.on('click',e=>{if(!state.picking)return;setManualOrigin({lat:e.latlng.lat,lng:e.latlng.lng,label:'Επιλεγμένο σημείο στον χάρτη'});state.picking=false;$('#pickBtn').setAttribute('aria-pressed','false')});
}
function displayPosition(p,isDevice){
 if(!map)return;
 userMarker.setLatLng([p.lat,p.lng]);userMarker.getElement()?.querySelector('.user-dot')?.classList.toggle('manual',!isDevice);
 userMarker.setTooltipContent?.(isDevice?'Η θέση μου':p.label);
 if(isDevice&&Number.isFinite(p.accuracy)){
  if(!accuracyCircle)accuracyCircle=L.circle([p.lat,p.lng],{radius:p.accuracy,color:'#59d8d0',weight:1,fillOpacity:.06,interactive:false}).addTo(map);
  else accuracyCircle.setLatLng([p.lat,p.lng]).setRadius(p.accuracy);
 }else if(accuracyCircle){map.removeLayer(accuracyCircle);accuracyCircle=null}
}
function setManualOrigin(p){
 if(!validPoint(p)){notice('#locationNotice','Επίλεξε σημείο εντός Ελλάδας.');return}
 locationStartup.paused();stopLocation();state.user=null;lastSearch=null;state.origin={...p,source:'manual'};follow(false);displayPosition(p,false);state.selected='';state.selectionExplicit=false;notice('#locationNotice','');
 map?.flyTo([p.lat,p.lng],15,{animate:!reduced,duration:.7});updateLocationUI();loadData();
}
function stopLocation(){locationAttempt++;wantsLive=false;state.tracking=false;geoController?.abort();liveController?.abort();$('#locBtn').disabled=false;updateLocationUI()}
function acceptPosition(position){
 const c=position.coords,p={lat:c.latitude,lng:c.longitude,accuracy:c.accuracy,label:c.accuracy>1000?'Η θέση μου · κατά προσέγγιση':'Η θέση μου',source:'device'};
 if(!validPoint(p)){stopLocation();notice('#locationNotice','Η ληφθείσα θέση είναι εκτός Ελλάδας. Γράψε μια διεύθυνση στην Ελλάδα.');return false}
 locationStartup.succeeded();const first=!state.user,now=Date.now();lastFix=now;state.user=p;state.tracking=true;displayPosition(p,true);notice('#locationNotice','');
 if(first){follow(true);map?.flyTo([p.lat,p.lng],16,{animate:!reduced,duration:.8})}
 else if(state.following)map?.panTo([p.lat,p.lng],{animate:!reduced,duration:.6});
 if(shouldRefreshSearch(lastSearch,p,now)){lastSearch={position:p,at:now};state.origin=p;if(first){state.selected='';state.selectionExplicit=false}loadData()}
 updateLocationUI();return true;
}
function startWatch(){
 liveController?.abort();if(!wantsLive||document.hidden)return;liveController=new AbortController();const version=locationAttempt;
 watchLocation(navigator.geolocation,{signal:liveController.signal,onPosition:p=>{if(version===locationAttempt)acceptPosition(p)},onError:error=>{
  if(version!==locationAttempt)return;
  state.tracking=false;updateLocationUI();
  if(error.code===1){stopLocation();locationError(error,false,0,{method:'watchPosition',trigger:'Παρακολούθηση'})}else notice('#locationNotice','Αναμονή σήματος τοποθεσίας. Ο χάρτης κρατά την τελευταία ληφθείσα θέση.');
 }});
}
function help(error){
 const denied=error?.code===1;
 $('#helpIntro').textContent=denied?'Η συσκευή επέστρεψε άρνηση πρόσβασης στη θέση. Αυτό μπορεί να συμβεί χωρίς να εμφανιστεί ερώτηση. Η εφαρμογή δεν μπορεί να αλλάξει αυτή την άδεια.':standalone?'Πάτησε «Ενεργοποίηση θέσης» για να ζητήσει η εγκατεστημένη εφαρμογή πρόσβαση. Μετά την πρώτη επιτυχία θα εντοπίζει τη θέση αυτόματα όταν ανοίγει.':'Η εφαρμογή ζητά τη θέση από τη συσκευή. Η άδεια αφορά αυτόν τον ιστότοπο και τον τρόπο που τον ανοίγεις.';
 $('#retryLocation').textContent=denied?'Δοκιμή μετά την αλλαγή άδειας':standalone?'Ενεργοποίηση θέσης':'Νέα προσπάθεια';
 $('#helpSteps').innerHTML=standalone?'<details><summary>Αν δεν εμφανίζεται ερώτηση άδειας</summary><p>Το web app μπορεί να μην έχει την ίδια άδεια με το Safari.</p><ol><li>Στις Ρυθμίσεις iPhone → Απόρρητο και ασφάλεια → Υπηρεσίες τοποθεσίας, έλεγξε ότι είναι ενεργές. Στην καταχώριση του web app, αν υπάρχει, ή στους «Ιστότοπους Safari», επίλεξε «Κατά τη χρήση της εφαρμογής».</li><li>Επέστρεψε εδώ και δοκίμασε ξανά από το κουμπί. Η εφαρμογή δεν μπορεί να ανοίξει ή να αλλάξει τις ρυθμίσεις άδειας του iPhone.</li><li>Αν η εγκατεστημένη εφαρμογή εξακολουθεί να απορρίπτει τη θέση, χρησιμοποίησε τον ίδιο σύνδεσμο στο Safari ή επίλεξε διεύθυνση. Συντόμευση χωρίς «Άνοιγμα ως εφαρμογή ιστού» ανοίγει στον browser.</li></ol><p><a href="https://poufarmaka.vercel.app/" target="_blank" rel="noopener">Άνοιγμα συνδέσμου ↗</a></p></details>':'<ol><li>Στις ρυθμίσεις αυτού του ιστοτόπου στον '+esc(browser)+', όρισε την Τοποθεσία σε «Να επιτρέπεται» ή «Ερώτηση».</li><li>Στις Ρυθμίσεις iPhone → Απόρρητο και ασφάλεια → Υπηρεσίες τοποθεσίας, έλεγξε τον browser που χρησιμοποιείς. Η άδεια του Safari και του Edge είναι ξεχωριστή.</li><li>Μετά την αλλαγή, ανανέωσε τη σελίδα και πάτησε «Η θέση μου».</li></ol>';
}
function locationError(error,manual,elapsed,context={}){
 if(error.code===1){locationStartup.denied();updateLocationUI()}
 const msg=error.code===1?'Δεν δόθηκε άδεια θέσης. Πάτησε «Άδεια τοποθεσίας» ή γράψε διεύθυνση.':error.code==='unsupported'?'Δεν υποστηρίζεται τοποθεσία σε αυτό το περιβάλλον. Επίλεξε διεύθυνση.':'Δεν λήφθηκε θέση ακόμη. Δοκίμασε ξανά ή επίλεξε διεύθυνση.';
 notice('#locationNotice',msg);help(error);let policy=null;try{policy=(document.permissionsPolicy||document.featurePolicy)?.allowsFeature('geolocation')??null}catch{}
 $('#diagnostic').textContent=locationReport({error,browser,host:location.hostname,secure:isSecureContext,embedded:window.top!==window.self,policyAllowed:policy,elapsedMs:elapsed,standalone,...context});
 if(manual){$('#helpDialog').showModal();$('#helpDialog').scrollTop=0}
}
async function locate(manual=false){
 stopLocation();const version=locationAttempt,start=performance.now();
 const context={method:standalone?'getCurrentPosition':'watchPosition',trigger:manual?'Πάτημα κουμπιού':'Αυτόματη εκκίνηση',userActivation:navigator.userActivation?.isActive??null};
 if(!navigator.geolocation||!isSecureContext){locationError({code:'unsupported'},manual,0);return}
 $('#locBtn').disabled=true;notice('#locationNotice','Εντοπισμός θέσης… Αν εμφανιστεί αίτημα, επίλεξε «Να επιτρέπεται».');
 geoController=new AbortController();
 try{const p=await requestLocation(navigator.geolocation,geoController.signal,{singleRequest:standalone});if(version!==locationAttempt)return;wantsLive=true;if(acceptPosition(p))startWatch()}
 catch(e){if(version===locationAttempt&&e.code!=='cancelled')locationError(e,manual,performance.now()-start,context)}
 finally{if(version===locationAttempt){$('#locBtn').disabled=false;updateLocationUI()}}
}
function sourceMarkup(){return state.sources.map(s=>'<div class="source-row"><a href="'+esc(safeUrl(s.url))+'" target="_blank" rel="noopener">'+esc(s.name)+'</a><p>'+esc(s.coverage)+' · '+esc(s.count??0)+' εγγραφές'+(s.missing?' · '+esc(s.missing)+' χωρίς διαθέσιμη θέση':'')+'</p><p>Λήψη: '+stamp(s.fetchedAt)+' · ώρα Ελλάδας</p>'+(s.error?'<p>'+esc(s.error)+'</p>':'')+(s.warnings?.length?'<p>'+esc(s.warnings.join(' · '))+'</p>':'')+'</div>').join('')}
function updateSources(){
 $('#sourceRows').innerHTML=sourceMarkup()||'<p>Δεν έχουν ληφθεί πηγές ακόμη.</p>';
 const relevant=state.sources.filter(s=>state.kind==='hospital'?s.name.includes('ΥΠΕ'):!s.name.includes('ΥΠΕ'));
 const error=relevant.find(s=>s.error);
 const stale=state.rows.some(r=>r.kind===state.kind&&!fresh(r));
 notice('#dataNotice',error?'Η πηγή αναφέρει: '+error.error:stale?'Μερικές εγγραφές δεν έχουν πρόσφατη ενημέρωση και δεν χαρακτηρίζονται ανοιχτές.':'');
 const specialties=[...new Set(state.rows.filter(r=>r.kind==='hospital').flatMap(r=>r.duties?.[day()]||[]))].sort();
 const prev=$('#specialty').value;$('#specialty').innerHTML='<option value="">Όλες οι ειδικότητες</option>'+specialties.map(v=>'<option>'+esc(v)+'</option>').join('');$('#specialty').value=specialties.includes(prev)?prev:'';
}
async function loadData(force=false){
 const key=cityFor(state.origin).key+':'+day();
 if(!force&&key===state.dataKey&&Date.now()-state.loadedAt<300000&&state.rows.length){render();return}
 const version=++state.request;availabilityController?.abort();availabilityController=new AbortController();cancelRoutes();
 status('ΑΝΑΖΗΤΗΣΗ','Ανάκτηση ημερήσιων προγραμμάτων…');
 state.rows=[];state.ranked=[];state.selected='';state.selectionExplicit=false;renderMarkers();$('#routeSummary').textContent='Αναζήτηση προγραμμάτων για την επιλεγμένη περιοχή…';
 $('#results').innerHTML='<div class="empty"><div class="spinner"></div>Αναζήτηση στα ημερήσια προγράμματα…</div>';
 try{
  const data=await json('/api/availability?'+new URLSearchParams({date:day(),city:cityFor(state.origin).key}),{signal:availabilityController.signal});
  if(version!==state.request)return;
  state.rows=(data.rows||[]).filter(r=>validPoint(r));state.sources=data.sources||[];state.dataKey=key;state.loadedAt=Date.now();updateSources();render();
 }catch(e){if(version!==state.request||e.name==='AbortError')return;state.dataKey='';state.sources=[];status('ΜΗ ΔΙΑΘΕΣΙΜΟ','Δεν φορτώθηκαν οι εφημερίες');$('#results').innerHTML='<div class="error">Δεν μπόρεσα να φορτώσω το πρόγραμμα. Πάτησε «Έλεγχος ενημέρωσης».</div>';notice('#dataNotice',e.message)}
}
function cancelRoutes(){state.routeRequest++;routingController?.abort();routeCache=null;clearRoute()}
function clearRoute(){state.geometryRequest++;geometryController?.abort();if(map&&routeLayer)map.removeLayer(routeLayer);routeLayer=null}
function render(){
 const area=searchArea(state.rows,{origin:state.origin,kind:state.kind,time:time(),onlyOpen:$('#onlyOpen').checked,night:state.kind==='pharmacy'&&$('#night').checked,specialty:state.kind==='hospital'?$('#specialty').value:''});state.radius=area.radius;
 $('#radiusBadge').textContent=area.radius+' ΧΛΜ.';
 notice('#expansionNotice',area.expanded?'Αυτόματη αναζήτηση στα '+area.radius+' χλμ. · Δεν βρέθηκαν αποτελέσματα '+(area.radius===10?'στα 5 χλμ.':'στα 5 ή 10 χλμ.'):'');
 const key=JSON.stringify([state.origin.lat,state.origin.lng,state.mode,area.rows.map(r=>[r.id,r.lat,r.lng])]);
 state.ranked=rankRoutes(area.rows,routeCache?.key===key?routeCache.routes:null,time(),$('#sort').value);
 if(!state.selectionExplicit||!state.ranked.some(r=>r.id===state.selected))state.selected=state.ranked[0]?.id||'';
 renderResults();renderMarkers();if(!firstFit&&state.ranked.length&&!state.user){firstFit=true;showAll()}
 if(!state.selectionExplicit||!state.ranked.some(r=>r.id===state.selected))state.selected=state.ranked[0]?.id||'';
 updateSummary();
 status('ΕΝΗΜΕΡΩΘΗΚΕ',state.ranked.length+' αποτελέσματα · '+(state.user?'από τη θέση σου':state.origin.label));
 if(!area.rows.length){cancelRoutes();notice('#routeNotice','');return}
 if(routeCache?.key===key){requestGeometry();return}
 fetchRoutes(area.rows,key);
}
async function fetchRoutes(rows,key){
 const version=++state.routeRequest;routingController?.abort();routingController=new AbortController();clearRoute();notice('#routeNotice','Υπολογισμός χρόνων στο οδικό δίκτυο…');
 const requestOrigin={lat:state.origin.lat,lng:state.origin.lng},mode=state.mode;
 try{const routes=[];for(let i=0;i<rows.length;i+=99){const data=await post('/api/routes',{origin:requestOrigin,destinations:rows.slice(i,i+99).map(r=>({lat:r.lat,lng:r.lng})),mode},routingController.signal);routes.push(...data.routes)}
  if(version!==state.routeRequest)return;routeCache={key,routes};state.ranked=rankRoutes(rows,routes,time(),$('#sort').value);notice('#routeNotice',routes.some(r=>!Number.isFinite(r?.seconds))?'Για ορισμένα αποτελέσματα δεν υπολογίστηκε χρόνος· φαίνεται η απόσταση σε ευθεία.':'Εκτιμώμενοι χρόνοι OSRM · χωρίς ζωντανή κίνηση.');
  if(!state.selectionExplicit||!state.ranked.some(r=>r.id===state.selected))state.selected=state.ranked[0]?.id||'';
  renderResults();renderMarkers();updateSummary();requestGeometry();
 }catch(e){if(version!==state.routeRequest||e.name==='AbortError')return;notice('#routeNotice','Δεν υπολογίστηκαν χρόνοι διαδρομής. Η σειρά και οι αποστάσεις είναι σε ευθεία.');updateSummary()}
}
function mapsLink(r){return 'https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',origin:state.origin.lat+','+state.origin.lng,destination:r.lat+','+r.lng,travelmode:state.mode})}
function card(r,i){
 const openLabel=r.kind==='hospital'?(r.onDay?'Εφημερία την επιλεγμένη ημέρα':'Στοιχεία επικοινωνίας'):(r.open?($('#when').value==='now'?'Ανοιχτό τώρα':'Ανοιχτό στην επιλεγμένη ώρα'):'Χωρίς επιβεβαίωση για αυτή την ώρα');
 return '<article class="card '+r.kind+(state.selected===r.id?' selected':'')+'" data-card="'+esc(r.id)+'"><div class="cardtop"><div class="rank">'+(i+1)+'</div><div class="maincopy"><button class="name card-select" data-select="'+esc(r.id)+'">'+esc(r.name)+'</button><div class="addr">'+esc(r.address)+'<br>'+esc(r.area||'')+'</div></div><div class="distance">'+(r.seconds!==null?Math.max(1,Math.ceil(r.seconds/60))+'′':km(r.km))+'<small>'+km(r.km)+' σε ευθεία</small></div></div><div class="meta"><span class="chip '+(r.open||r.onDay?'open':'')+'">'+esc(openLabel)+'</span>'+(r.reachable?'<span class="chip recommended">Προλαβαίνεις · περιθώριο 5′</span>':'')+'<span class="chip">'+esc(r.hours||'Επιβεβαίωσε τηλεφωνικά')+'</span>'+(r.clinics?.length?'<span class="chip">'+esc(r.clinics.join(' · '))+'</span>':'')+'</div><div class="actions"><a class="action" href="'+esc(mapsLink(r))+'" target="_blank" rel="noopener">ΔΙΑΔΡΟΜΗ ↗</a>'+(r.phone?'<a class="action alt" href="tel:'+esc(String(r.phone).replace(/[^+\d]/g,''))+'">☎ '+esc(r.phone)+'</a>':'<span class="action alt">Χωρίς τηλέφωνο</span>')+'</div><div class="source"><a href="'+esc(safeUrl(r.sourceUrl||r.contactUrl))+'" target="_blank" rel="noopener">'+esc(r.source||'Πηγή')+' ↗</a> · Λήψη '+stamp(r.fetchedAt)+(r.email?'<br><a href="mailto:'+esc(r.email)+'">'+esc(r.email)+'</a>':'')+'</div></article>';
}
function renderResults(){
 const previous=new Map($$('#results [data-card]').map(el=>[el.dataset.card,el.getBoundingClientRect().top]));
 $('#countLabel').textContent=state.ranked.length+' ΑΠΟΤΕΛΕΣΜΑΤΑ · ΕΩΣ '+state.radius+' ΧΛΜ.';
 $('#resultsTitle').textContent=state.kind==='hospital'?'Νοσοκομεία κοντά σου':$('#when').value==='now'?'Εφημερεύοντα τώρα':'Εφημερίες στην επιλεγμένη ώρα';
 $('#results').innerHTML=state.ranked.length?state.ranked.map(card).join(''):'<div class="empty">Δεν βρέθηκαν αποτελέσματα έως 50 χλμ. για τα επιλεγμένα φίλτρα.<p class="fine">Ελέγχθηκαν αυτόματα 5, 10 και 50 χλμ. Δες την ενημέρωση των πηγών ή επίλεξε άλλη διεύθυνση.</p></div>';
 $$('#results [data-card]').forEach((el,i)=>{const before=previous.get(el.dataset.card);if(reduced)return;if(before===undefined){el.classList.add('enter');el.style.setProperty('--delay',Math.min(i*35,210)+'ms')}else{const delta=before-el.getBoundingClientRect().top;if(Math.abs(delta)>1)el.animate([{transform:'translateY('+delta+'px)'},{transform:'translateY(0)'}],{duration:350,easing:'cubic-bezier(.16,1,.3,1)'})}});
}
function renderMarkers(){
 if(!map)return;const ids=new Set(state.ranked.map(r=>r.id));for(const [id,marker]of markers){if(!ids.has(id)){map.removeLayer(marker);markers.delete(id)}}
 for(const r of state.ranked){let marker=markers.get(r.id);if(!marker){marker=L.marker([r.lat,r.lng],{icon:L.divIcon({className:'',html:'<div class="ph-dot '+(r.kind==='hospital'?'hospital':'')+'"></div>',iconSize:[16,16],iconAnchor:[8,8]}),title:r.name,bubblingMouseEvents:false}).addTo(map);marker.on('click',()=>selectRow(r.id,false));markers.set(r.id,marker)}
  marker.getElement()?.querySelector('.ph-dot')?.classList.toggle('selected',r.id===state.selected);
  const html='<strong>'+esc(r.name)+'</strong>'+esc(r.address)+'<br>'+esc(r.hours||'')+'<br><a href="'+esc(mapsLink(r))+'" target="_blank" rel="noopener">Διαδρομή ↗</a>';
  if(marker.getPopup())marker.setPopupContent(html);else marker.bindPopup(html,{minWidth:180,maxWidth:260,autoPanPaddingTopLeft:[18,20],autoPanPaddingBottomRight:[18,75]});
 }
}
function selectRow(id,openPopup=true){state.selected=id;state.selectionExplicit=true;follow(false);$$('[data-card]').forEach(el=>el.classList.toggle('selected',el.dataset.card===id));renderMarkers();updateSummary();requestGeometry();if(openPopup){const marker=markers.get(id);if(marker){map.panTo(marker.getLatLng());marker.openPopup();$('#map').scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'})}}}
function updateSummary(){const r=state.ranked.find(r=>r.id===state.selected)||state.ranked[0];$('#routeSummary').innerHTML=r?'<span class="route-time">'+(r.seconds!==null?Math.max(1,Math.ceil(r.seconds/60))+'′':'↗')+'</span><span><b>'+esc(r.name)+'</b><br>'+(r.reachable?'Προλαβαίνεις με περιθώριο 5 λεπτών.':'Κάλεσε για επιβεβαίωση πριν ξεκινήσεις.')+'</span><a href="'+esc(mapsLink(r))+'" target="_blank" rel="noopener" aria-label="Άνοιγμα διαδρομής">↗</a>':'Δεν υπάρχει αποτέλεσμα για αυτή τη θέση και τα φίλτρα.'}
async function requestGeometry(){
 clearRoute();const r=state.ranked.find(r=>r.id===state.selected);if(!r||!map)return;const version=state.geometryRequest;geometryController=new AbortController();
 try{const data=await post('/api/routes',{origin:state.origin,destinations:[{lat:r.lat,lng:r.lng}],mode:state.mode,geometry:true},geometryController.signal);if(version!==state.geometryRequest)return;if(data.geometry)routeLayer=L.geoJSON(data.geometry,{style:{color:'#59d8d0',weight:4,opacity:.8},interactive:false}).addTo(map)}catch{}
}
function showAll(){if(!map)return;follow(false);map.fitBounds(L.latLngBounds([[state.origin.lat,state.origin.lng],...state.ranked.map(r=>[r.lat,r.lng])]),{paddingTopLeft:[30,30],paddingBottomRight:[40,80],maxZoom:15,animate:!reduced})}
function closeSuggestions(){options=[];activeOption=-1;$('#suggestions').hidden=true;$('#searchInput').setAttribute('aria-expanded','false');$('#searchInput').removeAttribute('aria-activedescendant')}
function choosePlace(i){const p=options[i];if(!p)return;searchSequence++;searchController?.abort();clearTimeout(searchTimer);closeSuggestions();$('#searchInput').value='';setManualOrigin({...p,label:p.label})}
async function searchPlaces(){const q=$('#searchInput').value.trim();if(q.length<2){closeSuggestions();return}const version=++searchSequence;searchController?.abort();searchController=new AbortController();options=[];activeOption=-1;$('#suggestions').hidden=false;$('#searchInput').setAttribute('aria-expanded','true');$('#suggestions').innerHTML='<p>Αναζήτηση διεύθυνσης…</p>';
 try{const data=await json('/api/geocode?'+new URLSearchParams({q,lat:state.origin.lat,lng:state.origin.lng}),{signal:searchController.signal});if(version!==searchSequence)return;options=(Array.isArray(data)?data:data.items||[]).filter(validPoint);$('#suggestions').innerHTML=options.length?options.map((p,i)=>'<button role="option" id="place-'+i+'" aria-selected="false" data-place="'+i+'">'+esc(p.label)+'<small>'+esc(p.subtitle||'')+'</small></button>').join(''):'<p>Δεν βρέθηκε διεύθυνση. Δοκίμασε οδό και περιοχή.</p>'}catch(e){if(version===searchSequence&&e.name!=='AbortError')$('#suggestions').innerHTML='<p>Δεν απάντησε η αναζήτηση. Δοκίμασε ξανά ή επίλεξε σημείο στον χάρτη.</p>'}}
function changeKind(kind){state.kind=kind;state.selected='';state.selectionExplicit=false;$('#pharmacyTab').setAttribute('aria-pressed',String(kind==='pharmacy'));$('#hospitalTab').setAttribute('aria-pressed',String(kind==='hospital'));$('#heroTitle').textContent=kind==='pharmacy'?'Ανοιχτό. Κοντά σου.':'Φροντίδα. Κοντά σου.';$('#nightLabel').hidden=kind!=='pharmacy';$('#specialtyLabel').hidden=kind!=='hospital';$('#onlyOpenLabel').textContent=kind==='pharmacy'?'Μόνο ανοιχτά':'Με εφημερία αυτή την ημέρα';updateSources();render()}
$('#searchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchSequence++;searchController?.abort();closeSuggestions();searchTimer=setTimeout(searchPlaces,400)});
$('#searchInput').addEventListener('keydown',e=>{if(e.key==='Escape'){searchSequence++;searchController?.abort();closeSuggestions()}else if(['ArrowDown','ArrowUp'].includes(e.key)&&options.length){e.preventDefault();activeOption=(activeOption+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;$$('[data-place]').forEach((el,i)=>el.setAttribute('aria-selected',String(i===activeOption)));$('#searchInput').setAttribute('aria-activedescendant','place-'+activeOption);$('#place-'+activeOption)?.scrollIntoView({block:'nearest'})}else if(e.key==='Enter'){e.preventDefault();if(options.length)choosePlace(Math.max(0,activeOption));else{clearTimeout(searchTimer);searchPlaces()}}});
$('#suggestions').addEventListener('click',e=>{const el=e.target.closest('[data-place]');if(el)choosePlace(+el.dataset.place)});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.search-wrap')){searchSequence++;searchController?.abort();clearTimeout(searchTimer);closeSuggestions()}});
$('#locBtn').onclick=()=>locate(true);$('#pauseBtn').onclick=()=>{locationStartup.paused();stopLocation();notice('#locationNotice','Η παρακολούθηση σταμάτησε. Διατηρείται η τελευταία θέση.');follow(false)};
$('#followBtn').onclick=()=>{if(!state.user)return;follow(true);map?.flyTo([state.user.lat,state.user.lng],Math.max(16,map.getZoom()),{animate:!reduced,duration:.6})};
$('#pickBtn').onclick=()=>{state.picking=!state.picking;$('#pickBtn').setAttribute('aria-pressed',String(state.picking));notice('#locationNotice',state.picking?'Πάτησε στον χάρτη για να ορίσεις αφετηρία.':'');if(state.picking)$('#map').scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'})};
$('#darkBtn').onclick=()=>setLayer('dark');$('#satelliteBtn').onclick=()=>setLayer('satellite');$('#allPinsBtn').onclick=showAll;
$('#pharmacyTab').onclick=()=>changeKind('pharmacy');$('#hospitalTab').onclick=()=>changeKind('hospital');$('#results').onclick=e=>{const el=e.target.closest('[data-select]');if(el)selectRow(el.dataset.select)};
$('#date').value=localDate();$('#date').min=addDay(localDate(),-1);$('#date').max=addDay(localDate(),14);
$('#when').onchange=()=>{$('#customTime').hidden=$('#when').value==='now';state.selected='';loadData()};
for(const id of ['date','hour'])$('#'+id).onchange=()=>{if($('#date').value&&$('#hour').value)loadData()};
for(const id of ['onlyOpen','night','specialty','sort'])$('#'+id).onchange=()=>{updateSources();render()};
$('#mode').onchange=()=>{state.mode=$('#mode').value;cancelRoutes();render()};$('#refreshBtn').onclick=()=>loadData(true);
$('#helpBtn').onclick=()=>{help();$('#helpDialog').showModal();$('#helpDialog').scrollTop=0};$('#retryLocation').onclick=()=>{$('#helpDialog').close();locate(true)};$('#chooseAddress').onclick=()=>{$('#helpDialog').close();$('#searchInput').focus()};
$('#reloadApp').onclick=()=>location.reload();
$('#copyDiagnostic').onclick=async()=>{try{await navigator.clipboard.writeText($('#diagnostic').textContent);$('#copyDiagnostic').textContent='Αντιγράφηκε'}catch{$('#copyDiagnostic').textContent='Επίλεξε και αντέγραψε το κείμενο παραπάνω'}};
$('#sourcesBtn').onclick=()=>{$('#sourceRows').innerHTML=sourceMarkup()||'<p>Δεν έχουν ληφθεί πηγές ακόμη.</p>';$('#sourcesDialog').showModal()};$$('[data-close]').forEach(el=>el.onclick=()=>$('#'+el.dataset.close).close());
$('#assistantForm').onsubmit=async e=>{e.preventDefault();$('#intentBtn').disabled=true;$('#applyIntent').hidden=true;$('#intentResult').textContent='Αναγνώριση προτίμησης…';try{intent=await post('/api/intent',{text:$('#intentInput').value});$('#intentResult').textContent=intent.label;$('#applyIntent').hidden=intent.intent==='unknown'}catch(e){$('#intentResult').textContent=e.message}finally{$('#intentBtn').disabled=false}};
$('#applyIntent').onclick=()=>{const type=intent?.intent;if(!type||type==='unknown')return;$('#onlyOpen').checked=true;$('#when').value='now';$('#customTime').hidden=true;$('#night').checked=type==='night';$('#sort').value=type==='distance'?'distance':'eta';if(['walking','driving'].includes(type)){state.mode=type;$('#mode').value=type}state.kind='pharmacy';changeKind('pharmacy');loadData();$('#applyIntent').hidden=true;$('#intentResult').textContent='Εφαρμόστηκε: '+intent.label};
document.addEventListener('visibilitychange',()=>{if(document.hidden){geoController?.abort();liveController?.abort();state.tracking=false;updateLocationUI()}else{if(wantsLive)startWatch();loadData()}});
window.addEventListener('pagehide',()=>{geoController?.abort();liveController?.abort()});
window.addEventListener('pageshow',e=>{if(e.persisted&&wantsLive)startWatch()});
initMap();updateLocationUI();loadData();
if(locationStartup.automatic)requestAnimationFrame(()=>{if(!document.hidden&&locationAttempt===0)locate(false)});
else notice('#locationNotice','Πρώτη ενεργοποίηση στην αρχική οθόνη: πάτησε «Ενεργοποίηση θέσης» και επίλεξε αποδοχή, αν εμφανιστεί ερώτηση.');
setInterval(()=>{if(document.hidden)return;if(state.tracking&&Date.now()-lastFix>45000){state.tracking=false;updateLocationUI();notice('#locationNotice','Αναμονή νέου σήματος. Φαίνεται η τελευταία ληφθείσα θέση.')}loadData()},30000);
