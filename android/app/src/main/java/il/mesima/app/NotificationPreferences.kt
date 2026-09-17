package il.mesima.app

import android.app.AlertDialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import org.json.JSONObject

/** Channel changes are explicit user choices. Copy system sound/importance; never raise them. */
object NotificationPreferences {
 private fun prefs(c:Context)=c.getSharedPreferences("mesima_notification_preferences",Context.MODE_PRIVATE)
 val names=arrayOf("ברירת מחדל","קצר","כפול","ארוך","ללא רטט")
 fun pattern(index:Int)=when(index){1->longArrayOf(0,180);2->longArrayOf(0,180,160,180);3->longArrayOf(0,650);4->longArrayOf(0);else->longArrayOf(0,300,150,300,150,500)}
 fun channelId(c:Context)=prefs(c).getString("channel",Notif.CHAN)!!
 fun state(c:Context):JSONObject {
  val i=prefs(c).getInt("pattern",0).coerceIn(0,4)
  return JSONObject().put("pattern",names[i]).put("channel",channelId(c))
 }
 fun choose(a:android.app.Activity)=a.runOnUiThread {
  AlertDialog.Builder(a).setTitle("דפוס רטט להתראות")
   .setSingleChoiceItems(names,prefs(a).getInt("pattern",0)){dialog,index->
    apply(a,index);dialog.dismiss();(a as? MainActivity)?.backupChanged()
   }.setNegativeButton("ביטול",null).show()
 }
 fun apply(c:Context,index:Int){
  require(index in 0..4)
  Notif.channel(c)
  if(Build.VERSION.SDK_INT>=26){
   val mgr=c.getSystemService(NotificationManager::class.java)
   val old=mgr.getNotificationChannel(channelId(c))?:return
   // A finite channel per pattern retains the user's later system overrides.
   val id="mesima.reminders.pattern.$index"
   if(mgr.getNotificationChannel(id)==null){
    val ch=NotificationChannel(id,"תזכורות · ${names[index]}",old.importance)
    ch.description=old.description;ch.setSound(old.sound,old.audioAttributes)
    ch.enableVibration(index!=4);if(index!=4)ch.vibrationPattern=pattern(index)
    ch.setShowBadge(old.canShowBadge());ch.lockscreenVisibility=old.lockscreenVisibility
    ch.enableLights(old.shouldShowLights());ch.lightColor=old.lightColor
    mgr.createNotificationChannel(ch)
   }
   prefs(c).edit().putString("channel",id).putInt("pattern",index).apply()
  }else prefs(c).edit().putInt("pattern",index).apply()
 }
}
