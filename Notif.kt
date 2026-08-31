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
    const val CHAN = "mesima.reminders"

    fun channel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = ctx.getSystemService(NotificationManager::class.java)
        if (mgr.getNotificationChannel(CHAN) != null) return
        val ch = NotificationChannel(CHAN, ctx.getString(R.string.chan_reminders),
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

    /** האם מותר לנו חלון מלא מעל המסך. מאנדרואיד 14 זו הרשאה נפרדת
     *  שניתנת רק לאפליקציות שעון/שיחות, ובלעדיה אין "פופ-אפ" אמיתי. */
    fun canFullScreen(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < 34) return true
        return try {
            ctx.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
        } catch (e: Exception) { false }
    }

    /** מצב ערוץ ההתראות עצמו. אפליקציה יכולה להיות "מאושרת" בכללי
     *  ועדיין עם ערוץ מושתק — וזה נראה בדיוק כמו "לא עובד". */
    fun channelState(ctx: Context): JSONObject {
        val o = JSONObject()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return o.put("exists", true).put("importance", 4).put("blocked", false)
        }
        return try {
            val mgr = ctx.getSystemService(NotificationManager::class.java)
            val ch = mgr.getNotificationChannel(CHAN)
            if (ch == null) o.put("exists", false)
            else o.put("exists", true)
                  .put("importance", ch.importance)
                  .put("blocked", ch.importance == NotificationManager.IMPORTANCE_NONE)
                  .put("sound", ch.sound != null)
        } catch (e: Exception) { o.put("exists", false).put("error", e.message ?: "?") }
    }

    fun show(ctx: Context, id: String, title: String, body: String) {
        channel(ctx)
        val open = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("taskId", id)
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_IMMUTABLE
        val pi = PendingIntent.getActivity(ctx, id.hashCode(), open, flags)

        // "אחר כך" משתיק לעשר דקות; "הבנתי" מסלק בלי לסגור את המשימה.
        val snooze = Intent(ctx, AlarmReceiver::class.java)
            .setAction("il.mesima.SNOOZE")
            .putExtra("id", id).putExtra("title", title).putExtra("body", body)
        val ack = Intent(ctx, AlarmReceiver::class.java)
            .setAction("il.mesima.ACK").putExtra("id", id)
        var bflags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) bflags = bflags or PendingIntent.FLAG_IMMUTABLE
        val piSnooze = PendingIntent.getBroadcast(ctx, ("s" + id).hashCode(), snooze, bflags)
        val piAck = PendingIntent.getBroadcast(ctx, ("a" + id).hashCode(), ack, bflags)

        val n = NotificationCompat.Builder(ctx, CHAN)
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
            // חלון מלא מעל מה שפתוח כרגע. אם המערכת לא מרשה, ההתראה
            // עדיין נופלת חזרה ל-heads-up רגיל — לא נאבד כלום.
            .setFullScreenIntent(pi, true)
            .addAction(0, "אחר כך", piSnooze)
            .addAction(0, "הבנתי", piAck)
            .build()

        try { NotificationManagerCompat.from(ctx).notify(id.hashCode(), n) }
        catch (e: SecurityException) { /* המשתמש לא אישר POST_NOTIFICATIONS */ }
    }
}
