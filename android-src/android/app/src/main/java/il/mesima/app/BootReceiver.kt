package il.mesima.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * אנדרואיד מוחק באתחול ובעדכון האפליקציה גם את ה-geofences וגם את כל
 * התזכורות שב-AlarmManager. שניהם נרשמים כאן מחדש, אחרת אתחול טלפון
 * היה משתיק בשקט את כל התזכורות עד הפתיחה הבאה של האפליקציה.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                Fences.reapply(ctx)
                Sched.reapply(ctx)
            }
        }
    }
}
