package il.mesima.app

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.Source
import com.google.firebase.storage.FirebaseStorage
import com.google.firebase.storage.StorageMetadata
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Explicit, versioned backups. Upload the complete JSON (including images) to
 * Storage, then publish metadata to Firestore only after upload succeeds.
 * No listener ever overwrites local data. Restore always goes through __import. */
object CloudBackup {
    private val busy = AtomicBoolean(false)
    @Volatile private var message = ""
    fun configured(c: Context): Boolean = runCatching {
        FirebaseApp.getApps(c).isNotEmpty() || FirebaseApp.initializeApp(c) != null
    }.getOrDefault(false)
    private fun auth() = FirebaseAuth.getInstance()
    fun status(c: Context): JSONObject {
        val configured = configured(c)
        return JSONObject().put("configured", configured)
            .put("email", if(configured) auth().currentUser?.email ?: "" else "")
            .put("busy", busy.get()).put("message", message)
            .put("lastBackup", Backups.prefs(c).getLong("lastCloud", 0))
    }
    private fun begin(c: Context, signedIn: Boolean = true): Boolean {
        if (!configured(c)) { message="עדיין לא הוגדר פרויקט Firebase"; return false }
        if (signedIn && auth().currentUser == null) { message="צריך להיכנס לחשבון"; return false }
        if (!busy.compareAndSet(false, true)) return false
        message=""; return true
    }
    private fun finish(text: String, done: () -> Unit) {message=text;busy.set(false);done()}
    private fun error(e: Exception): String {
        // Firebase error codes aid setup without returning passwords or tokens.
        val code = (e as? com.google.firebase.FirebaseException)?.let { it.javaClass.simpleName } ?: "NetworkError"
        return "הפעולה לא הושלמה ($code). בדוק חיבור, פרטי כניסה והרשאות בפרויקט."
    }
    fun signIn(c: Context, email: String, password: String, create: Boolean, done: () -> Unit) {
        if (!begin(c, false)) { done(); return }
        val request = if (create) auth().createUserWithEmailAndPassword(email, password)
                      else auth().signInWithEmailAndPassword(email, password)
        request.addOnSuccessListener { finish("החשבון מחובר", done) }
            .addOnFailureListener { finish(error(it), done) }
    }
    fun signOut(c: Context, done: () -> Unit) {
        if (busy.get()) { message="המתן לסיום הפעולה לפני התנתקות";done();return }
        if(configured(c)) auth().signOut()
        message="";done()
    }
    private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    fun upload(c: Context, done: () -> Unit) {
        if (!begin(c)) {done();return}
        Backups.executor.execute {
            try {
                require(Backups.prefs(c).getString("snapshotError", "").isNullOrBlank()) { "Snapshot unavailable" }
                val text=Backups.read(c); val data=Backups.validate(text);val bytes=text.toByteArray(Charsets.UTF_8)
                val uid=auth().currentUser!!.uid;val id=UUID.randomUUID().toString()
                val path="users/$uid/backups/$id.json"
                val ref=FirebaseStorage.getInstance().reference.child(path)
                ref.putBytes(bytes, StorageMetadata.Builder().setContentType("application/json").build())
                    .addOnFailureListener {finish(error(it),done)}
                    .addOnSuccessListener {
                        val now=System.currentTimeMillis()
                        val meta=hashMapOf<String,Any>("createdAt" to now,"path" to path,
                            "bytes" to bytes.size,"sha256" to sha(bytes),"taskCount" to data.getJSONArray("tasks").length(),
                            "appVersion" to "4.6", "schema" to data.optInt("v",10))
                        FirebaseFirestore.getInstance().collection("users").document(uid).collection("backups").document(id)
                            .set(meta).addOnSuccessListener {
                                Backups.prefs(c).edit().putLong("lastCloud",now).apply();finish("הגיבוי נשמר בענן",done)
                            }.addOnFailureListener { e ->
                                // Metadata failed: clean up only this upload, never an earlier backup.
                                ref.delete();finish(error(e),done)
                            }
                    }
            } catch(e: Exception) {finish(error(e),done)}
        }
    }
    fun list(c: Context, done: () -> Unit, show: (JSONArray) -> Unit) {
        if(!begin(c)){done();return}
        val uid=auth().currentUser!!.uid
        FirebaseFirestore.getInstance().collection("users").document(uid).collection("backups")
            .orderBy("createdAt",Query.Direction.DESCENDING).limit(50).get(Source.SERVER)
            .addOnFailureListener {finish(error(it),done)}.addOnSuccessListener { rows ->
                val out=JSONArray()
                rows.forEach { d -> out.put(JSONObject().put("id",d.id).put("createdAt",d.getLong("createdAt") ?: 0)
                    .put("taskCount",d.getLong("taskCount") ?: 0)) }
                finish("",done);show(out)
            }
    }
    fun restore(c: Context, id: String, done: () -> Unit, show: (String) -> Unit) {
        if(!id.matches(Regex("[0-9a-fA-F-]{36}")))return
        if(!begin(c)){done();return}
        val uid=auth().currentUser!!.uid
        FirebaseFirestore.getInstance().collection("users").document(uid).collection("backups").document(id)
            .get(Source.SERVER).addOnFailureListener {finish(error(it),done)}.addOnSuccessListener { meta ->
                val expectedPath="users/$uid/backups/$id.json"
                if(!meta.exists() || meta.getString("path")!=expectedPath){finish("הגיבוי אינו זמין",done);return@addOnSuccessListener}
                FirebaseStorage.getInstance().reference.child(expectedPath).getBytes(Backups.MAX_BYTES.toLong())
                    .addOnFailureListener {finish(error(it),done)}.addOnSuccessListener { bytes ->
                        try {
                            require(sha(bytes)==meta.getString("sha256")) { "Checksum mismatch" }
                            val text=bytes.toString(Charsets.UTF_8);Backups.validate(text)
                            finish("הגיבוי הורד; יש לאשר את השחזור",done);show(text)
                        }catch(e:Exception){finish("הגיבוי פגום; המידע המקומי לא השתנה",done)}
                    }
            }
    }
}
