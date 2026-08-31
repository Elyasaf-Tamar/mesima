package il.mesima.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * אנדרואיד מפעיל את זה בשעה שנקבעה, גם כשהאפליקציה סגורה או נהרגה.
 * ההתראה מפורסמת כאן ישירות — בלי WebView ובלי JavaScript.
 * זה מה שהופך תזכורת שעה לתזכורת אמיתית ולא להצגה שקורית רק כשפתוח.
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == "il.mesima.ACK") {
            val id = intent.getStringExtra("id") ?: return
            androidx.core.app.NotificationManagerCompat.from(ctx).cancel(id.hashCode())
            return
        }
        if (intent.action == "il.mesima.SNOOZE") {
            val id = intent.getStringExtra("id") ?: return
            androidx.core.app.NotificationManagerCompat.from(ctx).cancel(id.hashCode())
            Sched.snooze(ctx, id,
                intent.getStringExtra("title") ?: "משימה",
                intent.getStringExtra("body") ?: "", 10)
            return
        }
        if (intent.action == "il.mesima.UPKEEP") {
            /* תחזוקה בלבד: מזיז את החלון קדימה, לא מציג כלום */
            Sched.reapply(ctx)
            return
        }
        val id = intent.getStringExtra("id") ?: return
        val title = intent.getStringExtra("title") ?: "משימה"
        val body = intent.getStringExtra("body") ?: ""
        Notif.show(ctx, id, title, body)
        /* הפריט שירה כבר בעבר; רישום מחדש מנקה אותו ומשאיר את השאר */
        Sched.reapply(ctx)
    }
}
