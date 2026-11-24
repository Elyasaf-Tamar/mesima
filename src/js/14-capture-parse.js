/* Hebrew date/time recognition for quick notes. Rule based and local: it
   only suggests a date; the user confirms it when turning a note into a task.
   A bare hour 1–7 is read as afternoon and flagged uncertain. */
const CaptureParse=(()=>{
  const B='(?<![\\p{L}\\p{N}])',E='(?![\\p{L}\\p{N}])',SEP='[\\-\\u05BE\\s]?';
  const pad=n=>String(n).padStart(2,'0');
  const key=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const addDays=(d,n)=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);return x;};
  const WEEK={'ראשון':0,'שני':1,'שלישי':2,'רביעי':3,'חמישי':4,'שישי':5,'שבת':6,
    'א':0,'ב':1,'ג':2,'ד':3,'ה':4,'ו':5};
  const DAYNAME=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','שבת'];
  const PARTS=[['בבוקר',9],['בצהריים',13],['בצהרים',13],['אחה"צ',16],['אחה״צ',16],['אחר הצהריים',16],['אחרי הצהריים',16],['בערב',20],['בלילה',22]];
  const NUM={'שעה':[1,'h'],'שעתיים':[2,'h'],'חצי שעה':[30,'m'],'רבע שעה':[15,'m'],'יום':[1,'d'],'יומיים':[2,'d'],
    'שבוע':[7,'d'],'שבועיים':[14,'d'],'חודש':[1,'M']};
  const UNIT={'דקות':'m','דק':'m','שעות':'h','ימים':'d','שבועות':'w','חודשים':'M'};
  const rx=(s,f='gu')=>new RegExp(s,f);

  function parse(text,now=new Date()){
    if(typeof text!=='string'||!text.trim())return null;
    const spans=[];let day=null,time=null,uncertain=false,abs=null,part=null;
    const take=(m)=>spans.push([m.index,m.index+m[0].length]);
    const free=(m)=>!spans.some(([a,b])=>m.index<b&&m.index+m[0].length>a);
    let m;
    // Relative offsets: בעוד 3 ימים / בעוד שעה / בעוד 20 דקות.
    const rel=rx(B+'בעוד\\s+(?:(\\d{1,3})\\s*('+Object.keys(UNIT).join('|')+')|('+Object.keys(NUM).join('|')+'))'+E);
    while((m=rel.exec(text))){
      if(!free(m))continue;const [n,u]=m[1]?[+m[1],UNIT[m[2]]]:NUM[m[3]];
      const x=new Date(now.getTime());
      if(u==='m')x.setMinutes(x.getMinutes()+n);else if(u==='h')x.setHours(x.getHours()+n);
      else if(u==='d')abs=addDays(now,n);else if(u==='w')abs=addDays(now,n*7);
      else if(u==='M')abs=new Date(now.getFullYear(),now.getMonth()+n,now.getDate());
      if(u==='m'||u==='h'){abs=x;time=pad(x.getHours())+':'+pad(x.getMinutes());}
      take(m);break;
    }
    // Relative days.
    const days=rx(B+'(ו?)(היום|הערב|הלילה|מחרתיים|מחר)'+E);
    while(!abs&&(m=days.exec(text))){
      if(!free(m))continue;const w=m[2];
      day=w==='מחרתיים'?2:w==='מחר'?1:0;if(w==='הערב')part=20;if(w==='הלילה')part=22;take(m);break;
    }
    // Weekdays: ביום רביעי, יום ב׳, בשבת.
    const wk=rx(B+'(?:ו?ב?יום\\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|[אבגדהו](?:[\'׳`]|(?=\\s|$)))|ו?ב?(שבת))'+E.replace('\\p{N}','\\p{N}\'׳'));
    while(day===null&&!abs&&(m=wk.exec(text))){
      if(!free(m))continue;const name=(m[1]||m[2]).replace(/['׳`]/,'');if(!(name in WEEK))continue;
      let diff=(WEEK[name]-now.getDay()+7)%7;if(diff===0)diff=7;day=diff;take(m);break;
    }
    // Numeric dates: 25/11, 3.1, 1/3/2027.
    const dt=rx(B+'(ב[\\-\\u05BE]?)?(\\d{1,2})([./])(\\d{1,2})(?:[./](\\d{2}|\\d{4}))?(?![\\d%./])');
    const SCORE=/(?:ציון|דירוג|גרסה|גירסה|גרסת|מתוך|יחס|כוכבים)\s*$/u;
    while(day===null&&!abs&&(m=dt.exec(text))){
      if(!free(m))continue;
      if(SCORE.test(text.slice(0,m.index))||/^\s*(?:כוכבים|נקודות|אחוז|%)/u.test(text.slice(m.index+m[0].length)))continue;
      if(m[3]==='.'&&!m[1]&&!m[5])continue; // 1.2 is a number unless "ב-1.2" or a full date
      m={index:m.index,0:m[0],1:m[2],2:m[4],3:m[5]};
      const d=+m[1],mo=+m[2];let y=m[3]?(+m[3]<100?2000+ +m[3]:+m[3]):now.getFullYear();
      const x=new Date(y,mo-1,d);if(x.getMonth()!==mo-1||x.getDate()!==d){spans.length=0;return null;}
      if(!m[3]&&key(x)<key(now))x.setFullYear(y+1);abs=x;take(m);break;
    }
    // Parts of the day.
    for(const [w,h] of PARTS){
      const r=rx(B+'ו?'+w.replace(/"/g,'["״]')+E);
      if((m=r.exec(text))&&free(m)){part=h;take(m);break;}
    }
    // Explicit hour: ב-5, ב־17:30, בשעה 9, 17:30.
    if(!time){
      const hr=rx(B+'(?:ו?ב(?:שעה)?'+SEP+'(\\d{1,2})(?::(\\d{2}))?|(\\d{1,2}):(\\d{2}))(?![\\d%./,:]|\\s*(?:%|ש["״]?ח|שקל|ק["״]?ג|ק["״]?מ|מ["״]?ל|גרם|ליטר|אחוז|ימים|יום|שעות|דקות|שבועות|חודשים|פעמים|לחודש|בחודש))');
      while((m=hr.exec(text))){
        if(!free(m))continue;
        let h=+(m[1]??m[3]),mi=+(m[2]??m[4]??0);if(h>23||mi>59)continue;
        if(part!==null){if(part>=20&&h===12)h=0;else if(part===22&&h<=5){}else if(part>=13&&h<12)h+=12;}
        else if(m[1]!==undefined&&m[2]===undefined&&h>=1&&h<=7){h+=12;uncertain=true;}
        time=pad(h)+':'+pad(mi);take(m);break;
      }
    }
    if(!time&&part!==null)time=pad(part)+':00';
    if(!spans.length)return null;
    let date;
    if(abs)date=abs;
    else if(day!==null)date=addDays(now,day);
    else{
      // Only a time: today if still ahead, otherwise tomorrow.
      const [h,mi]=time.split(':').map(Number),t=new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,mi);
      date=t>now?now:addDays(now,1);
    }
    spans.sort((a,b)=>a[0]-b[0]);
    const index=spans[0][0],end=Math.max(...spans.map(s=>s[1]));
    return {date:key(date),time,uncertain,index,length:end-index,spans,label:label(key(date),time,now)};
  }
  function label(date,time,now=new Date()){
    const d=new Date(date+'T12:00:00'),diff=Math.round((d-new Date(key(now)+'T12:00:00'))/86400000);
    const name=diff===0?'היום':diff===1?'מחר':diff===2?'מחרתיים':diff>0&&diff<7?'יום '+DAYNAME[d.getDay()]:d.getDate()+'/'+(d.getMonth()+1);
    return name+(time?' '+time:'');
  }
  function strip(text,r){
    if(!r)return text.trim();let out='';let last=0;
    for(const [a,b] of r.spans){out+=text.slice(last,a)+' ';last=b;}
    return (out+text.slice(last)).split('\n').map(l=>l.replace(/[ \t]+/g,' ').replace(/^\s*[,.\-–]\s*|\s*[,\-–]\s*$/g,'').trim()).filter((l,i,a)=>l||i&&a[i-1]).join('\n').trim();
  }
  function tags(text){
    const out=new Set();const r=/(?:^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{1,40})/gu;let m;
    while((m=r.exec(String(text||''))))out.add(m[1]);return out;
  }
  return {parse,strip,tags,label};
})();
