package il.mesima.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.MediaStore
import android.provider.Settings
import android.content.ContentValues
import android.os.Environment
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONObject

/**
 * הגשר בין ה-HTML לאנדרואיד. נחשף ל-JS בשם window.MesimaNative.
 * שימו לב: המתודות רצות על ת'רד של ה-WebView, לכן כל startActivity עובר ל-UI thread.
 */
class WebBridge(private val act: Activity) {

    @JavascriptInterface
    fun version(): String = "1.0"

    /** הדף מדווח אם יש לו עוד שכבה לסגור. כפתור החזרה של המערכת
     *  מסתמך על זה, ולכן ההחלטה מיידית ולא תלויה בקריאה אסינכרונית. */
    @JavascriptInterface
    fun setCanBack(v: Boolean) {
        (act as? MainActivity)?.canGoBack = v
    }

    /** הדף נטען וסיים לצייר — אפשר למסור לו התראה שנלחצה. */
    @JavascriptInterface
    fun ready() {
        (act as? MainActivity)?.webIsReady()
    }

    /** מצב ההרשאות והמערכת, כדי שה-UI יוכל להציג אמת ולא ניחוש. */
    @JavascriptInterface
    fun status(): String {
        val o = JSONObject()
        o.put("native", true)
        o.put("locationBackground", Fences.hasPermission(act))
        o.put("notifications", androidx.core.app.NotificationManagerCompat.from(act).areNotificationsEnabled())
        o.put("fences", Fences.load(act).length())
        o.put("fencesResult", Fences.lastResult(act))
        o.put("alarms", Sched.state(act))
        o.put("fullScreen", Notif.canFullScreen(act))
        o.put("channel", Notif.channelState(act))
        val pm = act.getSystemService(Context.POWER_SERVICE) as PowerManager
        o.put("batteryUnrestricted", pm.isIgnoringBatteryOptimizations(act.packageName))
        o.put("sdk", Build.VERSION.SDK_INT)
        o.put("manufacturer", Build.MANUFACTURER)
        o.put("sourceUrl", Updater.sourceUrl(act))
        o.put("updatePending", Updater.pending(act))
        o.put("lastCheck", Updater.lastCheck(act))
        return o.toString()
    }

    /* ---------------- עדכון תוכן ---------------- */

    @JavascriptInterface
    fun setSourceUrl(url: String) {
        Updater.setSourceUrl(act, url)
        act.runOnUiThread { Toast.makeText(act, "נשמר", Toast.LENGTH_SHORT).show() }
    }

    /** בודק אם יש גרסה חדשה ב-GitHub Pages ומוריד אותה. */
    @JavascriptInterface
    fun checkUpdate() {
        Updater.check(act) { status, msg ->
            act.runOnUiThread {
                Toast.makeText(act, msg, Toast.LENGTH_LONG).show()
                (act as MainActivity).notifyJs()
                if (status == "updated") (act as MainActivity).reloadApp()
            }
        }
    }

    /** טוען מחדש את הגרסה שכבר ירדה. */
    @JavascriptInterface
    fun applyUpdate() = (act as MainActivity).reloadApp()

    /** שמירת קובץ לתיקיית ההורדות. ה-WebView לא יודע לטפל ב-blob download לבד. */
    @JavascriptInterface
    fun saveText(name: String, content: String, mime: String) {
        act.runOnUiThread {
            try {
                val vals = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(MediaStore.MediaColumns.MIME_TYPE, mime.ifBlank { "text/plain" })
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val uri = act.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, vals)
                if (uri == null) { Toast.makeText(act, "לא הצלחתי לשמור", Toast.LENGTH_LONG).show(); return@runOnUiThread }
                act.contentResolver.openOutputStream(uri)?.use { it.write(content.toByteArray(Charsets.UTF_8)) }
                Toast.makeText(act, "נשמר בהורדות: " + name, Toast.LENGTH_LONG).show()
            } catch (e: Exception) {
                Toast.makeText(act, "שגיאה בשמירה", Toast.LENGTH_LONG).show()
            }
        }
    }

    /**
     * מקבל את כל תזכורות השעה הקרובות בבת אחת ורושם אותן ב-AlarmManager.
     * ה-JS מחשב את המופעים; כאן רק רושמים. מחזיר כמה נרשמו בפועל.
     */
    @JavascriptInterface
    fun syncAlarms(json: String): Int {
        Sched.save(act, json)
        return Sched.reapply(act)
    }

    /** האם המערכת מרשה תזכורת בשנייה המדויקת. */
    @JavascriptInterface
    fun canExactAlarms(): Boolean = Sched.canExact(act)

    /* ---------------- בדיקה עצמית של ההתראות ----------------
       שלושת אלה הופכים את "לא מקבל התראות" משאלה לתשובה. */

    /** מפרסם התראה אמיתית עכשיו, בלי AlarmManager באמצע. */
    @JavascriptInterface
    fun testNotify(): String {
        return try {
            Notif.show(act, "selftest-now", "בדיקת התראה",
                       "אם אתה רואה את זה — ההתראות של משימה עובדות")
            "sent"
        } catch (e: Exception) { "error: " + (e.message ?: "?") }
    }

    /** רושם תזכורת אמיתית בעוד N שניות, דרך המסלול המלא. */
    @JavascriptInterface
    fun testAlarm(seconds: Int): Long = Sched.testIn(act, seconds)

    /** האם מותר לנו להקפיץ חלון מלא מעל מה שפתוח (אנדרואיד 14+). */
    @JavascriptInterface
    fun canFullScreen(): Boolean = Notif.canFullScreen(act)

    /** פותח את מסך ההרשאה של "התראות במסך מלא". */
    @JavascriptInterface
    fun requestFullScreen() = act.runOnUiThread {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                act.startActivity(Intent(
                    "android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT",
                    Uri.parse("package:" + act.packageName)))
            } else openChannelSettings()
        } catch (e: Exception) { openChannelSettings() }
    }

    /** פותח את הגדרות ערוץ ההתראות של האפליקציה. */
    @JavascriptInterface
    fun openChannelSettings() = act.runOnUiThread {
        try {
            act.startActivity(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, act.packageName)
                .putExtra(Settings.EXTRA_CHANNEL_ID, Notif.CHAN))
        } catch (e: Exception) {
            try {
                act.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, act.packageName))
            } catch (x: Exception) {}
        }
    }

    /** פותח את מסך ההרשאה של "התראות ותזכורות" עבור האפליקציה. */
    @JavascriptInterface
    fun requestExactAlarms() {
        act.runOnUiThread {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@runOnUiThread
            try {
                act.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                                         Uri.parse("package:" + act.packageName)))
            } catch (e: Exception) {
                try { act.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)) }
                catch (e2: Exception) { openAppSettings() }
            }
        }
    }

    /** מקבל את כל תזכורות המקום בבת אחת ורושם אותן מחדש במערכת ההפעלה. */
    @JavascriptInterface
    fun syncGeofences(json: String) {
        Fences.save(act, json)
        Fences.reapply(act) { ok, msg ->
            act.runOnUiThread {
                if (!ok) Toast.makeText(act, "גדר מיקום: $msg", Toast.LENGTH_LONG).show()
            }
        }
    }

    @JavascriptInterface
    fun requestLocation() = act.runOnUiThread { (act as MainActivity).askLocation() }

    @JavascriptInterface
    fun requestNotifications() = act.runOnUiThread { (act as MainActivity).askNotifications() }

    /** שעון מעורר אמיתי באפליקציית השעון של הטלפון. */
    @JavascriptInterface
    fun setAlarm(hour: Int, minute: Int, message: String, skipUi: Boolean) {
        act.runOnUiThread {
            val i = Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, hour)
                .putExtra(AlarmClock.EXTRA_MINUTES, minute)
                .putExtra(AlarmClock.EXTRA_MESSAGE, message)
                .putExtra(AlarmClock.EXTRA_VIBRATE, true)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, skipUi)
            try { act.startActivity(i) }
            catch (e: ActivityNotFoundException) {
                Toast.makeText(act, "לא נמצאה אפליקציית שעון", Toast.LENGTH_LONG).show()
            }
        }
    }

    @JavascriptInterface
    fun showAlarms() {
        act.runOnUiThread {
            try { act.startActivity(Intent(AlarmClock.ACTION_SHOW_ALARMS)) } catch (e: Exception) {}
        }
    }

    /** פותח את עורך האירועים של יומן הטלפון עם השדות מלאים. */
    @JavascriptInterface
    fun addCalendarEvent(title: String, beginMs: Double, endMs: Double, note: String, location: String) {
        act.runOnUiThread {
            val i = Intent(Intent.ACTION_INSERT)
                .setData(CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.Events.TITLE, title)
                .putExtra(CalendarContract.Events.DESCRIPTION, note)
                .putExtra(CalendarContract.Events.EVENT_LOCATION, location)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginMs.toLong())
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMs.toLong())
            try { act.startActivity(i) }
            catch (e: ActivityNotFoundException) {
                Toast.makeText(act, "לא נמצאה אפליקציית יומן", Toast.LENGTH_LONG).show()
            }
        }
    }

    /** פטור מאופטימיזציית סוללה — בלעדיו סמסונג מרדימה את האפליקציה. */
    @JavascriptInterface
    fun requestBatteryExemption() {
        act.runOnUiThread {
            try {
                act.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                         Uri.parse("package:" + act.packageName)))
            } catch (e: Exception) {
                try { act.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
                catch (e2: Exception) {}
            }
        }
    }

    /** מסך "Never sleeping apps" של סמסונג — הצעד הקריטי בגלקסי. */
    @JavascriptInterface
    fun openSamsungSleepingApps() {
        act.runOnUiThread {
            val i = Intent().setAction("com.samsung.android.sm.ACTION_OPEN_CHECKABLE_LISTACTIVITY")
                .setPackage("com.samsung.android.lool")
                .putExtra("activity_type", 2)
            try { act.startActivity(i) }
            catch (e: Exception) { openAppSettings() }
        }
    }

    @JavascriptInterface
    fun openAppSettings() {
        act.runOnUiThread {
            try {
                act.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                         Uri.parse("package:" + act.packageName)))
            } catch (e: Exception) {}
        }
    }

    @JavascriptInterface
    fun toast(msg: String) = act.runOnUiThread { Toast.makeText(act, msg, Toast.LENGTH_SHORT).show() }
}
