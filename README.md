# משימה 4.9.1

תיקון סיכומי ימים קודמים והעברת השלמות מהארכיון להיסטוריה: [CHANGELOG-4.9.1-HE.md](CHANGELOG-4.9.1-HE.md). כולל Windows 4.9.1 ו־Android 1.8.1 (קוד גרסה 20).

הוראות התקנה, רשימת השינויים ומידע על סנכרון: [README-4.9.1-HE.md](README-4.9.1-HE.md).

הורדת ה־APK החתום: [Releases](https://github.com/Elyasaf-Tamar/mesima/releases).

האתר וכתובת העדכונים: [Mesima](https://elyasaf-tamar.github.io/mesima/).

פרסום גרסאות: [GITHUB-UPLOAD-HE.md](GITHUB-UPLOAD-HE.md).

שמירת כלי בנייה וניקוי תיקיות ישנות: [RELEASE-WORKFLOW.md](RELEASE-WORKFLOW.md).

הקוד מחולק למודולים בתיקיית src; להרכבת האתר מריצים `node tools/build.mjs`.

`node --test tests/*.test.mjs` מריץ את בדיקות המודל. קוד Android נמצא בתיקיית `android`.
GitHub Actions בודק את הקוד ובונה APK לפיתוח; להתקנה על האפליקציה הקיימת משתמשים ב־APK החתום שב־Releases.

מפתחות חתימה ותצורת Firebase נשמרים מקומית מחוץ למאגר. קובצי מקור ישנים וכפולים הוחלפו במבנה המקור של 4.8; אין צורך לחלץ ZIP כדי לבנות.
