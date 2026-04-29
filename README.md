# ש״ב – ניהול ישיבה

אפליקציית ווב (PWA) לניהול ישיבה: הפקדות טלפונים, משימות כתיבה, שיחות אישיות, ומשימות.

## מבנה

- `index.html` — האפליקציה כולה (HTML + CSS + JS בקובץ אחד).
- `vercel.json` — הגדרות פריסה ל-Vercel (אתר סטטי).
- `firebase-config.example.js` — תבנית להגדרות Firebase (להעתיק ל-`firebase-config.js` עם הערכים שלך).

## פיתוח מקומי

מספיק לפתוח את `index.html` בדפדפן, או להריץ שרת מקומי:

```bash
python3 -m http.server 8000
# ואז http://localhost:8000
```

## פריסה ל-Vercel

1. דחוף את הריפו ל-GitHub.
2. ב-[vercel.com](https://vercel.com) → **Add New Project** → ייבוא מ-GitHub.
3. **Framework Preset:** Other. אין צורך ב-build command.
4. **Deploy**.

## חיבור ל-Firestore

הקוד הנוכחי מאחסן ב-`localStorage`. כדי להעביר ל-Firestore:

1. ב-[Firebase Console](https://console.firebase.google.com) → צור פרויקט → הוסף Web App → קבל את ה-`firebaseConfig`.
2. ב-Firestore Database → צור Database (Production mode).
3. העתק את `firebase-config.example.js` ל-`firebase-config.js` והכנס את הערכים.
4. הוסף את הסקריפטים בתחתית `index.html` (ראה הוראות בקובץ הדוגמה).

### Security Rules בסיסיות (לאחר הוספת אימות)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /yeshiva/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
