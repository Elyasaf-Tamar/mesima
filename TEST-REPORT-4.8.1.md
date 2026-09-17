# Mesima 4.8.1 verification

Android package: `il.mesima.app`, versionName `1.7.1`, versionCode `18`.

- All 34 JavaScript model tests passed.
- All 12 Android JVM tests passed; signed release build succeeded.
- The new packaged-version check rejects the previous 4.8 APK: the APK manifest says 1.7 while the compiled `WebBridge.version()` method returns 1.6.
- The same check passes on the corrected APK: the manifest and the compiled bridge both return 1.7.1, satisfying the embedded page's minimum Android version 1.7.
- The web compatibility check classifies a bridge reporting 1.7.1 as current, removing the erroneous old-wrapper warning.
- Release signature matches the original 4.4 certificate, and embedded `assets/index.html` exactly matches the 4.8.1 web build.

This patch changes version reporting and release metadata, without changing stored user data or Firebase rules. The actual installation and display on the user's phone must be confirmed after installing the replacement APK.
