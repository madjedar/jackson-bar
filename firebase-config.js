import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { 
    getFirestore, collection, addDoc, getDocs, onSnapshot, deleteDoc, doc, setDoc, getDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { 
    getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBTiiJVXI3WTQKBWUVflI0suvFlQnA2Ass",
  authDomain: "jackson-bar-b8cc2.firebaseapp.com",
  projectId: "jackson-bar-b8cc2",
  storageBucket: "jackson-bar-b8cc2.firebasestorage.app",
  messagingSenderId: "32416912805",
  appId: "1:32416912805:web:d200ce18078dccdbaa844c",
  measurementId: "G-4P24DHMYXV"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Expose everything to window for script.js to use without needing to be a module itself
window.fb = {
    db,
    storage,
    collection,
    addDoc,
    getDocs,
    onSnapshot,
    deleteDoc,
    doc,
    setDoc,
    getDoc,
    query,
    orderBy,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
};

window.dispatchEvent(new Event('firebase_ready'));
