package il.mesima.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * תזכורות שעה שעובדות כשהאפליקציה סגורה (סעיף 59).
 *
 * הרעיון זהה לזה של Fences: את ההמתנה מחזיקה מערכת ההפעלה, לא אנחנו.
 * ה-JavaScript מחשב את רשימת המופעים הקרובים ומוסר אותה בבת אחת;
 * כאן רק רושמים אותם ב-AlarmManager. התהליך שלנו יכול למות לגמרי —
 * אנדרואיד מעיר את AlarmReceiver, וההתראה מפורסמת מ-Kotlin בלי WebView.
 *
 * מבנה כל פריט ברשימה:
 *   { id:String, at:Long (epoch ms), title:String, body:String }
 */
object Sched {

    private const val PREF = "mesima_alarms"
    private const val KEY  = "list"
    private const val REG  = "registered"

    /** תקרה שמרנית. כל תזכורת היא PendingIntent שהמערכת מחזיקה. */
    private const val CAP = 100

    /** תחזוקה יומית: מרעננת את הרישום גם אם האפליקציה לא נפתחה. */
    private const val UPKEEP_CODE = 0x5EED

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    fun save(ctx: Context, json: String) = prefs(ctx).edit().putString(KEY, json).apply()

    fun load(ctx: Context): JSONArray =
        try { JSONArray(prefs(ctx).getString(KEY, "[]")) } catch (e: Exception) { JSONArray() }

    /** האם המערכת מרשה לנו תזכורת בשנייה המדויקת. */
    fun canExact(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return false
        return am.canScheduleExactAlarms()
    }

    private fun manager(ctx: Context): AlarmManager? =
        ctx.getSystemService(AlarmManager::class.java)

    private fun flags(): Int {
        var f = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) f = f or PendingIntent.FLAG_IMMUTABLE
        return f
    }

    private fun intentFor(ctx: Context, id: String, title: String, body: String): Intent =
        Intent(ctx, AlarmReceiver::class.java)
            .setAction("il.mesima.ALARM.$id")      // ייחודי, אחרת filterEquals מאחד פריטים
            .putExtra("id", id)
            .putExtra("title", title)
            .putExtra("body", body)

    private fun code(id: String): Int = id.hashCode()

    /** מבטל את כל מה שרשום כרגע, לפי הרשימה ששמרנו בפעם הקודמת. */
    private fun cancelAll(ctx: Context) {
        val am = manager(ctx) ?: return
        val reg = try { JSONArray(prefs(ctx).getString(REG, "[]")) } catch (e: Exception) { JSONArray() }
        for (i in 0 until reg.length()) {
            val id = reg.optString(i, "")
            if (id.isBlank()) continue
            val pi = PendingIntent.getBroadcast(ctx, code(id), intentFor(ctx, id, "", ""), flags())
            am.cancel(pi)
            pi.cancel()
        }
        prefs(ctx).edit().putString(REG, "[]").apply()
    }

    /**
     * רושם מחדש את כל התזכורות שבחלון. אידמפוטנטי — אפשר לקרוא בכל שינוי.
     * מחזיר כמה נרשמו בפועל.
     */
    fun reapply(ctx: Context): Int {
        val am = manager(ctx) ?: return 0
        cancelAll(ctx)

        val arr = load(ctx)
        val now = System.currentTimeMillis()
        val exact = canExact(ctx)
        val done = JSONArray()
        var n = 0

        for (i in 0 until arr.length()) {
            if (n >= CAP) break
            val o = arr.optJSONObject(i) ?: continue
            val at = o.optLong("at", 0L)
            if (at <= now) continue                     /* מה שעבר לא מזכיר */
            val id = o.optString("id")
            if (id.isBlank()) continue
            val pi = PendingIntent.getBroadcast(
                ctx, code(id),
                intentFor(ctx, id, o.optString("title", "משימה"), o.optString("body", "")),
                flags()
            )
            try {
                if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                done.put(id)
                n++
            } catch (se: SecurityException) {
                /* המשתמש שלל את הרשאת ההתראה המדויקת בין הבדיקה לרישום */
                try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi); done.put(id); n++ }
                catch (e: Exception) {}
            } catch (e: Exception) {}
        }

        prefs(ctx).edit().putString(REG, done.toString()).apply()
        upkeep(ctx)
        return n
    }

    /**
     * בדיקה חיה: רושם תזכורת אמיתית בעוד כמה שניות, דרך אותו מסלול בדיוק
     * שבו עוברות כל התזכורות. אם זה מצלצל — הצינור עובד, והבעיה בנתונים.
     * אם זה לא מצלצל — הבעיה במערכת, ואנחנו יודעים איפה לחפש.
     */
    fun testIn(ctx: Context, seconds: Int): Long {
        val am = manager(ctx) ?: return 0L
        val at = System.currentTimeMillis() + seconds * 1000L
        val pi = PendingIntent.getBroadcast(
            ctx, code("selftest"),
            intentFor(ctx, "selftest", "בדיקת התראה", "אם אתה רואה את זה — ההתראות עובדות"),
            flags())
        try {
            if (canExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        } catch (e: Exception) {
            try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi) }
            catch (x: Exception) { return 0L }
        }
        return at
    }

    /**
     * דחייה של תזכורת בודדת מתוך ההתראה עצמה. היא לא נוגעת ברשימה
     * ששלח ה-JS — reapply הבא פשוט יתעלם ממנה כי הזמן שלה עבר.
     */
    fun snooze(ctx: Context, id: String, title: String, body: String, minutes: Int) {
        val am = manager(ctx) ?: return
        val at = System.currentTimeMillis() + minutes * 60_000L
        val pi = PendingIntent.getBroadcast(
            ctx, code("snooze:$id"), intentFor(ctx, id, title, body), flags())
        try {
            if (canExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        } catch (e: Exception) {
            try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi) } catch (x: Exception) {}
        }
    }

    /**
     * תזכורת פנימית אחת ליום. היא לא מציגה כלום — היא רק מריצה reapply,
     * כדי שהחלון יזוז קדימה גם אם האפליקציה לא נפתחה. בלעדיה תזכורת
     * שנמצאת מעבר לחלון שה-JS שלח הייתה נופלת בשקט.
     */
    private fun upkeep(ctx: Context) {
        val am = manager(ctx) ?: return
        val i = Intent(ctx, AlarmReceiver::class.java).setAction("il.mesima.UPKEEP")
        val pi = PendingIntent.getBroadcast(ctx, UPKEEP_CODE, i, flags())
        val at = System.currentTimeMillis() + 12 * 60 * 60 * 1000L
        try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi) } catch (e: Exception) {}
    }

    /** כמה תזכורות רשומות כרגע, ומתי הקרובה ביותר. ל-UI, כדי שיגיד אמת. */
    fun state(ctx: Context): JSONObject {
        val reg = try { JSONArray(prefs(ctx).getString(REG, "[]")) } catch (e: Exception) { JSONArray() }
        val arr = load(ctx)
        val now = System.currentTimeMillis()
        var next = 0L
        for (i in 0 until arr.length()) {
            val at = arr.optJSONObject(i)?.optLong("at", 0L) ?: 0L
            if (at > now && (next == 0L || at < next)) next = at
        }
        return JSONObject()
            .put("scheduled", reg.length())
            .put("next", next)
            .put("exact", canExact(ctx))
            .put("cap", CAP)
    }
}
