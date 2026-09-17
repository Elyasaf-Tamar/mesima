/* Explicit searches only; never autocomplete public geocoding endpoints. */
const Search=(()=>{
 const known=[{name:'סטימצקי',city:'גן שמואל',lat:32.448385,lng:34.955013,source:'https://www.steimatzky.co.il/storelocator'}];
 const aliases={'סטימצקי':'Steimatzky','סופר פארם':'Super-Pharm','סופרפארם':'Super-Pharm','שופרסל':'Shufersal','רמי לוי':'Rami Levy','איקאה':'IKEA','צומת ספרים':'Tzomet Sfarim'};
 const cache=new Map(),pending=new Map();let nomQueue=Promise.resolve(),nomAt=0;
 window.__placeResult=(id,text,error)=>{const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);error?p.reject(Error(error)):p.resolve(JSON.parse(text));};
 async function fetchJSON(url){
  const hit=cache.get(url);if(hit&&Date.now()-hit.at<3600000)return hit.value;
  const work=async()=>{
   if(url.includes('nominatim.')){await new Promise(r=>setTimeout(r,Math.max(0,1100-(Date.now()-nomAt))));nomAt=Date.now();}
   let value;
   if(window.MesimaNative?.searchPlaces){value=await new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('זמן החיפוש הסתיים'));},16000);pending.set(id,{resolve,reject,timer});window.MesimaNative.searchPlaces(id,url);});}
   else if(window.MesimaDesktop?.searchPlaces)value=await window.MesimaDesktop.searchPlaces(url);
   else{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),14000);try{const r=await fetch(url,{signal:controller.signal});if(!r.ok)throw Error('חיבור לשירות החיפוש נכשל ('+r.status+')');value=await r.json();}finally{clearTimeout(timer);}}
   cache.set(url,{value,at:Date.now()});return value;
  };
  if(url.includes('nominatim.')){const p=nomQueue.then(work);nomQueue=p.catch(()=>{});return p;}return work();
 }
 const valid=r=>r&&Number.isFinite(r.lat)&&Number.isFinite(r.lng)&&Math.abs(r.lat)<=90&&Math.abs(r.lng)<=180;
 async function nom(q){const data=await fetchJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=15&accept-language=he&q='+encodeURIComponent(q));return data.map(x=>({name:x.name||x.display_name?.split(',')[0]||q,city:x.display_name||'',lat:+x.lat,lng:+x.lon,source:'OpenStreetMap'})).filter(valid);}
 async function photon(q,anchor){const data=await fetchJSON('https://photon.komoot.io/api/?limit=15&q='+encodeURIComponent(q)+(anchor?'&lat='+anchor.lat+'&lon='+anchor.lng:''));return (data.features||[]).map(f=>({name:f.properties?.name||f.properties?.street||q,city:[f.properties?.city,f.properties?.street,f.properties?.housenumber].filter(Boolean).join(', '),lat:f.geometry?.coordinates?.[1],lng:f.geometry?.coordinates?.[0],source:'OpenStreetMap'})).filter(valid);}
 async function around(q,a){
  if(!a)return [];
  const pattern=[q,aliases[q]].filter(Boolean).map(x=>x.replace(/[.*+?^${}()|[\]\\"]/g,'\\$&')).join('|');
  const query='[out:json][timeout:12];(nwr["name"~"'+pattern+'",i](around:20000,'+a.lat+','+a.lng+');nwr["name:he"~"'+pattern+'",i](around:20000,'+a.lat+','+a.lng+'););out center 25;';
  const data=await fetchJSON('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(query));return(data.elements||[]).map(e=>({name:e.tags?.['name:he']||e.tags?.name||q,city:e.tags?.['addr:city']||'',lat:e.lat??e.center?.lat,lng:e.lon??e.center?.lon,source:'OpenStreetMap'})).filter(valid);
 }
 function parseCoords(s){
  const text=String(s);let m=text.match(/(?:@|[?&](?:q|query|ll)=)(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)||text.match(/^\s*(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*$/);
  if(!m)return null;const r={lat:+m[1],lng:+m[2]};return valid(r)?r:null;
 }
 async function run(q,area=''){
  q=q.trim().slice(0,160);area=area.trim().slice(0,100);const coords=parseCoords(q);if(coords)return{results:[{...coords,name:'מיקום שנבחר',city:'',source:'קואורדינטות'}],provider:'קואורדינטות'};
  const comma=q.split(/[,،]/).map(x=>x.trim()).filter(Boolean);if(!area&&comma.length>1){q=comma.shift();area=comma.join(' ');}
  if(!area){const exact=known.find(x=>q.includes(x.name)&&q.includes(x.city));if(exact){q=exact.name;area=exact.city;}}
  const text=q+' '+area,verified=known.filter(x=>[x.name,aliases[x.name]].some(n=>n&&text.toLowerCase().includes(n.toLowerCase()))&&text.includes(x.city));
  let anchor=null;
  if(area){const geo=await Promise.allSettled([nom(area),photon(area)]);anchor=geo.flatMap(x=>x.status==='fulfilled'?x.value:[])[0]||null;}
  const settled=await Promise.allSettled([nom([q,area].filter(Boolean).join(', ')),photon([aliases[q]||q,area].filter(Boolean).join(' '),anchor),around(q,anchor)]);
  const all=[...verified,...settled.flatMap(r=>r.status==='fulfilled'?r.value:[])],out=[];
  const clean=s=>String(s).toLowerCase().replace(/[\u0591-\u05c7'"׳״־–-]/g,'').replace(/\s+/g,' ').trim();
  const variants=[q,aliases[q]].filter(Boolean).map(clean);
  for(const r of all){
   if(!valid(r)||out.some(o=>Geo.dist(o,r)<60))continue;
   if(!verified.includes(r)&&!variants.some(v=>v.split(' ').every(word=>clean(r.name+' '+r.city).includes(word))))continue;
   if(anchor&&!verified.includes(r)&&Geo.dist(anchor,r)>30000)continue;out.push({...r,dist:anchor?Geo.dist(anchor,r):null});
  }
  if(!out.length&&settled.every(x=>x.status==='rejected'))throw Error('שירותי החיפוש לא זמינים כרגע. בדוק חיבור לאינטרנט ונסה שוב.');
  return {results:out.slice(0,25),provider:'© OpenStreetMap contributors',empty:!out.length};
 }
 return {run,parseCoords,fetchJSON};
})();
