import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DIR=dirname(fileURLToPath(import.meta.url));
const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'2mb'}));
const UPSTREAM='https://poufarmakas.sendsmith1953.chatgpt.site';

async function proxy(req,res){
  try{
    const url=new URL(req.originalUrl,UPSTREAM);
    const headers={'accept':req.headers.accept||'*/*','user-agent':'PouFarmaka/1.0'};
    if(req.headers['content-type'])headers['content-type']=req.headers['content-type'];
    const init={method:req.method,headers,redirect:'follow'};
    if(!['GET','HEAD'].includes(req.method)) init.body=JSON.stringify(req.body??{});
    const up=await fetch(url,init);
    res.status(up.status);
    res.setHeader('cache-control','no-store');
    res.setHeader('permissions-policy','geolocation=(self)');
    res.setHeader('content-type',up.headers.get('content-type')||'application/json; charset=utf-8');
    const buf=Buffer.from(await up.arrayBuffer());
    res.send(buf);
  }catch(e){
    res.status(502).json({error:'upstream_unavailable'});
  }
}
app.use('/api',proxy);
app.use(express.static(join(DIR,'public'),{maxAge:0,setHeaders(res){res.setHeader('cache-control','no-store');res.setHeader('permissions-policy','geolocation=(self)')}}));
app.get('*',(req,res)=>res.sendFile(join(DIR,'public','index.html')));
app.listen(process.env.PORT||3000);
export default app;