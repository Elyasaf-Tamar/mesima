/* Same occurrence rules as Android's NativeRepo and the web Store. */
exports.blocked=(snapshot,meta)=>{
 if(!meta?.taskId||!snapshot)return false;
 const t=snapshot.tasks?.find(t=>t.id===meta.taskId);if(!t||t.archived||t.done)return true;
 if(t.daily&&t.log?.[meta.day])return true;
 if(meta.checklistId){const c=t.checklists?.find(c=>c.id===meta.checklistId);if(!c)return true;const cycle=meta.occurrence||meta.day;return c.completedCycles?.includes(cycle)||!!c.complete&&c.cycle===cycle;}
 return false;
};

exports.reconcileAlarms=(list,previous)=>{
 const old=new Map(previous.map(alarm=>[alarm.id,alarm]));
 return list.filter(alarm=>typeof alarm.id==='string'&&Number.isFinite(alarm.at)).map(alarm=>{
  const before=old.get(alarm.id);
  return {...alarm,fired:!!before?.fired&&before.at===alarm.at&&before.occurrence===alarm.occurrence};
 });
};
