package il.mesima.app

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * מוריד את index.html מ-GitHub Pages ושומר אותו באחסון הפנימי.
 *
 * הרעיון: ה-APK הוא מעטפת דקה שלא משתנה. כל שינוי בקוד האפליקציה מגיע
 * דרך עדכון תוכן — בלי בנייה מחדש ובלי התקנה מחדש.
 *
 * הקובץ תמיד מוגש מ-https://appassets.androidplatform.net/app/ ,
 * כלומר ה-origin קבוע לנצח ו-localStorage לעולם לא הולך לאיבוד.
 */
object Updater {

    const val DIR = "web"
    const val FILE = "index.html"
    private const val PREF = "mesima_upd"
    private const val K_URL = "src"
    private const val K_HASH = "hash"
    private const val K_TIME = "time"
    private const val K_PENDING = "pending"

    private val pool = Executors.newSingleThreadExecutor()

    fun webDir(ctx: Context): File = File(ctx.filesDir, DIR).apply { if (!exists()) mkdirs() }
    fun webFile(ctx: Context): File = File(webDir(ctx), FILE)

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    fun contentVersion(text:String):Long {
        val m=Regex("const BUILD = '[^0-9]*([0-9]+)\\.([0-9]+)(?:\\.([0-9]+))?").find(text)?:return 0
        val major=m.groupValues[1].toLongOrNull()?:return 0
        val minor=m.groupValues[2].toLongOrNull()?:return 0
        val patch=m.groupValues[3].toLongOrNull()?:0
        if(major !in 0..9999||minor !in 0..9999||patch !in 0..9999)return 0
        return major*100_000_000L+minor*10_000L+patch
    }

    fun sourceUrl(ctx: Context): String = prefs(ctx).getString(K_URL, "") ?: ""
    fun setSourceUrl(ctx: Context, url: String) = prefs(ctx).edit().putString(K_URL, url.trim()).apply()
    fun lastCheck(ctx: Context): Long = prefs(ctx).getLong(K_TIME, 0L)
    fun pending(ctx: Context): Boolean = prefs(ctx).getBoolean(K_PENDING, false)
    fun clearPending(ctx: Context) = prefs(ctx).edit().putBoolean(K_PENDING, false).apply()

    /** בפתיחה ראשונה מעתיקים את הגרסה המצורפת ל-APK כדי שתמיד יהיה ממה להתחיל. */
    fun seedIfEmpty(ctx: Context) {
        val f = webFile(ctx)
        if (f.exists() && f.length() > 0 && prefs(ctx).getInt("bundledCode",0) == BuildConfig.VERSION_CODE) return
        try {
            val bundled = ctx.assets.open(FILE).bufferedReader().use { it.readText() }
            val current = if(f.exists()) f.readText() else ""
            // Installing a newer wrapper also installs its newer HTML, keeping
            // the same origin and local data. Never downgrade a newer OTA file.
            if(current.isBlank() || contentVersion(bundled) > contentVersion(current)) {
                val atomic = android.util.AtomicFile(f)
                val stream = atomic.startWrite()
                try { stream.write(bundled.toByteArray(Charsets.UTF_8)); atomic.finishWrite(stream) }
                catch(e: Exception) { atomic.failWrite(stream);throw e }
            }
            prefs(ctx).edit().putInt("bundledCode",BuildConfig.VERSION_CODE).apply()
        } catch (e: Exception) { /* אין נכס מצורף — נשארים בלי, העדכון ימלא */ }
    }

    private fun sha(b: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    /**
     * בודק ומוריד. onDone(status, message):
     *   "updated" הורד קובץ חדש · "same" אין שינוי · "error" תקלה
     */
    fun check(ctx: Context, onDone: (String, String) -> Unit) {
        val url = sourceUrl(ctx)
        if (url.isBlank()) { onDone("error", "לא הוגדרה כתובת מקור"); return }

        pool.execute {
            try {
                val c = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15000
                    readTimeout = 20000
                    requestMethod = "GET"
                    setRequestProperty("Cache-Control", "no-cache")
                    instanceFollowRedirects = true
                }
                val code = c.responseCode
                if (code != 200) { c.disconnect(); onDone("error", "השרת החזיר $code"); return@execute }

                val bytes = c.inputStream.use { it.readBytes() }
                c.disconnect()

                val text = String(bytes, Charsets.UTF_8)
                val current=runCatching{webFile(ctx).readText()}.getOrDefault("")
                if(contentVersion(text)<contentVersion(current)){
                    prefs(ctx).edit().putLong(K_TIME,System.currentTimeMillis()).apply()
                    onDone("same","הגרסה במכשיר חדשה מזו שבשרת");return@execute
                }
                // הגנה בסיסית: אם קיבלנו דף שגיאה של GitHub ולא את האפליקציה, לא דורסים
                if (bytes.size < 2000 || !text.contains("MesimaNative", true) && !text.contains("<html", true)) {
                    onDone("error", "התוכן שהתקבל לא נראה כמו האפליקציה"); return@execute
                }

                val h = sha(bytes)
                val old = prefs(ctx).getString(K_HASH, "")
                prefs(ctx).edit().putLong(K_TIME, System.currentTimeMillis()).apply()

                if (h == old && webFile(ctx).exists()) { onDone("same", "כבר מעודכן"); return@execute }

                webFile(ctx).writeBytes(bytes)
                prefs(ctx).edit().putString(K_HASH, h).putBoolean(K_PENDING, true).apply()
                onDone("updated", "ירדה גרסה חדשה")
            } catch (e: Exception) {
                onDone("error", e.message ?: "שגיאת רשת")
            }
        }
    }
}
