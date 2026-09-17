/* Same occurrence rules as Android's NativeRepo and the web Store. */
exports.blocked=(snapshot,meta)=>{
 if(!meta?.taskId||!snapshot)return false;
 const t=snapshot.tasks?.find(t=>t.id===meta.taskId);if(!t||t.archived||t.done)return true;
 if(t.daily&&t.log?.[meta.day])return true;
 if(meta.checklistId){const c=t.checklists?.find(c=>c.id===meta.checklistId);if(!c)return true;return !!c.complete&&c.cycle===(meta.occurrence||meta.day);}
 return false;
};
