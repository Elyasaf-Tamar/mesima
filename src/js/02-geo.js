const Geo = (() => {
  let watchId = null, last = null, lastErr = null;
  const listeners = [];
  /* צבירת מרחק נסיעה: מתאפס אחרי עצירה ממושכת */
  const NOISE_M = 20;          // מתחת לזה זה רעש GPS, לא תנועה
  const STOP_MS = 6*60*1000;   // 6 דקות בלי תנועה = הרצף נשבר
  const MAX_KMH = 250;         // מעל זה זו קפיצת GPS, לא נסיעה
  let trip = { meters:0, startedAt:null, lastMoveAt:null, prev:null };

  try{const saved=JSON.parse(localStorage.getItem('mesima.trip')||'null');if(saved?.prev)trip=saved;}catch{}
  const R = 6371000, rad = d => d*Math.PI/180;
  function dist(a,b){
    const dLat = rad(b.lat-a.lat), dLng = rad(b.lng-a.lng);
    const s = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function feed(fix){
    const now = fix.t, prev = trip.prev;
    last = fix;

    if (!prev){
      trip.prev = fix; trip.startedAt = now; trip.lastMoveAt = now;
      listeners.forEach(f => f(fix)); return;
    }

    const d     = dist(prev, fix);
    const dtSec = Math.max(1, (now - (prev.t || now)) / 1000);
    const kmh   = (d / 1000) / (dtSec / 3600);
    const broke = trip.lastMoveAt && (now - trip.lastMoveAt > STOP_MS);

    if (broke){
      /* עמדנו זמן רב: "ברצף" נשבר. נסיעה חדשה מתחילה כאן, בלי לספור את הפער. */
      resetTrip(now, fix);
    } else if (kmh > MAX_KMH){
      /* קפיצת GPS (מנהרה, איבוד קליטה) – מיישרים את הנקודה בלי לצבור מרחק */
      trip.prev = fix;
    } else if (d >= NOISE_M){
      trip.meters += d;
      trip.lastMoveAt = now;
      if (!trip.startedAt) trip.startedAt = now;
      trip.prev = fix;
    }
    /* d קטן מהרעש: משאירים prev כדי שזחילה איטית תצטבר ולא תיבלע */

    try{localStorage.setItem('mesima.trip',JSON.stringify(trip));}catch{}
    listeners.forEach(f => f(fix));
  }
  function resetTrip(now, fix){
    const t = now || Date.now();
    trip = { meters:0, startedAt:t, lastMoveAt:t, prev: fix || last };
  }

  return {
    dist, feed,
    get last(){ return window.MesimaNative?.locationState ? NativeState.location?.trip?.last || last : last; },
    get lastError(){ return lastErr; },
    get on(){ return watchId !== null || !!window.MesimaNative?.locationState && !!NativeState.location?.running; },
    get trip(){ if(window.MesimaNative?.locationState && NativeState.location?.trip)return NativeState.location.trip; return { meters:trip.meters, startedAt:trip.startedAt, lastMoveAt:trip.lastMoveAt }; },
    resetTrip,
    onFix(f){ listeners.push(f); },
    supported(){ return !!(navigator.geolocation) && window.isSecureContext !== false; },

    /* maximumAge:0 – 20 שניות ברכב זה 300 מטר, ואז נשמר המקום הלא נכון */
    now(){
      return new Promise((res, rej) => {
        if (!navigator.geolocation) return rej({ code:-1, message:'no-geo' });
        navigator.geolocation.getCurrentPosition(
          p => { const f = { lat:p.coords.latitude, lng:p.coords.longitude, acc:p.coords.accuracy, t:Date.now() };
                 lastErr = null; feed(f); res(f); },
          e => { lastErr = e; rej(e); },
          { enableHighAccuracy:true, timeout:15000, maximumAge:0 }
        );
      });
    },
    start(){
      if(window.MesimaNative?.locationState){NativeState.publish();return true;}
      if (watchId !== null || !navigator.geolocation) return false;
      watchId = navigator.geolocation.watchPosition(
        p => { lastErr = null;
               feed({ lat:p.coords.latitude, lng:p.coords.longitude, acc:p.coords.accuracy, t:Date.now() }); },
        err => { lastErr = err; Geo.stop();
                 UI.toast(err.code===1 ? 'הרשאת מיקום נדחתה' : 'שגיאת מיקום'); UI.render(); },
        { enableHighAccuracy:true, maximumAge:5000, timeout:27000 }
      );
      return true;
    },
    stop(){ if (watchId!==null){ navigator.geolocation.clearWatch(watchId); watchId = null; } },

    route(from, points){
      const left = points.slice(), out = []; let cur = from, total = 0;
      while (left.length){
        let bi=0, bd=Infinity;
        left.forEach((p,i)=>{ const d=dist(cur,p); if(d<bd){bd=d;bi=i;} });
        const nx = left.splice(bi,1)[0];
        total += bd; out.push({ ...nx, leg:bd }); cur = nx;
      }
      return { stops:out, total };
    },
  };
})();

/* ------------------------------- Search --------------------------------- */
/* חיפוש מקום בשם. שלושה ספקים בטור, כולם חינמיים וללא מפתח.
   Nominatim ראשון כי הוא המנוע עם הכיסוי הטוב ביותר לעסקים, חנויות וכתובות.
   israelhiking אחרון — הוא מאגר של מפת שבילים, מצוין למעיינות וחורשות
   ולא רלוונטי לסופר או למשרד. */
