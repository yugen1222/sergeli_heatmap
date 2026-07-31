import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDRvsn15ornx30mkwiTlhhlaL3-HT67D_w",
  authDomain: "sergeli-heatmap.firebaseapp.com",
  databaseURL: "https://sergeli-heatmap-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "sergeli-heatmap",
  storageBucket: "sergeli-heatmap.firebasestorage.app",
  messagingSenderId: "587633182406",
  appId: "1:587633182406:web:18b1fc7da7ba9fb8f979c7",
  measurementId: "G-43974K6NSQ"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
