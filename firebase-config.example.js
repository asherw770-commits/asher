// העתק קובץ זה ל-firebase-config.js והכנס את הערכים מ-Firebase Console.
// (firebase-config.js מוסתר ב-.gitignore אם תוסיף שורה כזאת)
//
// כדי לחבר את הקוד ל-Firestore, צריך:
// 1. להוסיף בתחתית ה-<body> ב-index.html, לפני שאר הסקריפטים:
//
// <script type="module">
//   import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
//   import { getFirestore, doc, getDoc, setDoc }
//     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
//   import { firebaseConfig } from "./firebase-config.js";
//   const app = initializeApp(firebaseConfig);
//   window.__db = getFirestore(app);
// </script>
//
// 2. להחליף את ld()/sv() ב-index.html לקרוא/לכתוב ל-Firestore במקום ל-localStorage.
//    שים לב: Firestore הוא אסינכרוני — צריך לעטוף את האתחול ב-async/await.

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
