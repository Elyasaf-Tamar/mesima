package il.mesima.app
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/** Pure presentation model shared by all widget sizes. */
object WidgetModel {
 fun content(snapshot:JSONObject,config:JSONObject):JSONObject {
  val value=snapshot.optJSONObject("widgets")?.optJSONObject(config.optInt("widgetId").toString())?:JSONObject()
  if(config.optString("kind") in listOf("notes","shopping")&&value.optString("id")!=config.optString("contentId"))return JSONObject()
  return JSONObject(value.toString()).also{if(config.optString("kind")=="notes"&&!config.optBoolean("preview"))it.put("preview",false).remove("text")}
 }
 fun rows(snapshot:JSONObject,pending:JSONArray,config:JSONObject,day:String,now:Long=System.currentTimeMillis()):List<JSONObject>{
  val out=mutableListOf<JSONObject>();val kind=config.optString("kind","tasks")
  val content=content(snapshot,config)
  val days=snapshot.optJSONObject("days")?:JSONObject()
  fun header(id:String,title:String){out.add(JSONObject().put("id",id).put("kind","header").put("title",title))}
  fun visible(r:JSONObject,date:String):Boolean {
   if(r.optBoolean("done"))return false
   val k=r.optString("kind");if(k=="event"||k=="checklist")return true
   return !NativeRepo.blocked(snapshot,pending,JSONObject().put("taskId",r.optString("id")).put("day",date))
  }
  if(kind=="calendar"){
   val first=LocalDate.parse(day)
   repeat(7){i->val d=first.plusDays(i.toLong()).toString()
    val rows=NativeRepo.objects(days.optJSONArray(d)?:JSONArray()).filter{it.optString("kind")=="event"}
    if(rows.isNotEmpty()){header("date:$d",d);rows.forEach{out.add(JSONObject(it.toString()).put("day",d))}}
   };return out
  }
  if(kind=="tasks"){
   val today=NativeRepo.objects(days.optJSONArray(day)?:JSONArray()).filter{visible(it,day)&&(!snapshot.has("widgetChecklists")||it.optString("kind")!="checklist")}.toMutableList()
   NativeRepo.objects(snapshot.optJSONArray("widgetChecklists")?:JSONArray()).forEach{c->
    val latest=NativeRepo.objects(c.optJSONArray("slots")?:JSONArray()).lastOrNull{it.optLong("resetAt")<=now}
    val cycle=latest?.optString("day")?:c.optString("cycle")
    if(cycle.isNotBlank()&&cycle<=day&&(latest!=null||!c.optBoolean("complete")))today.add(JSONObject().put("id",c.optString("id")).put("title",c.optString("title")).put("time",c.optString("time")).put("kind","checklist"))
   }
   header("today","היום");today.forEach{out.add(JSONObject(it.toString()).put("day",day))}
   if(today.isEmpty())out.add(JSONObject().put("id","today-empty").put("kind","empty").put("title","אין עוד דברים להיום"))
   val todayIds=today.map{it.optString("id")}.toSet()
   val chosen=config.optJSONArray("ids")?:content.optJSONArray("ids")?:JSONArray();val tasks=NativeRepo.objects(snapshot.optJSONArray("tasks")?:JSONArray())
   val manual=(0 until chosen.length()).mapNotNull{i->tasks.find{it.optString("id")==chosen.optString(i)}}.filter{it.optBoolean("manualEligible")&&it.optString("id") !in todayIds&&visible(it,day)}
   header("chosen","הבחירה שלי")
   manual.forEach{out.add(JSONObject().put("id",it.optString("id")).put("title",it.optString("title")).put("kind","task").put("detail",it.optString("parentNames")).put("day",day).put("check",true))}
   if(manual.isEmpty())out.add(JSONObject().put("id",config.optInt("widgetId").toString()).put("kind","configure").put("title",if(chosen.length()>0)"הבחירה כבר מופיעה למעלה או הושלמה · שנה בחירה" else "בחר משימות להתמקד בהן +"))
  }else if(kind=="shopping"){
   val listId=content.optString("id")
   NativeRepo.objects(content.optJSONArray("items")?:JSONArray()).forEach{original->
    val row=JSONObject(original.toString());val cmd=NativeRepo.objects(pending).lastOrNull{it.optString("action")=="shopping"&&it.optString("listId")==listId&&it.optString("itemId")==row.optString("id")}
    if(cmd!=null)row.put("done",cmd.optBoolean("done"))
    out.add(row.put("kind","shopping").put("listId",listId).put("check",true))
   };out.sortBy{it.optBoolean("done")}
  }else if(kind=="notes"&&content.optString("id").isNotBlank()){
   val text=if(content.optBoolean("preview"))content.optString("text").ifBlank{"פתח לקריאת ההערה"} else "פתח לקריאה באפליקציה"
   text.chunked(700).forEachIndexed{i,s->out.add(JSONObject().put("id",content.optString("id")).put("rowId","note:$i").put("kind","note").put("title",s))}
  };return out
 }
}
