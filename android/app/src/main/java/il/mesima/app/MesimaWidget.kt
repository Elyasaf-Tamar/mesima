package il.mesima.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.*
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONObject
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.*

open class MesimaWidget:AppWidgetProvider(){
 companion object {
  fun updateAll(c:Context){
   val m=AppWidgetManager.getInstance(c)
   for(cls in listOf(TasksWidget::class.java,CalendarWidget::class.java)){
    val ids=m.getAppWidgetIds(ComponentName(c,cls));ids.forEach{render(c,m,it,cls==CalendarWidget::class.java)}
    if(ids.isNotEmpty())m.notifyAppWidgetViewDataChanged(ids,R.id.widget_list)
   }
  }
  fun render(c:Context,m:AppWidgetManager,id:Int,calendar:Boolean){
   val v=RemoteViews(c.packageName,R.layout.mesima_widget)
   val day=NativeRepo.today();val snap=NativeRepo.snapshot(c);val exists=snap.optJSONObject("days")?.has(day)==true
   val rows=WidgetRows.rows(c,calendar)
   v.setTextViewText(R.id.widget_title,if(calendar)"יומן" else "משימות היום")
   v.setTextViewText(R.id.widget_date,SimpleDateFormat("EEEE, d MMMM",Locale("he")).format(Date()))
   v.setTextViewText(R.id.widget_count,if(calendar)"${rows.size} אירועים בשבוע הקרוב" else "${rows.size} משימות פתוחות")
   v.setTextViewText(R.id.widget_empty,if(exists)(if(calendar)"אין אירועים בשבוע הקרוב" else "היום פנוי · כל הכבוד") else "פתח את משימה לעדכון התצוגה")
   val service=Intent(c,WidgetRowsService::class.java).putExtra("calendar",calendar).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id)
   service.data=Uri.parse("mesima-widget://$id/${if(calendar)"calendar" else "tasks"}")
   v.setRemoteAdapter(R.id.widget_list,service);v.setEmptyView(R.id.widget_list,R.id.widget_empty)
   val template=Intent(c,WidgetActionReceiver::class.java).setAction("il.mesima.WIDGET_ROW").setData(Uri.parse("mesima-widget://action/$id"))
   v.setPendingIntentTemplate(R.id.widget_list,PendingIntent.getBroadcast(c,id,template,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))
   fun open(action:String,request:Int)=PendingIntent.getActivity(c,request,Intent(c,MainActivity::class.java).putExtra("widgetAction",action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
   v.setOnClickPendingIntent(R.id.widget_title,open("today",id*10+1));v.setOnClickPendingIntent(R.id.widget_add,open(if(calendar)"newEvent" else "new",id*10+2))
   m.updateAppWidget(id,v)
  }
 }
 override fun onUpdate(c:Context,m:AppWidgetManager,ids:IntArray){ids.forEach{render(c,m,it,this is CalendarWidget)}}
 override fun onAppWidgetOptionsChanged(c:Context,m:AppWidgetManager,id:Int,b:Bundle){render(c,m,id,this is CalendarWidget)}
}
class TasksWidget:MesimaWidget()
class CalendarWidget:MesimaWidget()

object WidgetRows {
 fun rows(c:Context,calendar:Boolean):List<JSONObject>{
  val snap=NativeRepo.snapshot(c);val days=snap.optJSONObject("days")?:return emptyList();val out=mutableListOf<JSONObject>()
  val cal=Calendar.getInstance();val fmt=SimpleDateFormat("yyyy-MM-dd",Locale.US)
  repeat(if(calendar)7 else 1){
   val day=fmt.format(cal.time)
   NativeRepo.objects(days.optJSONArray(day)?:JSONArray()).forEach{r->
    val event=r.optString("kind")=="event"
    if(event==calendar&&!r.optBoolean("done")){
     val meta=JSONObject().put("taskId",if(event||r.optString("kind")=="checklist")"" else r.optString("id")).put("day",day)
     if(!NativeRepo.blocked(c,meta))out.add(JSONObject(r.toString()).put("day",day).put("dateLabel",SimpleDateFormat("EEE d/M",Locale("he")).format(cal.time)))
    }
   };cal.add(Calendar.DATE,1)
  };return out
 }
}
class WidgetRowsService:RemoteViewsService(){
 override fun onGetViewFactory(intent:Intent):RemoteViewsFactory=object:RemoteViewsFactory{
  var rows=listOf<JSONObject>();val calendar=intent.getBooleanExtra("calendar",false)
  override fun onCreate(){onDataSetChanged()}
  override fun onDataSetChanged(){rows=WidgetRows.rows(this@WidgetRowsService,calendar)}
  override fun onDestroy(){};override fun getCount()=rows.size
  override fun getViewAt(position:Int):RemoteViews?{
   val r=rows.getOrNull(position)?:return null;val v=RemoteViews(packageName,R.layout.widget_row)
   v.setTextViewText(R.id.row_title,r.optString("title"));v.setTextViewText(R.id.row_meta,listOf(if(calendar)r.optString("dateLabel") else "",r.optString("time"),r.optString("detail")).filter{it.isNotBlank()}.joinToString(" · "))
   v.setViewVisibility(R.id.row_check,if(r.optBoolean("check"))View.VISIBLE else View.GONE)
   val base=Intent().putExtra("id",r.optString("id")).putExtra("day",r.optString("day"))
   v.setOnClickFillInIntent(R.id.row_body,Intent(base).putExtra("action",r.optString("kind")))
   v.setOnClickFillInIntent(R.id.row_check,Intent(base).putExtra("action","complete"))
   return v
  }
  override fun getLoadingView():RemoteViews?=null
  override fun getViewTypeCount()=1
  override fun getItemId(position:Int)=(rows.getOrNull(position)?.let{it.optString("id")+it.optString("day")}?:"").hashCode().toLong()
  override fun hasStableIds()=true
 }
}
class WidgetActionReceiver:BroadcastReceiver(){
 override fun onReceive(c:Context,i:Intent){
  val id=i.getStringExtra("id")?:return;val action=i.getStringExtra("action")?:return
  if(action=="complete"){NativeRepo.complete(c,id,i.getStringExtra("day")?:NativeRepo.today());return}
  if(action !in listOf("task","event","checklist"))return
  c.startActivity(Intent(c,MainActivity::class.java).putExtra("widgetAction",action).putExtra("widgetId",id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
 }
}
