package il.mesima.app

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * פתיחת הכספת בטביעת אצבע.
 * The vault password is encrypted with an Android Keystore key that can be
 * used only right after a strong biometric check, and that Android destroys
 * when a new fingerprint is enrolled. The password never leaves the device
 * in readable form; the web layer receives it only after a successful scan.
 */
object VaultBio {
    private const val ALIAS = "mesima_vault_bio"
    private const val PREFS = "vault_bio"

    fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun available(c: Context) = BiometricManager.from(c).canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
    fun enabled(c: Context) = prefs(c).contains("ct") && keyStore().containsAlias(ALIAS)

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun cipher() = Cipher.getInstance("AES/GCM/NoPadding")

    private fun newKey(): SecretKey {
        disableKey()
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
            .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG) }
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run { init(spec); generateKey() }
    }

    private fun disableKey() { try { keyStore().deleteEntry(ALIAS) } catch (_: Exception) {} }
    fun disable(c: Context) { prefs(c).edit().clear().apply(); disableKey() }

    private fun prompt(act: FragmentActivity, title: String, cipher: Cipher, done: (Cipher?, String?) -> Unit) {
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle("כספת · משימה")
            .setNegativeButtonText("סיסמה")
            .setAllowedAuthenticators(BIOMETRIC_STRONG)
            .build()
        val bp = BiometricPrompt(act, ContextCompat.getMainExecutor(act), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = done(result.cryptoObject?.cipher, null)
            override fun onAuthenticationError(code: Int, msg: CharSequence) = done(null,
                if (code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_USER_CANCELED) "cancel" else msg.toString())
        })
        bp.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    /** Stores the password behind the fingerprint. Calls back (ok, error). */
    fun enable(act: FragmentActivity, password: String, cb: (Boolean, String?) -> Unit) {
        if (!available(act)) return cb(false, "אין טביעת אצבע זמינה במכשיר")
        val c = try { cipher().apply { init(Cipher.ENCRYPT_MODE, newKey()) } } catch (e: Exception) { return cb(false, e.message) }
        prompt(act, "הפעלת פתיחה בטביעת אצבע", c) { ok, err ->
            if (ok == null) { disableKey(); return@prompt cb(false, err) }
            try {
                val ct = ok.doFinal(password.toByteArray(Charsets.UTF_8))
                prefs(act).edit()
                    .putString("iv", Base64.encodeToString(ok.iv, Base64.NO_WRAP))
                    .putString("ct", Base64.encodeToString(ct, Base64.NO_WRAP)).apply()
                cb(true, null)
            } catch (e: Exception) { disable(act); cb(false, e.message) }
        }
    }

    /** Returns the password after a fingerprint scan. Calls back (password, error). */
    fun unlock(act: FragmentActivity, cb: (String?, String?) -> Unit) {
        val p = prefs(act); val iv = p.getString("iv", null); val ct = p.getString("ct", null)
        if (iv == null || ct == null) return cb(null, "off")
        val key = try { keyStore().getKey(ALIAS, null) as? SecretKey } catch (_: Exception) { null }
            ?: run { disable(act); return cb(null, "invalidated") }
        val c = try { cipher().apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))) } }
            catch (_: KeyPermanentlyInvalidatedException) { disable(act); return cb(null, "invalidated") }
            catch (e: Exception) { return cb(null, e.message) }
        prompt(act, "פתיחת הכספת", c) { ok, err ->
            if (ok == null) return@prompt cb(null, err)
            try { cb(String(ok.doFinal(Base64.decode(ct, Base64.NO_WRAP)), Charsets.UTF_8), null) }
            catch (e: Exception) { cb(null, e.message) }
        }
    }
}
