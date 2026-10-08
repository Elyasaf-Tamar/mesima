const Alerts = (() => {
  let ctx = null;const shown=new Map();let subscribed=false;
  const beep = () => {
    if (!Store.all.prefs.snd) return;
    try {
      ctx = ctx || new (window.AudioContext||window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      [0,.18,.36].forEach(off => {
        const o=ctx.createOscillator(), g=ctx.createGain(), t=ctx.currentTime+off;
        o.type='sine'; o.frequency.setValueAtTime(880,t);
        g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.28,t+.02);
        g.gain.exponentialRampToValueAtTime(.001,t+.15);
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t+.16);
      });
    } catch(e){}
  };
  const vibrate = () => {
    if (!Store.all.prefs.vib) return;
    try { navigator.vibrate && navigator.vibrate([220,110,220,110,380]); } catch(e){}
  };
  const system = (title, body, item, explicitMeta) => {
    if (!Store.all.prefs.notif) return;
    /* באפליקציה המותקנת ההתראה מגיעה מ-AlarmManager דרך Kotlin.
       הודעה שנייה מהדפדפן הייתה כפילות. */
    if (Native.on) return;
    try {
      if (typeof Notification!=='undefined' && Notification.permission==='granted')
        {const meta=explicitMeta||ReminderLink.resolve(item.id),id=meta?.reminderId||item.id,n=new Notification(title, {body,tag:'mesima:'+id,dir:'rtl',lang:'he'});shown.set(id,{n,meta});n.onclick=()=>window.__alarm?.(id);if(!subscribed){subscribed=true;Store.onChange(()=>{for(const [id,x] of shown)if(Store.reminderBlocked(x.meta)){x.n.close();shown.delete(id);}});}}
    } catch(e){}
  };
  return {
    /** האם למתג "התראות מערכת" יש בכלל על מה לשלוט כאן */
    get supported(){
      /* במעטפת המותקנת ההתראות מגיעות מ-Kotlin, והמתג הזה לא שולט בכלום.
         ב-WebView גם אין Notification API בכלל — ולכן המתג לא היה נדלק
         לעולם, בלי שום הסבר. */
      return !Native.on && typeof Notification !== 'undefined';
    },
    async ask(){
      if (!this.supported) return false;
      try { return (await Notification.requestPermission()) === 'granted'; } catch(e){ return false; }
    },
    fire(item, why, kind,meta){ meta=meta||ReminderLink.resolve(item.id);if(NativeState.available()||Store.reminderBlocked(meta))return; vibrate(); beep(); system(item.title,item.note||why,item,meta); UI.showAlert(item, why, kind,meta); },
  };
})();

/* --------------------------------- Cal ---------------------------------- */
