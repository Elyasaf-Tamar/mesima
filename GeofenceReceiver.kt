package il.mesima.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent

/**
 * Play Services מפעיל את זה גם כשהאפליקציה סגורה או נהרגה.
 * ההתראה מפורסמת מכאן ישירות ב-Kotlin — בלי WebView, בלי JavaScript.
 * זה מה שמאפשר לתזכורת לעבוד באמת ברקע.
 */
class GeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val ev = GeofencingEvent.fromIntent(intent) ?: return
        if (ev.hasError()) return

        val t = ev.geofenceTransition
        if (t != Geofence.GEOFENCE_TRANSITION_DWELL && t != Geofence.GEOFENCE_TRANSITION_ENTER) return

        ev.triggeringGeofences?.forEach { g ->
            val m = Fences.meta(ctx, g.requestId)
            val title = m?.optString("title") ?: "תזכורת"
            val place = m?.optString("place") ?: ""
            val delay = m?.optInt("delayMin", 0) ?: 0
            val body = when {
                place.isEmpty() -> "הגעת ליעד"
                delay > 0       -> "אתה ב$place כבר $delay דקות"
                else            -> "הגעת ל$place"
            }
            Notif.show(ctx, g.requestId, title, body)
        }
    }
}
