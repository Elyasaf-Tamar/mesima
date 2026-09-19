package il.mesima.app
import android.app.PendingIntent
import android.app.ActivityOptions
import android.os.Build
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.*
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

open class MesimaWidget:AppWidgetProvider(){
 companion object {
  fun launchOptions():Bundle?=if(Build.VERSION.SDK_INT>=35)ActivityOptions.makeBasic().setPendingIntentCreatorBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle() else null
  private val dateFormat=DateTimeFormatter.ofPattern("EEE d/M",Locale("he"))
  fun date(day:String)=runCatching{LocalDate.parse(day).format(dateFormat)}.getOrDefault(day)
  fun updateAll(c:Context){
   val m=AppWidgetManager.getInstance(c)
   WidgetPrefs.providers.forEach{(cls,kind)->val ids=m.getAppWidgetIds(ComponentName(c,cls));ids.forEach{render(c,m,it,kind)};if(ids.isNotEmpty())m.notifyAppWidgetViewDataChanged(ids,R.id.widget_list)}
  }
  fun render(c:Context,m:AppWidgetManager,id:Int,kind:String){
   val v=RemoteViews(c.packageName,R.layout.mesima_widget);val day=NativeRepo.today();val snap=NativeRepo.snapshot(c)
   val config=WidgetPrefs.get(c,id,kind);val content=WidgetModel.content(snap,config)
   val rows=WidgetModel.rows(snap,NativeRepo.pending(c),config,day)
   val title=when(kind){"calendar"->"יומן";"shopping"->content.optString("title").ifBlank{"קניות"};"notes"->content.optString("title").ifBlank{"הערות"};else->"היום והמשימות שלי"}
   v.setTextViewText(R.id.widget_title,title)
   v.setTextViewText(R.id.widget_date,if(kind=="calendar")date(day)+" — "+date(LocalDate.parse(day).plusDays(6).toString()) else date(day))
   val count=rows.count{it.optString("kind") !in listOf("header","empty","configure")&&!it.optBoolean("done")}
   v.setTextViewText(R.id.widget_count,when(kind){"calendar"->"היום ועוד שישה ימים";"shopping"->"$count פריטים נותרו";"notes"->if(content.optBoolean("preview"))"תצוגה מקדימה · לחיצה לפתיחת ההערה" else "התוכן מוצג בתוך האפליקציה";else->"$count דברים פתוחים"})
   v.setTextViewText(R.id.widget_empty,when{kind=="calendar"->"אין אירועים בשבעת הימים הקרובים";content.optString("id").isNotBlank()->"הרשימה ריקה · לחץ על הכותרת לפתיחה";else->"בחר תוכן ליישומון"})
   val service=Intent(c,WidgetRowsService::class.java).putExtra("kind",kind).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).setData(Uri.parse("mesima-widget://$id/$kind"))
   v.setRemoteAdapter(R.id.widget_list,service);v.setEmptyView(R.id.widget_list,R.id.widget_empty)
   val template=Intent(c,WidgetActionReceiver::class.java).setAction("il.mesima.WIDGET_ROW").setData(Uri.parse("mesima-widget://action/$id"))
   v.setPendingIntentTemplate(R.id.widget_list,PendingIntent.getBroadcast(c,id,template,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))
   fun open(action:String,target:String,slot:String)=PendingIntent.getActivity(c,id,Intent(c,MainActivity::class.java).setData(Uri.parse("mesima-widget://open/$id/$slot")).putExtra("widgetAction",action).putExtra("widgetId",target).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,launchOptions())
   val action=when(kind){"notes"->if(content.has("id"))"note" else "configure";"shopping"->if(content.has("id"))"shopping" else "configure";else->"today"}
   val target=if(action=="configure")id.toString() else content.optString("id")
   v.setOnClickPendingIntent(R.id.widget_title,open(action,target,"title"))
   v.setOnClickPendingIntent(R.id.widget_empty,open(if(kind=="calendar")"today" else "configure",id.toString(),"empty"))
   v.setViewVisibility(R.id.widget_config,if(kind=="calendar")View.GONE else View.VISIBLE)
   v.setOnClickPendingIntent(R.id.widget_config,open("configure",id.toString(),"config"))
   v.setViewVisibility(R.id.widget_add,if(kind=="tasks"||kind=="calendar")View.VISIBLE else View.GONE)
   v.setOnClickPendingIntent(R.id.widget_add,open(if(kind=="calendar")"newEvent" else "new","","add"))
   m.updateAppWidget(id,v)
  }
 }
 private fun type()=when(this){is CalendarWidget->"calendar";is ShoppingWidget->"shopping";is NotesWidget->"notes";else->"tasks"}
 override fun onUpdate(c:Context,m:AppWidgetManager,ids:IntArray){ids.forEach{render(c,m,it,type())}}
 override fun onAppWidgetOptionsChanged(c:Context,m:AppWidgetManager,id:Int,b:Bundle){render(c,m,id,type())}
 override fun onDeleted(c:Context,ids:IntArray){ids.forEach{WidgetPrefs.delete(c,it)}}
}
class TasksWidget:MesimaWidget()
class CalendarWidget:MesimaWidget()
class ShoppingWidget:MesimaWidget()
class NotesWidget:MesimaWidget()

class WidgetRowsService:RemoteViewsService(){
 override fun onGetViewFactory(intent:Intent):RemoteViewsFactory=object:RemoteViewsFactory{
  var rows=listOf<JSONObject>();val kind=intent.getStringExtra("kind")?:"tasks";val id=intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,0)
  override fun onCreate(){onDataSetChanged()}
  override fun onDataSetChanged(){rows=WidgetModel.rows(NativeRepo.snapshot(this@WidgetRowsService),NativeRepo.pending(this@WidgetRowsService),WidgetPrefs.get(this@WidgetRowsService,id,kind),NativeRepo.today())}
  override fun onDestroy(){};override fun getCount()=rows.size
  override fun getViewAt(position:Int):RemoteViews?{
   val r=rows.getOrNull(position)?:return null;val header=r.optString("kind")=="header"
   val v=RemoteViews(packageName,if(header)R.layout.widget_section else R.layout.widget_row)
   if(header){v.setTextViewText(R.id.section_title,if(kind=="calendar")MesimaWidget.date(r.optString("title")) else r.optString("title"));return v}
   v.setTextViewText(R.id.row_title,r.optString("title"));v.setTextViewText(R.id.row_meta,listOf(r.optString("time"),r.optString("detail")).filter{it.isNotBlank()}.joinToString(" · "))
   v.setInt(R.id.row_title,"setMaxLines",if(r.optString("kind")=="note")Int.MAX_VALUE else 3)
   v.setViewVisibility(R.id.row_meta,if(r.optString("time").isBlank()&&r.optString("detail").isBlank())View.GONE else View.VISIBLE)
   v.setViewVisibility(R.id.row_check,if(r.optBoolean("check"))View.VISIBLE else View.GONE)
   v.setTextViewText(R.id.row_check,if(r.optBoolean("done"))"☑" else "☐")
   v.setTextColor(R.id.row_title,if(r.optBoolean("done"))0xFF8793A2.toInt() else 0xFFEDF1F7.toInt())
   val base=Intent().putExtra("id",r.optString("id")).putExtra("day",r.optString("day")).putExtra("listId",r.optString("listId"))
   v.setOnClickFillInIntent(R.id.row_body,Intent(base).putExtra("action",r.optString("kind")))
   v.setOnClickFillInIntent(R.id.row_check,Intent(base).putExtra("action",if(kind=="shopping")"shoppingToggle" else "complete").putExtra("done",!r.optBoolean("done")))
   return v
  }
  override fun getLoadingView():RemoteViews?=null
  override fun getViewTypeCount()=2
  override fun getItemId(position:Int)=(rows.getOrNull(position)?.let{it.optString("kind")+it.optString("rowId",it.optString("id"))+it.optString("day") }?:"").hashCode().toLong()
  override fun hasStableIds()=true
 }
}
class WidgetActionReceiver:BroadcastReceiver(){
 override fun onReceive(c:Context,i:Intent){
  val id=i.getStringExtra("id")?:return;val action=i.getStringExtra("action")?:return
  if(action=="complete"){NativeRepo.complete(c,id,i.getStringExtra("day")?:NativeRepo.today());return}
  if(action=="shoppingToggle"){NativeRepo.shopping(c,i.getStringExtra("listId")?:return,id,i.getBooleanExtra("done",true));return}
  if(action !in listOf("task","event","checklist","note","shopping","configure"))return
  val target=Intent(c,MainActivity::class.java).setData(Uri.parse("mesima-widget://row/"+Uri.encode(id)+"/"+action)).putExtra("widgetAction",action).putExtra("widgetId",if(action=="shopping")i.getStringExtra("listId") else id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  val pi=PendingIntent.getActivity(c,0,target,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,MesimaWidget.launchOptions())
  val options=if(Build.VERSION.SDK_INT>=34)ActivityOptions.makeBasic().setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle() else null
  pi.send(c,0,null,null,null,null,options)
 }
}
