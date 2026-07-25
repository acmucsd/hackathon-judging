import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, set, onValue } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const firebaseConfig = {
  apiKey: "AIzaSyBQxqo_m1Bz3K-EgGuCXmqBPJAMg6GIYiQ",
  authDomain: "hackathon-judging-18e67.firebaseapp.com",
  databaseURL: "https://hackathon-judging-18e67-default-rtdb.firebaseio.com",
  projectId: "hackathon-judging-18e67",
  storageBucket: "hackathon-judging-18e67.firebasestorage.app",
  messagingSenderId: "1092857095265",
  appId: "1:1092857095265:web:25b03c1c9bc148c12bb620"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

window._fbSet = (path, data) => set(ref(db, path), data);
window._fbOn  = (path, cb)   => onValue(ref(db, path), snap => cb(snap.val()));
window._dbReady = true;
window.dispatchEvent(new Event('firebase-ready'));
