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
 fun prefs(c:Context)=c.getSharedPreferences("mesima_native_state",Context.MODE_PRIVATE)
 fun today()=SimpleDateFormat("yyyy-MM-dd",Locale.US).format(Date())
 fun objects(a:JSONArray)= (0 until a.length()).mapNotNull{a.optJSONObject(it)}
 fun snapshot(c:Context)=runCatching{JSONObject(prefs(c).getString("snapshot","{}")!!)}.getOrDefault(JSONObject())
 fun pending(c:Context)=runCatching{JSONArray(prefs(c).getString("pending","[]"))}.getOrDefault(JSONArray())
 fun task(c:Context,id:String)=objects(snapshot(c).optJSONArray("tasks")?:JSONArray()).find{it.optString("id")==id}
 @Synchronized fun save(c:Context,text:String){
  require(text.length<=8_000_000);val o=JSONObject(text);require(o.optInt("schema")==1)
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
   if(list.optBoolean("complete")&&list.optString("cycle")==occurrence)return true
  }
  return objects(pending).any{it.optString("taskId")==id&&(!t.optBoolean("daily")||it.optString("day")==day)}
 }
 fun blocked(c:Context,m:JSONObject)=blocked(snapshot(c),pending(c),m)
 fun shown(c:Context)=runCatching{JSONObject(prefs(c).getString("shown","{}")!!)}.getOrDefault(JSONObject())
 @Synchronized fun remember(c:Context,id:String,m:JSONObject){
  val all=shown(c);val now=System.currentTimeMillis()
  all.keys().asSequence().toList().forEach{if(now-(all.optJSONObject(it)?.optLong("shownAt")?:0)>14*86400000L)all.remove(it)}
  all.put(id,JSONObject(m.toString()).put("shownAt",now));prefs(c).edit().putString("shown",all.toString()).apply()
 }
 fun meta(c:Context,id:String):JSONObject {
  shown(c).optJSONObject(id)?.let{return it}
  objects(Sched.load(c)).find{it.optString("id")==id}?.let{return it}
  val tid=when{task(c,id)!=null->id;id.startsWith("trip_")->id.removePrefix("trip_");id.startsWith("loc_")->id.removePrefix("loc_");else->""}
  return JSONObject().put("id",id).put("taskId",tid).put("kind","task").put("day",today())
 }
 @Synchronized fun complete(c:Context,taskId:String,day:String=today()){
  val t=task(c,taskId)?:return
  if(t.optString("kind")!="short")return
  val meta=JSONObject().put("taskId",taskId).put("day",day)
  if(blocked(c,meta))return
  val commands=pending(c)
  commands.put(JSONObject().put("id",UUID.randomUUID().toString()).put("taskId",taskId).put("day",day).put("action","complete").put("at",System.currentTimeMillis()))
  if(!prefs(c).edit().putString("pending",commands.toString()).commit())return
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
  if(!prefs(c).edit().putString("pending",commands.toString()).commit())return
  MesimaWidget.updateAll(c);MainActivity.changed()
 }
}
