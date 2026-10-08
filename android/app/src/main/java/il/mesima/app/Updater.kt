package il.mesima.app

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * מוריד את index.html מ-GitHub Pages ושומר אותו באחסון הפנימי.
 *
 * עדכון זה מחליף רק את קוד הווב. שינוי ב-Kotlin או בהרשאות דורש APK חדש.
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
    private val buildPattern = Regex("\\bconst\\s+BUILD\\s*=\\s*['\"]([^'\"]+)['\"]")

    fun webDir(ctx: Context): File = File(ctx.filesDir, DIR).apply { if (!exists()) mkdirs() }
    fun webFile(ctx: Context): File = File(webDir(ctx), FILE)
    private fun currentText(ctx:Context):String = android.util.AtomicFile(webFile(ctx)).openRead().use{Payloads.readText(it)}

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    fun semanticVersion(label:String):String {
        val m=Regex("^[^0-9]*([0-9]+)\\.([0-9]+)(?:\\.([0-9]+))?").find(label)?:return ""
        val parts=m.groupValues.drop(1).filter{it.isNotEmpty()}
        if(parts.any{(it.toLongOrNull()?:Long.MAX_VALUE) !in 0..9999})return ""
        return parts.joinToString("."){it.toLong().toString()}
    }

    fun contentVersion(text:String):Long {
        val version=semanticVersion(buildPattern.find(text)?.groupValues?.get(1)?:"")
        val parts=version.split('.');if(parts.size<2)return 0
        val major=parts[0].toLong();val minor=parts[1].toLong();val patch=parts.getOrNull(2)?.toLong()?:0
        return major*100_000_000L+minor*10_000L+patch
    }

    fun sourceVersion(ctx:Context):String {
        val current=runCatching{currentText(ctx)}.getOrDefault("")
        val text=current.ifBlank{runCatching{ctx.assets.open(FILE).use{Payloads.readText(it)}}.getOrDefault("")}
        return semanticVersion(buildPattern.find(text)?.groupValues?.get(1)?:"").ifBlank{"0.0.0"}
    }

    fun checkedUrl(value:String):URL {
        require(value.length<=8000){"כתובת העדכון ארוכה מדי"}
        val uri=URI(value)
        require(uri.scheme=="https" && !uri.host.isNullOrBlank() && uri.port in listOf(-1,443) && uri.rawUserInfo==null && uri.rawFragment==null){"כתובת העדכון חייבת להיות HTTPS ללא פרטי כניסה"}
        return uri.toURL()
    }

    fun validateContent(bytes:ByteArray):String {
        require(bytes.size in 2000..Payloads.MAX_BYTES){"גודל קובץ העדכון אינו תקין"}
        val text=Payloads.text(bytes)
        require(contentVersion(text)>0 && Regex("<html\\b",RegexOption.IGNORE_CASE).containsMatchIn(text) && text.contains("MesimaNative") && Regex("id\\s*=\\s*['\"]nav['\"]").containsMatchIn(text)){
            "התוכן שהתקבל אינו קובץ אפליקציה עם גרסה תקינה"
        }
        return text
    }

    internal fun writeAtomic(file:File,bytes:ByteArray){
        // Write beside the live page, then rename in one filesystem operation.
        // WebView requests can continue reading the complete old file while the
        // download is written; even API 29 never exposes a partially written page.
        val temporary=File.createTempFile(".mesima-web-",".tmp",file.parentFile)
        try{
            FileOutputStream(temporary).use{it.write(bytes);it.flush();it.fd.sync()}
            Files.move(temporary.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)
        }finally{temporary.delete()}
    }

    private fun download(address:String):ByteArray {
        var next=checkedUrl(address)
        repeat(4){hop->
            val c=next.openConnection() as HttpURLConnection
            c.connectTimeout=15000;c.readTimeout=20000;c.requestMethod="GET"
            c.setRequestProperty("Cache-Control","no-cache");c.instanceFollowRedirects=false
            try{
                val code=c.responseCode
                if(code in listOf(301,302,303,307,308)){
                    require(hop<3){"יותר מדי הפניות בכתובת העדכון"}
                    val location=c.getHeaderField("Location")?:error("הפניה ללא כתובת")
                    next=checkedUrl(next.toURI().resolve(location).toString())
                }else{
                    require(code==200){"השרת החזיר $code"}
                    require(c.contentLengthLong<=Payloads.MAX_BYTES){"קובץ העדכון גדול מדי"}
                    return c.inputStream.use{Payloads.read(it)}
                }
            }finally{c.disconnect()}
        }
        error("לא ניתן להשלים את הורדת העדכון")
    }

    fun sourceUrl(ctx: Context): String = prefs(ctx).getString(K_URL, "") ?: ""
    fun setSourceUrl(ctx: Context, url: String) {
        val value=url.trim();if(value.isNotEmpty())checkedUrl(value)
        check(prefs(ctx).edit().putString(K_URL,value).commit()){"לא ניתן לשמור את כתובת העדכון"}
    }
    fun lastCheck(ctx: Context): Long = prefs(ctx).getLong(K_TIME, 0L)
    fun pending(ctx: Context): Boolean = prefs(ctx).getBoolean(K_PENDING, false)
    fun clearPending(ctx: Context) = prefs(ctx).edit().putBoolean(K_PENDING, false).apply()

    /** בפתיחה ראשונה מעתיקים את הגרסה המצורפת ל-APK כדי שתמיד יהיה ממה להתחיל. */
    fun seedIfEmpty(ctx: Context) {
        val f = webFile(ctx)
        try {
            val current = runCatching{validateContent(Payloads.bytes(currentText(ctx)))}.getOrDefault("")
            if(current.isNotBlank() && prefs(ctx).getInt("bundledCode",0)==BuildConfig.VERSION_CODE)return
            val bundledBytes=ctx.assets.open(FILE).use{Payloads.read(it)}
            val bundled=validateContent(bundledBytes)
            // Installing a newer wrapper also installs its newer HTML, keeping
            // the same origin and local data. Never downgrade a newer OTA file.
            if(current.isBlank() || contentVersion(bundled) > contentVersion(current)) {
                writeAtomic(f,bundledBytes)
                prefs(ctx).edit().putString(K_HASH,sha(bundledBytes)).putBoolean(K_PENDING,false).apply()
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
                val bytes=download(url)
                val text=validateContent(bytes)
                val current=runCatching{currentText(ctx)}.getOrDefault("")
                if(contentVersion(text)<contentVersion(current)){
                    prefs(ctx).edit().putLong(K_TIME,System.currentTimeMillis()).apply()
                    onDone("same","הגרסה במכשיר חדשה מזו שבשרת");return@execute
                }

                val h = sha(bytes)
                prefs(ctx).edit().putLong(K_TIME, System.currentTimeMillis()).apply()

                if (h == sha(current.toByteArray(Charsets.UTF_8))) { onDone("same", "כבר מעודכן"); return@execute }

                writeAtomic(webFile(ctx),bytes)
                prefs(ctx).edit().putString(K_HASH, h).putBoolean(K_PENDING, true).apply()
                onDone("updated", "ירדה גרסה חדשה")
            } catch (e: Exception) {
                onDone("error", e.message ?: "שגיאת רשת")
            }
        }
    }
}
