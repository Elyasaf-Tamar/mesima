# משימה 4.9

יישומונים לבחירה, הערות במצב קריאה ובחלקים, ממשק נקי ואיפוס נסיעה: [CHANGELOG-4.9-HE.md](CHANGELOG-4.9-HE.md). מעטפת Android היא 1.8 (קוד גרסה 19).

הוראות התקנה, רשימת השינויים ומידע על סנכרון: [README-4.8-HE.md](README-4.8-HE.md).

הורדת ה־APK החתום: [Releases](https://github.com/Elyasaf-Tamar/mesima/releases).

האתר וכתובת העדכונים: [Mesima](https://elyasaf-tamar.github.io/mesima/).

פרסום גרסאות: [GITHUB-UPLOAD-HE.md](GITHUB-UPLOAD-HE.md).

הקוד מחולק למודולים בתיקיית src; להרכבת האתר מריצים `node tools/build.mjs`.

`node --test tests/*.test.mjs` מריץ את בדיקות המודל. קוד Android נמצא בתיקיית `android`.
GitHub Actions בודק את הקוד ובונה APK לפיתוח; להתקנה על האפליקציה הקיימת משתמשים ב־APK החתום שב־Releases.

מפתחות חתימה ותצורת Firebase נשמרים מקומית מחוץ למאגר. קובצי מקור ישנים וכפולים הוחלפו במבנה המקור של 4.8; אין צורך לחלץ ZIP כדי לבנות.
