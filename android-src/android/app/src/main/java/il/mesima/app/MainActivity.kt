package il.mesima.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader

class MainActivity : ComponentActivity() {

    companion object {
        /** origin וירטואלי קבוע. הוא https אמיתי מבחינת ה-WebView, ולכן
         *  מיקום, התראות ו-localStorage עובדים — והוא לעולם לא משתנה. */
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val HOME   = "$ORIGIN/app/index.html"
    }

    private lateinit var web: WebView
    private lateinit var loader: WebViewAssetLoader

    /** הדף מעדכן את זה בכל רינדור: האם יש עוד שכבה לסגור לפני יציאה. */
    @Volatile var canGoBack: Boolean = false
    private var backCb: OnBackPressedCallback? = null

    /** הדף מודיע שהוא חי ומוכן לקבל פתיחת התראה. */
    @Volatile private var webReady = false
    private var pendingAlarm: String? = null

    private val fineReq = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()) { res ->
        val ok = res[Manifest.permission.ACCESS_FINE_LOCATION] == true
        // אנדרואיד 11+: "Allow all the time" לא מופיע בדיאלוג הראשון.
        // חייבים בקשה שנייה ונפרדת, אחרת הרשאת הרקע נדחית בשקט.
        if (ok && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            bgReq.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        } else notifyJs()
    }
    private val bgReq = registerForActivityResult(
        ActivityResultContracts.RequestPermission()) { Fences.reapply(this); notifyJs() }
    private val notifReq = registerForActivityResult(
        ActivityResultContracts.RequestPermission()) { notifyJs() }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        Notif.channel(this)
        Updater.seedIfEmpty(this)

        loader = WebViewAssetLoader.Builder()
            .addPathHandler("/app/", WebViewAssetLoader.InternalStoragePathHandler(this, Updater.webDir(this)))
            .addPathHandler("/bundled/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        web.setBackgroundColor(0xFF0B0F14.toInt())
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_NO_CACHE   // הקובץ מקומי; המטמון רק מבלבל בעדכונים
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = false
            setGeolocationEnabled(true)
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)        // target=_blank ייפול ל-shouldOverrideUrlLoading
            allowFileAccess = false                 // כבר לא צריך; פחות שטח תקיפה
            allowContentAccess = false
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, req: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(req.url)

            /** קישורים חיצוניים — וויז, וואטסאפ, גוגל — נפתחים באפליקציה הנכונה.
             *  בלי זה הם היו פשוט לא עושים כלום בתוך ה-WebView. */
            override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest): Boolean {
                val u: Uri = req.url
                if (u.host == "appassets.androidplatform.net") return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    true
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "לא נמצאה אפליקציה לקישור", Toast.LENGTH_SHORT).show()
                    true
                }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            // בלי זה ה-WebView דוחה בשקט כל navigator.geolocation
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?, callback: GeolocationPermissions.Callback?
            ) {
                val granted = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                callback?.invoke(origin, granted, false)
                if (!granted) askLocation()
            }
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                android.util.Log.d("mesima-web", "${m.message()} @${m.lineNumber()}")
                return true
            }
        }

        web.addJavascriptInterface(WebBridge(this), "MesimaNative")
        setContentView(web)
        web.loadUrl(HOME)

        // כפתור "חזרה" של המערכת עובר קודם לדף: הוא סוגר מודאל, יוצא
        // מהערה, חוזר ל"היום" — ורק כשאין לו יותר מה לסגור האפליקציה נסגרת.
        //
        // ההחלטה נלקחת מדגל שה-JS מעדכן בכל רינדור (canGoBack), ולא מתשובה
        // אסינכרונית של evaluateJavascript. גרסה קודמת שאלה את הדף בכל לחיצה
        // וחיכתה לתשובה; אם התשובה איחרה או חזרה null, הקולבק כיבה את עצמו
        // והאפליקציה נסגרה באמצע מסלול — בדיוק הבאג של "יציאה מתוך הערה".
        backCb = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (canGoBack) {
                    web.evaluateJavascript("window.__back&&window.__back()", null)
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        }
        onBackPressedDispatcher.addCallback(this, backCb!!)

        handleAlarmIntent(intent)

        Fences.reapply(this)
        // רישום מחדש של תזכורות השעה מהרשימה השמורה. ה-JS ידרוס אותה
        // ברגע שהוא נטען, אבל ככה הן חיות גם אם ה-WebView נכשל
        Sched.reapply(this)
        // בדיקת עדכון שקטה בכל פתיחה
        if (Updater.sourceUrl(this).isNotBlank()) Updater.check(this) { _, _ -> notifyJs() }
    }

    fun reloadApp() = runOnUiThread { Updater.clearPending(this); web.loadUrl(HOME) }

    fun askLocation() {
        fineReq.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,
                               Manifest.permission.ACCESS_COARSE_LOCATION))
    }
    fun askNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            notifReq.launch(Manifest.permission.POST_NOTIFICATIONS)
        else notifyJs()
    }

    fun notifyJs() {
        runOnUiThread { web.evaluateJavascript("window.dispatchEvent(new Event('native-perms'))", null) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAlarmIntent(intent)
    }

    /** התראה שנלחצה מביאה איתה מזהה. הדף פותח עליו את חלון התזכורת
     *  המלא — כותרת, תיאור, תמונה ותת-משימות — ולא רק נפתח בעמוד הבית. */
    private fun handleAlarmIntent(i: Intent?) {
        val id = i?.getStringExtra("taskId") ?: return
        i.removeExtra("taskId")
        if (webReady) fireAlarmJs(id) else pendingAlarm = id
    }

    private fun fireAlarmJs(id: String) = runOnUiThread {
        val safe = org.json.JSONObject.quote(id)
        web.evaluateJavascript("window.__alarm&&window.__alarm($safe)", null)
    }

    /** נקרא מה-JS דרך הגשר ברגע שהדף מוכן. */
    fun webIsReady() = runOnUiThread {
        webReady = true
        pendingAlarm?.let { fireAlarmJs(it); pendingAlarm = null }
    }

    override fun onResume() {
        super.onResume()
        // קולבק שכיבה את עצמו ביציאה קודמת חייב לחזור לפעולה, אחרת
        // הלחיצה הבאה על "חזרה" תעקוף את הדף לגמרי.
        backCb?.isEnabled = true
        notifyJs()
    }
}
