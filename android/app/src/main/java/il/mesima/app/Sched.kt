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
 * קוד הווב מוסר תוכנית חזרתיות ואירועים שנשמרת במכשיר. בכל יקיצה
 * מחשבים ממנה את המופעים הבאים, גם בלי WebView. התהליך יכול להיסגר —
 * אנדרואיד מעיר את AlarmReceiver, וההתראה מפורסמת מ-Kotlin בלי WebView.
 *
 * מבנה כל פריט ברשימה:
 *   { id:String, at:Long (epoch ms), title:String, body:String }
 */
object Sched {

    private const val PREF = "mesima_alarms"
    private const val KEY  = "list"
    private const val REG  = "registered"
    private const val PLAN = "plan"
    private const val BATCH = "native-batch:"

    /** תקרה שמרנית. כל תזכורת היא PendingIntent שהמערכת מחזיקה. */
    private const val CAP = 100

    /** תחזוקה פעמיים ביום: מגלגלת את התוכנית השמורה בלי לפתוח את האפליקציה. */
    private const val UPKEEP_CODE = 0x5EED

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    /** Legacy HTML supplies concrete occurrences. Keep that protocol available. */
    @Synchronized fun save(ctx: Context, json: String) {
        Payloads.bytes(json);JSONArray(json)
        check(prefs(ctx).edit().putString(KEY,json).remove(PLAN).remove("error").commit())
    }

    private fun plan(ctx:Context):JSONObject? = runCatching {
        prefs(ctx).getString(PLAN,null)?.let { JSONObject(it) }
    }.getOrNull()

    @Synchronized fun savePlan(ctx:Context,json:String):Int {
        val checked=AlarmPlan.validate(json)
        val prepared=AlarmPlan.prepare(checked,plan(ctx),System.currentTimeMillis(),java.time.ZoneId.systemDefault())
        val text=prepared.toString();Payloads.bytes(text)
        check(prefs(ctx).edit().putString(PLAN,text).remove("error").commit())
        val count=reapply(ctx)
        MesimaWidget.updateAll(ctx)
        return count
    }

    fun error(ctx:Context,message:String){prefs(ctx).edit().putString("error",message).apply()}

    fun widgetSnapshot(ctx:Context,day:String,now:Long=System.currentTimeMillis()):JSONObject {
        val snapshot=NativeRepo.snapshot(ctx)
        val rules=plan(ctx)?:return snapshot
        return runCatching{AlarmPlan.widgetProjection(snapshot,rules,day,now)}.getOrDefault(snapshot)
    }

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

    private fun intentFor(ctx: Context, id: String, title: String, body: String, meta:JSONObject?=null): Intent =
        Intent(ctx, AlarmReceiver::class.java)
            .setAction("il.mesima.ALARM.$id")      // ייחודי, אחרת filterEquals מאחד פריטים
            .putExtra("id", id)
            .putExtra("title", title)
            .putExtra("body", body)
            .putExtra("meta",meta?.toString())

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
    @Synchronized fun reapply(ctx: Context): Int {
        val am = manager(ctx) ?: return 0
        cancelAll(ctx)

        val now = System.currentTimeMillis()
        val rules=plan(ctx)
        val arr = if(rules!=null) {
            try {
                val snapshot=NativeRepo.snapshot(ctx);val pending=NativeRepo.pending(ctx)
                val generated=AlarmPlan.build(rules,now,java.time.ZoneId.systemDefault(),CAP){NativeRepo.blocked(snapshot,pending,it)}
                val text=generated.toString();Payloads.bytes(text)
                check(prefs(ctx).edit().putString(KEY,text).remove("error").commit())
                generated
            }catch(e:Exception){error(ctx,e.message?:"לא ניתן לחדש תזכורות");load(ctx)}
        } else load(ctx)
        val exact = canExact(ctx)
        val done = JSONArray()
        var n = 0

        val entries=if(rules!=null) NativeRepo.objects(arr).groupBy{it.optLong("at")}.toSortedMap().map{(at,_) ->
            JSONObject().put("id",BATCH+at).put("at",at)
        } else NativeRepo.objects(arr)
        for (o in entries) {
            if (n >= CAP) break
            val at = o.optLong("at", 0L)
            if (at <= now) continue                     /* מה שעבר לא מזכיר */
            val id = o.optString("id")
            if (id.isBlank() || NativeRepo.blocked(ctx,o)) continue
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
        restoreSnoozes(ctx)
        NativeRepo.cancelBlocked(ctx)
        return n
    }

    /** A single OS wakeup may represent many reminders at the same instant. */
    fun fire(ctx:Context,id:String,title:String,body:String,meta:JSONObject?=null){
        if(id.startsWith(BATCH)){
            val at=id.removePrefix(BATCH).toLongOrNull()?:return
            // Android may deliver several overdue alarms together after idle.
            // Deliver every due queued occurrence before reapply clears the past.
            val through=maxOf(at,System.currentTimeMillis())
            for(row in NativeRepo.objects(load(ctx)).filter{it.optLong("at")<=through}){
                if(!NativeRepo.blocked(ctx,row))Notif.show(ctx,row.optString("id"),row.optString("title","משימה"),row.optString("body"),row)
            }
        }else if(!NativeRepo.blocked(ctx,meta?:NativeRepo.meta(ctx,id)))Notif.show(ctx,id,title,body,meta)
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
    @Synchronized fun snooze(ctx: Context, id: String, title: String, body: String, minutes: Int, link:JSONObject?=null):Boolean {
        val meta=link?:NativeRepo.meta(ctx,id)
        if(NativeRepo.blocked(ctx,meta))return false
        val at = System.currentTimeMillis() + minutes * 60_000L
        val arr=JSONArray()
        val old=runCatching { JSONArray(prefs(ctx).getString("snoozes","[]")) }.getOrDefault(JSONArray())
        for(i in 0 until old.length()) { val o=old.optJSONObject(i) ?: continue; if(o.optString("id")!=id && o.optLong("at")>System.currentTimeMillis())arr.put(o) }
        arr.put(JSONObject().put("id",id).put("title",title).put("body",body).put("at",at).put("meta",meta))
        val text=arr.toString()
        try{Payloads.bytes(text);check(prefs(ctx).edit().putString("snoozes",text).commit())}
        catch(e:Exception){error(ctx,e.message?:"לא ניתן לשמור דחיית תזכורת");return false}
        return scheduleSnooze(ctx,id,title,body,at,meta)
    }
    @Synchronized fun cancelBlockedSnoozes(ctx:Context){
        val all=runCatching{JSONArray(prefs(ctx).getString("snoozes","[]"))}.getOrDefault(JSONArray())
        val keep=JSONArray()
        for(i in 0 until all.length()) {val o=all.optJSONObject(i)?:continue;val id=o.optString("id")
            if(NativeRepo.blocked(ctx,o.optJSONObject("meta")?:NativeRepo.meta(ctx,id))){val pi=PendingIntent.getBroadcast(ctx,code("snooze:$id"),intentFor(ctx,id,"",""),flags());manager(ctx)?.cancel(pi);pi.cancel()}
            else keep.put(o)
        }
        prefs(ctx).edit().putString("snoozes",keep.toString()).apply()
    }
    fun allowFire(ctx:Context,id:String):Boolean {
        val meta=NativeRepo.meta(ctx,id);if(NativeRepo.blocked(ctx,meta))return false
        return true
    }
    private fun restoreSnoozes(ctx: Context) {
        val arr=runCatching { JSONArray(prefs(ctx).getString("snoozes","[]")) }.getOrDefault(JSONArray())
        for(i in 0 until arr.length()) {val o=arr.optJSONObject(i) ?: continue
            val at=o.optLong("at");val meta=o.optJSONObject("meta")?:NativeRepo.meta(ctx,o.optString("id"))
            if(at>System.currentTimeMillis() && !NativeRepo.blocked(ctx,meta))scheduleSnooze(ctx,o.optString("id"),o.optString("title"),o.optString("body"),at,meta)
        }
    }
    private fun scheduleSnooze(ctx: Context,id:String,title:String,body:String,at:Long,meta:JSONObject):Boolean {
        val am=manager(ctx) ?: return false
        val pi = PendingIntent.getBroadcast(
            ctx, code("snooze:$id"), intentFor(ctx, id, title, body,meta), flags())
        try {
            if (canExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        } catch (e: Exception) {
            try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi) }
            catch (x: Exception) {error(ctx,x.message?:"לא ניתן לדחות תזכורת");return false}
        }
        return true
    }

    /**
     * יקיצה פנימית שלא מציגה התראה. עם תוכנית כללים היא מחשבת מחדש
     * מופעים עתידיים; עם HTML ישן היא יכולה רק לרשום את הרשימה שקיבלה.
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
            val row=arr.optJSONObject(i)?:continue
            if(NativeRepo.blocked(ctx,row))continue
            val at = row.optLong("at", 0L)
            if (at > now && (next == 0L || at < next)) next = at
        }
        return JSONObject()
            .put("scheduled", reg.length())
            .put("next", next)
            .put("exact", canExact(ctx))
            .put("cap", CAP)
            .put("source",if(plan(ctx)!=null)"rules" else "legacy")
            .put("occurrences",NativeRepo.objects(arr).count{it.optLong("at")>now&&!NativeRepo.blocked(ctx,it)})
            .put("error",prefs(ctx).getString("error",""))
    }
}

