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

object Notif {
    private const val CHAN = "mesima.reminders"

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

    fun show(ctx: Context, id: String, title: String, body: String) {
        channel(ctx)
        val open = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("taskId", id)
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_IMMUTABLE
        val pi = PendingIntent.getActivity(ctx, id.hashCode(), open, flags)

        val n = NotificationCompat.Builder(ctx, CHAN)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()

        try { NotificationManagerCompat.from(ctx).notify(id.hashCode(), n) }
        catch (e: SecurityException) { /* המשתמש לא אישר POST_NOTIFICATIONS */ }
    }
}
