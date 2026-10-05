import express from 'express';

const app=express();
app.disable('x-powered-by');
const UPSTREAM='https://poufarmakas.sendsmith1953.chatgpt.site';

const NIGHT_CSS=`
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=DM+Sans:wght@400;500;600;700;800&family=Fira+Sans+Condensed:ital,wght@0,600;0,700;1,600&display=swap" rel="stylesheet">
<style id="poufarmaka-night">
:root{--pf-bg:#03050b;--pf-panel:#090f22;--pf-panel2:#11183a;--pf-cyan:#59d8d0;--pf-pink:#ff6fae;--pf-peach:#ffad8e;--pf-violet:#7863d8;--pf-text:#fff7fb;--pf-muted:#b6bdd0}
html,body,#root,[data-reactroot]{background:#03050b!important;color:var(--pf-text)!important;font-family:"DM Sans",system-ui,sans-serif!important}
body{background:
 radial-gradient(900px 420px at 50% -10%,rgba(120,99,216,.10),transparent 62%),
 radial-gradient(700px 420px at 100% 0%,rgba(255,111,174,.08),transparent 64%),
 linear-gradient(180deg,#03050b 0%,#060914 48%,#04060c 100%)!important}
body:before{content:"";position:fixed;inset:0;pointer-events:none;z-index:2147483000;opacity:.065;background:
 radial-gradient(circle at 12% 18%,rgba(255,255,255,.75) 0 1px,transparent 1.15px),
 radial-gradient(circle at 72% 22%,rgba(255,255,255,.55) 0 1px,transparent 1.15px),
 radial-gradient(circle at 44% 11%,rgba(255,255,255,.48) 0 1px,transparent 1.15px),
 repeating-linear-gradient(0deg,rgba(255,255,255,.055) 0 1px,transparent 1px 6px);
 background-size:220px 180px,260px 220px,300px 250px,auto;mix-blend-mode:screen}
body:after{content:"";position:fixed;left:0;right:0;height:16%;top:-20%;z-index:2147482999;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(255,255,255,.10),transparent);filter:blur(2px);animation:pftrack 5.5s linear infinite}
@keyframes pftrack{to{top:115%}}
header,[class*="header"],[class*="Header"],nav,[class*="topbar"],[class*="Topbar"]{background:rgba(3,5,11,.94)!important;color:#fff!important;border-color:rgba(255,255,255,.10)!important}
h1,h2,h3,[class*="title"],[class*="Title"]{font-family:"Anton",sans-serif!important;font-style:italic!important;letter-spacing:.01em!important;color:#fff8fc!important}
h1{font-size:clamp(42px,10vw,78px)!important;text-shadow:3px 3px 0 rgba(255,111,174,.60),0 0 22px rgba(89,216,208,.35)!important}
h2{font-size:clamp(30px,7vw,50px)!important}
p,span,label,small{color:inherit}
[class*="card"],[class*="panel"],[class*="Panel"],[class*="sidebar"],[class*="Sidebar"],[class*="sheet"],[class*="Sheet"]{
 background:linear-gradient(180deg,rgba(9,15,34,.96),rgba(5,8,19,.98))!important;
 color:#fff!important;border-color:rgba(255,255,255,.10)!important;
 box-shadow:7px 7px 0 rgba(255,111,174,.10),0 18px 42px rgba(0,0,0,.42)!important
}
button,[role="button"],a[class*="button"],a[class*="Button"]{font-family:"DM Sans",system-ui,sans-serif!important;font-weight:800!important}
button:not(.leaflet-control-zoom-in):not(.leaflet-control-zoom-out),[role="button"]{
 border-radius:2px 13px 2px 13px!important;border-color:rgba(255,255,255,.15)!important;
 background:#101833!important;color:#fff!important
}
button:hover,[role="button"]:hover{filter:brightness(1.12)}
button[class*="primary"],button[class*="active"],button[aria-pressed="true"],[class*="Primary"],[class*="Active"]{
 background:var(--pf-cyan)!important;color:#07101d!important;box-shadow:4px 4px 0 var(--pf-pink)!important
}
input,select,textarea{background:#070b17!important;color:#fff!important;border:1px solid rgba(255,255,255,.14)!important;border-radius:2px 11px 2px 11px!important}
input::placeholder,textarea::placeholder{color:#8f97ad!important}
[class*="badge"],[class*="chip"],[class*="pill"]{border-radius:2px 9px 2px 9px!important;background:#111a36!important;color:#fff!important;border-color:rgba(255,255,255,.12)!important}
[class*="open"],[class*="Open"],[class*="success"],[class*="Success"]{color:#9ffff4!important}
.leaflet-container{background:#07101d!important;filter:saturate(.82) brightness(.78) contrast(1.08)}
.leaflet-control-zoom a,.leaflet-control-attribution{background:#07101d!important;color:#fff!important;border-color:rgba(255,255,255,.15)!important}
.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#091022!important;color:#fff!important}
a{color:#8ff7ee!important}
table,tbody,tr,td,th{background-color:transparent!important;color:#fff!important;border-color:rgba(255,255,255,.08)!important}
[class*="result"],[class*="Result"],li{color:#fff!important}
[class*="muted"],[class*="secondary"],[class*="Secondary"]{color:var(--pf-muted)!important}
#pf-brand{position:fixed;z-index:2147482000;left:14px;top:max(12px,env(safe-area-inset-top));pointer-events:none}
#pf-brand .name{font:400 clamp(34px,8vw,56px)/.82 "Anton",sans-serif;font-style:italic;color:#aafff7;text-shadow:3px 3px 0 var(--pf-pink),6px 6px 0 rgba(0,0,0,.36),0 0 20px rgba(89,216,208,.45)}
#pf-brand .tag{font:700 11px/1 "Fira Sans Condensed",sans-serif;letter-spacing:.18em;color:#ff8fbe;margin-top:8px}
@media(max-width:700px){body{font-size:17px!important}button,[role="button"]{font-size:16px!important;min-height:46px!important}input,select,textarea{font-size:16px!important}}
</style>
<script>
(()=>{const rename=()=>{document.title='PouFarmaka · Miami Nights';document.querySelectorAll('h1,h2,h3,[class*="brand"],[class*="logo"]').forEach(el=>{if(/φαρμακείο τώρα|poufarmakas|poufarmaka/i.test(el.textContent||'')){if(el.matches('.brand')||el.querySelector('.brand-name-accent'))el.innerHTML='<span class="brand-icon"></span><span><b>Pou<span class="brand-name-accent">Farmaka</span></b></span>';else el.textContent='PouFarmaka'}});if(!document.getElementById('pf-brand')){const d=document.createElement('div');d.id='pf-brand';d.innerHTML='<div class="name">PouFarmaka</div><div class="tag">PHARMACY NIGHT SERVICES</div>';document.body.appendChild(d)}};new MutationObserver(rename).observe(document.documentElement,{childList:true,subtree:true});addEventListener('DOMContentLoaded',rename);setTimeout(rename,800)})();
</script>`;

function rewriteHtml(html){
  let out=html.replace(/<title>[\s\S]*?<\/title>/i,'<title>PouFarmaka · Miami Nights</title>');\n  out=out.replace(/PouFarmakas/g,'PouFarmaka');
  out=out.replace(/<meta\s+name=["']theme-color["'][^>]*>/i,'<meta name="theme-color" content="#03050b">');
  if(!/<base\b/i.test(out)) out=out.replace(/<head([^>]*)>/i,'<head$1><base href="/">');
  return out.replace(/<\/head>/i,NIGHT_CSS+'</head>');
}
app.use(async(req,res)=>{
  try{
    const url=new URL(req.originalUrl,UPSTREAM);
    const headers={};
    for(const [k,v] of Object.entries(req.headers)){
      if(['host','content-length','connection','accept-encoding'].includes(k))continue;
      if(v!=null)headers[k]=Array.isArray(v)?v.join(', '):v;
    }
    const init={method:req.method,headers,redirect:'manual'};
    if(!['GET','HEAD'].includes(req.method)){
      const chunks=[]; for await(const c of req)chunks.push(c); init.body=Buffer.concat(chunks);
    }
    const up=await fetch(url,init);
    const ct=up.headers.get('content-type')||'application/octet-stream';
    res.status(up.status);
    for(const [k,v] of up.headers){
      if(['content-length','content-encoding','transfer-encoding','connection','content-security-policy'].includes(k.toLowerCase()))continue;
      res.setHeader(k,v);
    }
    res.setHeader('cache-control','no-store');
    if(ct.includes('text/html')){
      const html=await up.text(); return res.type('html').send(rewriteHtml(html));
    }
    const buf=Buffer.from(await up.arrayBuffer());
    res.type(ct).send(buf);
  }catch(e){
    res.status(502).type('html').send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#03050b;color:white;font-family:system-ui;padding:32px"><h1>PouFarmaka</h1><p>Η υπηρεσία φαρμακείων δεν απάντησε προσωρινά. Δοκίμασε ξανά σε λίγο.</p></body>');
  }
});
app.listen(process.env.PORT||3000);
export default app;
