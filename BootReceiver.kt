package il.mesima.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** אנדרואיד מוחק את כל ה-geofences באתחול ובעדכון האפליקציה. רושמים מחדש. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> Fences.reapply(ctx)
        }
    }
}
