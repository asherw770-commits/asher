# אפליקציית פנימייה — הגדרת ענן (Firestore + GitHub + Vercel)

## מה זה
האפליקציה עברה משמירה מקומית בלבד (localStorage) לשמירה גם בענן (Firestore).
היא מתחברת אוטומטית עם משתמש קבוע (מוגדר ב-env vars ב-Vercel) — אין מסך התחברות.
כך אפשר לגשת מהטלפון ומהמחשב לאותם נתונים.

## שלב 1 — Firestore Security Rules
ב-Firebase Console → Firestore Database → לשונית **Rules** → הדבק את התוכן
של הקובץ `firestore.rules` שבתיקייה הזו → **Publish**.

זו ההגנה האמיתית על הנתונים — לא ה-apiKey (שהוא ממילא גלוי בכל אתר עם Firebase,
וזה תקין ומוכר).

## שלב 2 — יצירת ריפוזיטורי ב-GitHub
1. היכנס ל-github.com → **New repository** → תן שם (למשל `yeshiva-app`) → **Private** מומלץ
2. העלה את **כל הקבצים** מהתיקייה הזו (`src/`, `build.js`, `package.json`,
   `vercel.json`, `.gitignore`, `firestore.rules`) — **חוץ מ-`dist/`** (זה נוצר אוטומטית)

אפשר להעלות דרך הדפדפן (גרירת קבצים) או עם git:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/USERNAME/yeshiva-app.git
git push -u origin main
```

## שלב 3 — חיבור Vercel
1. היכנס ל-vercel.com → **Add New Project** → בחר את הריפוזיטורי מ-GitHub
2. **לפני שלוחצים Deploy** — פתח **Environment Variables** והוסף את שש הערכים
   מתוך `firebaseConfig` שקיבלת מ-Firebase Console (Project settings → Your apps):

   | שם המשתנה ב-Vercel | מאיפה |
   |---|---|
   | `FIREBASE_API_KEY` | apiKey |
   | `FIREBASE_AUTH_DOMAIN` | authDomain |
   | `FIREBASE_PROJECT_ID` | projectId |
   | `FIREBASE_STORAGE_BUCKET` | storageBucket |
   | `FIREBASE_MESSAGING_SENDER_ID` | messagingSenderId |
   | `FIREBASE_APP_ID` | appId |
   | `FIREBASE_USER_EMAIL` | האימייל של המשתמש הקבוע ב-Firebase Auth |
   | `FIREBASE_USER_PASSWORD` | הסיסמה של אותו משתמש |

3. **Deploy**. Vercel יריץ אוטומטית את `npm run build`, שמזריק את הערכים
   האלה לתוך הקובץ הסופי (`build.js` עושה את זה) — הם אף פעם לא נכנסים ל-git.

## שלב 4 — בדיקה
פתח את הכתובת שVercel נתן. האפליקציה תתחבר אוטומטית ותיפתח (אין מסך התחברות),
והנתונים יישמרו גם מקומית וגם ב-Firestore, ויתעדכנו אוטומטית בין מכשירים.

⚠️ כל מי שיפתח את הכתובת ייכנס למשתמש הקבוע ויראה את הנתונים. אם אתה רוצה
שרק אתה תיגש — אל תשתף את הכתובת. הסיסמה גלויה בקוד המקור של הדף.

## הערה על סנכרון
זה סנכרון "מי ששומר אחרון מנצח" — אם שני מכשירים משנים בו-זמנית, השמירה
המאוחרת יותר גוברת. אין מיזוג חכם של שינויים סותרים.
