import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

// Your web app's Firebase configuration.
// Note: These keys are meant to be public. They identify your Firebase project
// on Google's servers. Security is not managed by hiding these keys, but by
// setting up Firebase Security Rules in your Firebase console to control
// who can read or write data.
const firebaseConfig = {
  apiKey: "AIzaSyCVsnY-BMo2T-T77ZZexsWu-Zfk3rRiXrA",
  authDomain: "gams-685e8.firebaseapp.com",
  databaseURL: "https://gams-685e8-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "gams-685e8",
  storageBucket: "gams-685e8.appspot.com",
  messagingSenderId: "892298536131",
  appId: "1:892298536131:web:c81d4d41b99cc92d676e76",
  measurementId: "G-H7BVD0P03P"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
export const auth = getAuth(app);