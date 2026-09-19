package il.mesima.app
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object WidgetPrefs {
 val providers=listOf(TasksWidget::class.java to "tasks",CalendarWidget::class.java to "calendar",ShoppingWidget::class.java to "shopping",NotesWidget::class.java to "notes")
 private fun prefs(c:Context)=c.getSharedPreferences("mesima_widgets",Context.MODE_PRIVATE)
 fun get(c:Context,id:Int,kind:String)=runCatching{JSONObject(prefs(c).getString(id.toString(),"{}")!!)}.getOrDefault(JSONObject()).put("widgetId",id).put("kind",kind)
 fun all(c:Context):JSONArray {
  val m=AppWidgetManager.getInstance(c);val a=JSONArray()
  providers.forEach{(cls,kind)->m.getAppWidgetIds(ComponentName(c,cls)).forEach{a.put(get(c,it,kind))}};return a
 }
 fun kind(c:Context,id:Int)=NativeRepo.objects(all(c)).find{it.optInt("widgetId")==id}?.optString("kind")
 @Synchronized fun save(c:Context,id:Int,text:String):Boolean {
  val kind=kind(c,id)?:return false;if(text.length>100_000)return false
  return runCatching{val src=JSONObject(text);val clean=JSONObject().put("kind",kind).put("ids",src.optJSONArray("ids")?:JSONArray()).put("contentId",src.optString("contentId")).put("preview",src.optBoolean("preview"));prefs(c).edit().putString(id.toString(),clean.toString()).commit()}.getOrDefault(false)
 }
 fun delete(c:Context,id:Int){prefs(c).edit().remove(id.toString()).apply();val snap=NativeRepo.snapshot(c);snap.optJSONObject("widgets")?.remove(id.toString());NativeRepo.prefs(c).edit().putString("snapshot",snap.toString()).apply()}
}
