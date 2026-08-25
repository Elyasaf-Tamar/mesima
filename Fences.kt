package il.mesima.app

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import org.json.JSONArray
import org.json.JSONObject

/**
 * עוטף את GeofencingClient של Play Services.
 *
 * הנקודה המרכזית בכל הארכיטקטורה: את הגדרים מחזיקה מערכת ההפעלה, לא אנחנו.
 * התהליך שלנו יכול להיות מת לגמרי — Play Services מעיר את GeofenceReceiver.
 * לכן אין foreground service, אין התראה קבועה, וצריכת הסוללה אפסית.
 *
 * ההמתנה של "הגעת + 15 דקות" נעשית על ידי אנדרואיד עצמו דרך
 * GEOFENCE_TRANSITION_DWELL + setLoiteringDelay — לא על ידי טיימר שלנו.
 */
object Fences {

    private const val PREF = "mesima_fences"
    private const val KEY  = "list"

    fun save(ctx: Context, json: String) =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()

    fun load(ctx: Context): JSONArray =
        try { JSONArray(ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(KEY, "[]")) }
        catch (e: Exception) { JSONArray() }

    fun meta(ctx: Context, id: String): JSONObject? {
        val arr = load(ctx)
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("id") == id) return o
        }
        return null
    }

    fun hasPermission(ctx: Context): Boolean {
        val fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
        val bg = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
                    PackageManager.PERMISSION_GRANTED
        else true
        return fine && bg
    }

    private fun pendingIntent(ctx: Context): PendingIntent {
        val i = Intent(ctx, GeofenceReceiver::class.java).setAction("il.mesima.GEOFENCE")
        // FLAG_MUTABLE חובה מאנדרואיד 12 — בלעדיו addGeofences קורס
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_MUTABLE
        return PendingIntent.getBroadcast(ctx, 0xF3CE, i, flags)
    }

    /** מוחק את כל הגדרים ורושם מחדש את הרשימה שנשמרה. */
    fun reapply(ctx: Context, onResult: ((Boolean, String) -> Unit)? = null) {
        val arr = load(ctx)
        val client = LocationServices.getGeofencingClient(ctx)

        client.removeGeofences(pendingIntent(ctx))

        if (arr.length() == 0) { onResult?.invoke(true, "אין גדרים"); return }
        if (!hasPermission(ctx))  { onResult?.invoke(false, "חסרה הרשאת מיקום ברקע"); return }

        val fences = ArrayList<Geofence>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val delayMs = (o.optInt("delayMin", 0)) * 60_000
            val b = Geofence.Builder()
                .setRequestId(o.optString("id"))
                .setCircularRegion(o.optDouble("lat"), o.optDouble("lng"),
                                   o.optDouble("radius", 200.0).toFloat())
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
            if (delayMs > 0) {
                // אנדרואיד ממתין את העיכוב בעצמו ומודיע רק בסופו
                b.setTransitionTypes(Geofence.GEOFENCE_TRANSITION_DWELL)
                 .setLoiteringDelay(delayMs)
            } else {
                b.setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER)
            }
            fences.add(b.build())
        }
        if (fences.isEmpty()) { onResult?.invoke(true, "אין גדרים"); return }

        val req = GeofencingRequest.Builder()
            // אם כבר נמצאים בפנים בזמן הרישום — לדווח מיד
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER or
                               GeofencingRequest.INITIAL_TRIGGER_DWELL)
            .addGeofences(fences)
            .build()

        try {
            client.addGeofences(req, pendingIntent(ctx))
                .addOnSuccessListener { onResult?.invoke(true, "נרשמו ${fences.size} גדרים") }
                .addOnFailureListener { e -> onResult?.invoke(false, e.message ?: "כשל ברישום") }
        } catch (se: SecurityException) {
            onResult?.invoke(false, "הרשאה נדחתה")
        }
    }
}
