package il.mesima.app

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/** A projection and a durable, acknowledged command queue. No WebView is required. */
object NativeRepo {
 const val MAX_COMMANDS=20000
 fun prefs(c:Context)=c.getSharedPreferences("mesima_native_state",Context.MODE_PRIVATE)
 fun today()=SimpleDateFormat("yyyy-MM-dd",Locale.US).format(Date())
 fun objects(a:JSONArray)= (0 until a.length()).mapNotNull{a.optJSONObject(it)}
 fun snapshot(c:Context)=runCatching{JSONObject(prefs(c).getString("snapshot","{}")!!)}.getOrDefault(JSONObject())
 fun pending(c:Context)=runCatching{JSONArray(prefs(c).getString("pending","[]"))}.getOrDefault(JSONArray())
 private fun savePending(c:Context,commands:JSONArray):Boolean = try {
  require(commands.length()<=MAX_COMMANDS){"פתח את משימה כדי לסנכרן את הפעולות לפני ביצוע פעולות נוספות מהיישומון"}
  val text=commands.toString();Payloads.bytes(text)
  check(prefs(c).edit().putString("pending",text).remove("actionError").commit()){"לא ניתן לשמור את הפעולה במכשיר"}
  true
 }catch(e:Exception){
  val message=e.message?:"לא ניתן לשמור את הפעולה במכשיר"
  prefs(c).edit().putString("actionError",message).apply()
  android.os.Handler(android.os.Looper.getMainLooper()).post{android.widget.Toast.makeText(c,message,android.widget.Toast.LENGTH_LONG).show()}
  false
 }
 fun task(c:Context,id:String)=objects(snapshot(c).optJSONArray("tasks")?:JSONArray()).find{it.optString("id")==id}
 @Synchronized fun save(c:Context,text:String){
  Payloads.bytes(text);val o=JSONObject(text);require(o.optInt("schema")==1&&o.optJSONArray("tasks")!=null)
  check(prefs(c).edit().putString("snapshot",text).commit())
  cancelBlocked(c);Sched.reapply(c);MesimaWidget.updateAll(c)
 }
 @Synchronized fun ack(c:Context,ids:JSONArray){
  val set=(0 until ids.length()).map{ids.optString(it)}.toSet()
  prefs(c).edit().putString("pending",JSONArray(objects(pending(c)).filter{it.optString("id") !in set}).toString()).commit()
 }
 fun blocked(snapshot:JSONObject,pending:JSONArray,meta:JSONObject):Boolean {
  val id=meta.optString("taskId");if(id.isBlank())return false
  val t=objects(snapshot.optJSONArray("tasks")?:JSONArray()).find{it.optString("id")==id}?:return true
  if(t.optBoolean("archived")||t.optBoolean("done"))return true
  val day=meta.optString("day").ifBlank{today()}
  if(t.optBoolean("daily")&&(t.optJSONObject("log")?.optInt(day,0)?:0)>0)return true
  val checklistId=meta.optString("checklistId")
  if(checklistId.isNotBlank()){
   val list=objects(t.optJSONArray("checklists")?:JSONArray()).find{it.optString("id")==checklistId}?:return true
   val occurrence=meta.optString("occurrence").ifBlank{day}
   val completed=list.optJSONArray("completedCycles")
   if(completed!=null&&(0 until completed.length()).any{completed.optString(it)==occurrence})return true
   if(list.optBoolean("complete")&&list.optString("cycle")==occurrence)return true
  }
  return objects(pending).any{it.optString("taskId")==id&&(!t.optBoolean("daily")||it.optString("day")==day)}
 }
 fun blocked(c:Context,m:JSONObject)=blocked(snapshot(c),pending(c),m)
 fun shown(c:Context)=runCatching{JSONObject(prefs(c).getString("shown","{}")!!)}.getOrDefault(JSONObject())
 fun route(meta:JSONObject):JSONObject {
  val route=JSONObject()
  for(key in listOf("id","taskId","kind","day","daily","checklistId","occurrence","eventId","at"))if(meta.has(key))route.put(key,meta.get(key))
  return route
 }
 @Synchronized fun remember(c:Context,id:String,m:JSONObject){
  val all=shown(c);val now=System.currentTimeMillis()
  all.keys().asSequence().toList().forEach{if(now-(all.optJSONObject(it)?.optLong("shownAt")?:0)>14*86400000L)all.remove(it)}
  // Keep routing only; repeating a long task note into every shown record could
  // otherwise multiply the database size for each day of reminders.
  all.put(id,route(m).put("shownAt",now));prefs(c).edit().putString("shown",all.toString()).apply()
 }
 fun resolve(snapshot:JSONObject,id:String,day:String=today()):JSONObject {
  val tasks=objects(snapshot.optJSONArray("tasks")?:JSONArray()).sortedByDescending{it.optString("id").length}
  fun taskLink(t:JSONObject,date:String,daily:Boolean=t.optBoolean("daily"))=JSONObject().put("id",id).put("kind","task").put("taskId",t.getString("id")).put("day",date).put("daily",daily)
  tasks.find{it.optString("id")==id}?.let{return taskLink(it,day)}
  for(t in tasks){
   val tid=t.getString("id")
   if(id=="trip_$tid"||id=="loc_$tid")return taskLink(t,day)
   for(c in objects(t.optJSONArray("checklists")?:JSONArray()).sortedByDescending{it.optString("id").length}){
    val base=tid+"_"+c.getString("id")
    for(prefix in listOf("cl_","co_","c_","cp_","ca_")){
     val head=prefix+base
     if(id!=head&&!id.startsWith(head+"_"))continue
     val date=id.removePrefix(head).removePrefix("_").take(10).takeIf{runCatching{java.time.LocalDate.parse(it)}.isSuccess}.orEmpty()
     return JSONObject().put("id",id).put("kind","checklist").put("taskId",tid).put("checklistId",c.getString("id"))
      .put("day",date.ifBlank{day}).put("occurrence",date.ifBlank{c.optString("cycle").ifBlank{"once-0"}})
    }
   }
   for(prefix in listOf("h_","hp_","ha_","t_")){
    val head=prefix+tid+"_";if(!id.startsWith(head))continue
    val date=id.removePrefix(head).take(10)
    if(runCatching{java.time.LocalDate.parse(date)}.isSuccess)return taskLink(t,date,prefix!="t_")
   }
  }
  if(id.startsWith("e_"))return JSONObject().put("id",id).put("kind","event").put("eventId",id.removePrefix("e_"))
  return JSONObject().put("id",id).put("taskId","").put("kind","task").put("day",day)
 }
 fun meta(c:Context,id:String):JSONObject {
  shown(c).optJSONObject(id)?.let{return it}
  objects(Sched.load(c)).find{it.optString("id")==id}?.let{return it}
  return resolve(snapshot(c),id)
 }
 @Synchronized fun complete(c:Context,taskId:String,day:String=today()){
  val t=task(c,taskId)?:return
  if(t.optString("kind")!="short")return
  val meta=JSONObject().put("taskId",taskId).put("day",day)
  if(blocked(c,meta))return
  val commands=pending(c)
  commands.put(JSONObject().put("id",UUID.randomUUID().toString()).put("taskId",taskId).put("day",day).put("action","complete").put("at",System.currentTimeMillis()))
  if(!savePending(c,commands))return
  cancelBlocked(c);Sched.reapply(c);MesimaWidget.updateAll(c);MainActivity.changed()
 }
 fun cancelBlocked(c:Context){
  val all=shown(c);all.keys().forEach{id->if(blocked(c,all.getJSONObject(id)))NotificationManagerCompat.from(c).cancel(id.hashCode())}
  Sched.cancelBlockedSnoozes(c)
 }
 @Synchronized fun shopping(c:Context,listId:String,itemId:String,done:Boolean){
  val widgets=snapshot(c).optJSONObject("widgets")?:return
  val exists=widgets.keys().asSequence().mapNotNull{widgets.optJSONObject(it)}.any{it.optString("id")==listId&&objects(it.optJSONArray("items")?:JSONArray()).any{item->item.optString("id")==itemId}}
  if(!exists)return
  val commands=pending(c);commands.put(JSONObject().put("id",UUID.randomUUID().toString()).put("action","shopping").put("listId",listId).put("itemId",itemId).put("done",done).put("at",System.currentTimeMillis()))
  if(!savePending(c,commands))return
  MesimaWidget.updateAll(c);MainActivity.changed()
 }
}
