# אפליקציית פנימייה — הגדרת ענן (Firestore + GitHub + Vercel)

## מה זה
האפליקציה שומרת גם מקומית (localStorage) וגם בענן (Firestore) על מסמך יחיד
משותף (`/shared/main`) — בלי מסך התחברות ובלי אימות. כל מי שיש לו את URL של
Vercel נכנס ישר לאפליקציה ורואה/עורך את הנתונים.

## שלב 1 — Firestore Security Rules
ב-Firebase Console → Firestore Database → לשונית **Rules** → הדבק את התוכן
של הקובץ `firestore.rules` שבתיקייה הזו → **Publish**.

הכללים פותחים את המסמך `shared/main` לקריאה וכתיבה ללא אימות. אבטחה כאן
היא רק דרך הסתרת ה-URL — אל תשתף את URL של Vercel ואל תעלה את פרטי
Firebase config לשום מקום פומבי אם אתה רוצה שהנתונים לא יהיו נגישים לכל.

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

3. **Deploy**. Vercel יריץ אוטומטית את `npm run build`, שמזריק את הערכים
   האלה לתוך הקובץ הסופי (`build.js` עושה את זה) — הם אף פעם לא נכנסים ל-git.

## שלב 4 — בדיקה
פתח את הכתובת שVercel נתן. האפליקציה תיפתח מיד (אין מסך התחברות),
והנתונים יישמרו גם מקומית וגם ב-Firestore, ויתעדכנו אוטומטית בין מכשירים.

⚠️ אין אימות. כל מי שיפתח את הכתובת רואה ועורך את הנתונים. אל תשתף את
הכתובת.

## הערה על סנכרון
זה סנכרון "מי ששומר אחרון מנצח" — אם שני מכשירים משנים בו-זמנית, השמירה
המאוחרת יותר גוברת. אין מיזוג חכם של שינויים סותרים.
