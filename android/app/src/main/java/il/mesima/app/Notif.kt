package il.mesima.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

object Notif {
    /* מזהה הערוץ נושא מספר גרסה בכוונה. אנדרואיד לא מרשה להעלות את
       החשיבות של ערוץ קיים — אם הוא נוצר פעם כ"שקט", או שהמשתמש השתיק
       אותו, שום עדכון קוד לא יחזיר לו קפיצה וצליל. שינוי המזהה יוצר
       ערוץ חדש נקי בחשיבות HIGH, וזו הדרך היחידה. */
    const val CHAN = "mesima.reminders.v2"
    private const val CHAN_OLD = "mesima.reminders"

    fun channel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = ctx.getSystemService(NotificationManager::class.java)
        /* הערוץ הישן נשאר ברשימת ההגדרות ומבלבל — מוחקים אותו פעם אחת */
        try { if (mgr.getNotificationChannel(CHAN_OLD) != null) mgr.deleteNotificationChannel(CHAN_OLD) }
        catch (e: Exception) {}
        if (mgr.getNotificationChannel(NotificationPreferences.channelId(ctx)) != null) return
        val ch = NotificationChannel(NotificationPreferences.channelId(ctx), ctx.getString(R.string.chan_reminders),
                                     NotificationManager.IMPORTANCE_HIGH)
        ch.description = "תזכורות מיקום, נסיעה ושעה"
        ch.enableVibration(true)
        ch.vibrationPattern = longArrayOf(0, 300, 150, 300, 150, 500)
        ch.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        )
        mgr.createNotificationChannel(ch)
    }

    /** Kept for older HTML only. Reminders use ordinary system notifications. */
    fun canFullScreen(ctx: Context): Boolean = false

    /** מצב ערוץ ההתראות עצמו. אפליקציה יכולה להיות "מאושרת" בכללי
     *  ועדיין עם ערוץ מושתק — וזה נראה בדיוק כמו "לא עובד". */
    fun channelState(ctx: Context): JSONObject {
        val o = JSONObject()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return o.put("exists", true).put("importance", 4).put("blocked", false)
        }
        return try {
            val mgr = ctx.getSystemService(NotificationManager::class.java)
            val ch = mgr.getNotificationChannel(NotificationPreferences.channelId(ctx))
            if (ch == null) o.put("exists", false)
            else o.put("exists", true)
                  .put("importance", ch.importance)
                  .put("blocked", ch.importance == NotificationManager.IMPORTANCE_NONE)
                  .put("sound", ch.sound != null)
        } catch (e: Exception) { o.put("exists", false).put("error", e.message ?: "?") }
    }

    fun show(ctx:Context,id:String,title:String,body:String,link:JSONObject?=null):String = synchronized(NativeRepo) {
        try {
            val result = showLocked(ctx,id,title,body,link)
            NativeRepo.prefs(ctx).edit().putString("notificationError", if(result=="posted") "" else result).apply()
            result
        } catch(e:Exception) {
            val result = "error: " + (e.message ?: e.javaClass.simpleName)
            NativeRepo.prefs(ctx).edit().putString("notificationError",result).apply()
            result
        }
    }
    private fun showLocked(ctx: Context, id: String, title: String, body: String, link:JSONObject?):String {
        val meta=NativeRepo.route(link?:NativeRepo.meta(ctx,id))
        if(NativeRepo.blocked(ctx,meta))return "blocked_task"
        channel(ctx)
        val notifications=NotificationManagerCompat.from(ctx)
        if(!notifications.areNotificationsEnabled())return "blocked_notifications"
        if(channelState(ctx).optBoolean("blocked"))return "blocked_channel"
        val open = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("taskId", id) // Preserve occurrence date when the WebView opens it.
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_IMMUTABLE
        val pi = PendingIntent.getActivity(ctx, id.hashCode(), open, flags)

        // Acknowledge, snooze and complete have separate meanings.
        val snooze = Intent(ctx, AlarmReceiver::class.java)
            .setAction("il.mesima.SNOOZE")
            .putExtra("id", id).putExtra("title", title).putExtra("body", body)
            .putExtra("meta",meta.toString())
        val ack = Intent(ctx, AlarmReceiver::class.java)
            .setAction("il.mesima.ACK").putExtra("id", id)
        var bflags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) bflags = bflags or PendingIntent.FLAG_IMMUTABLE
        val piSnooze = PendingIntent.getBroadcast(ctx, ("s" + id).hashCode(), snooze, bflags)
        val piAck = PendingIntent.getBroadcast(ctx, ("a" + id).hashCode(), ack, bflags)

        val complete=Intent(ctx,AlarmReceiver::class.java).setAction("il.mesima.COMPLETE").putExtra("id",id).putExtra("meta",meta.toString())
        val piComplete=PendingIntent.getBroadcast(ctx,("done:"+id).hashCode(),complete,bflags)
        val builder = NotificationCompat.Builder(ctx, NotificationPreferences.channelId(ctx))
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setOnlyAlertOnce(false)
            .addAction(0, "דחה ב־15 דקות", piSnooze)
            .addAction(0, "הבנתי", piAck)
        if(meta.optString("kind")=="task" && NativeRepo.task(ctx,meta.optString("taskId"))?.optString("kind")=="short")builder.addAction(0,"בוצע",piComplete)
        val n=builder.build()
        try { notifications.notify(id.hashCode(), n) }
        catch (e: SecurityException) { return "blocked_notifications" }
        NativeRepo.remember(ctx,id,meta)
        // Accepted by NotificationManager, not a claim that a banner was displayed.
        return "posted"
    }
}
