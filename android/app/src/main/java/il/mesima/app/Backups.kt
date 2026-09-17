package il.mesima.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.AtomicFile
import androidx.documentfile.provider.DocumentFile
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** A validated, atomic mirror of the last committed WebView database.
 * Workers use it without launching the Activity or a hidden WebView. */
object Backups {
    const val MAX_BYTES = 20 * 1024 * 1024
    private const val WORK = "mesima-local-backup"
    val executor = Executors.newSingleThreadExecutor()
    fun prefs(c: Context) = c.getSharedPreferences("mesima-backups", Context.MODE_PRIVATE)
    private fun file(c: Context) = AtomicFile(File(c.filesDir, "backup-snapshot.json"))

    fun validate(text: String): JSONObject {
        require(text.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "הגיבוי גדול מ־20MB" }
        val data = JSONObject(text)
        require(data.optJSONArray("tasks") != null) { "קובץ הגיבוי אינו תקין" }
        for (key in listOf("events", "notes", "lists", "places", "links", "eventTypes")) {
            require(!data.has(key) || data.optJSONArray(key) != null) { "קובץ הגיבוי אינו תקין" }
        }
        return data
    }

    @Synchronized fun snapshot(c: Context, text: String): Boolean {
        return try {
            validate(text)
            val atomic = file(c)
            val stream = atomic.startWrite()
            try { stream.write(text.toByteArray(Charsets.UTF_8)); atomic.finishWrite(stream) }
            catch (e: Exception) { atomic.failWrite(stream); throw e }
            prefs(c).edit().putString("snapshotError", "").apply()
            true
        } catch (e: Exception) {
            prefs(c).edit().putString("snapshotError", "לא ניתן להכין גיבוי: ${e.message}").apply()
            false
        }
    }

    @Synchronized fun read(c: Context): String {
        val text = file(c).openRead().bufferedReader(Charsets.UTF_8).use { it.readText() }
        validate(text)
        return text
    }

    fun selectFolder(c: Context, uri: Uri) {
        c.contentResolver.takePersistableUriPermission(uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        val folder = DocumentFile.fromTreeUri(c, uri)
        require(folder != null && folder.canWrite()) { "אין הרשאת כתיבה לתיקייה" }
        prefs(c).edit().putString("folder", uri.toString()).putString("error", "").apply()
    }

    fun configure(c: Context, days: Int) {
        require(days in listOf(0, 1, 7, 30))
        val wm = WorkManager.getInstance(c)
        if (days == 0) wm.cancelUniqueWork(WORK)
        else {
            require(prefs(c).getString("folder", "").orEmpty().isNotBlank()) { "בחר קודם תיקיית גיבוי" }
            val work = PeriodicWorkRequestBuilder<BackupWorker>(days.toLong(), TimeUnit.DAYS)
                .setInitialDelay(days.toLong(), TimeUnit.DAYS).build()
            wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, work)
        }
        prefs(c).edit().putInt("days", days).putString("error", "").apply()
    }

    fun local(c: Context): Boolean {
        var created: DocumentFile? = null
        return try {
            // Never report success with an older snapshot after a failed mirror write.
            require(prefs(c).getString("snapshotError", "").isNullOrBlank()) { "המידע העדכני לא נשמר לגיבוי" }
            val text = read(c)
            val uri = prefs(c).getString("folder", "").orEmpty()
            require(uri.isNotBlank()) { "לא נבחרה תיקיית גיבוי" }
            val folder = DocumentFile.fromTreeUri(c, Uri.parse(uri))
            require(folder != null && folder.canWrite()) { "ההרשאה לתיקייה חסרה; בחר אותה מחדש" }
            val stamp = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss-SSS", Locale.US).format(Date())
            created = folder.createFile("application/json", "Mesima_Backup_${stamp}_${UUID.randomUUID().toString().take(6)}.json")
                ?: error("לא ניתן ליצור קובץ בתיקייה")
            val output = c.contentResolver.openOutputStream(created.uri, "w") ?: error("לא ניתן לפתוח את הגיבוי")
            output.use { it.write(text.toByteArray(Charsets.UTF_8)); it.flush() }
            prefs(c).edit().putLong("lastLocal", System.currentTimeMillis()).putString("error", "").apply()
            true
        } catch (e: Exception) {
            // Only the brand-new incomplete file is removed. Earlier backups stay intact.
            runCatching { created?.delete() }
            prefs(c).edit().putString("error", "הגיבוי לא הושלם: ${e.message}").apply()
            false
        }
    }

    fun status(c: Context): JSONObject {
        val p = prefs(c)
        return JSONObject().put("folder", p.getString("folder", "").orEmpty().isNotBlank())
            .put("days", p.getInt("days", 0)).put("lastLocal", p.getLong("lastLocal", 0))
            .put("error", p.getString("snapshotError", "").takeUnless { it.isNullOrBlank() } ?: p.getString("error", ""))
            .put("cloud", CloudBackup.status(c))
    }
}

class BackupWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        if (Backups.prefs(applicationContext).getInt("days", 0) == 0) return Result.success()
        // Permission failures remain visible in settings; avoid an endless retry loop.
        return if (Backups.local(applicationContext)) Result.success() else Result.failure()
    }
}
