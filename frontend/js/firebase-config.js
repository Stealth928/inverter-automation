/**
 * Firebase Configuration
 * 
 * Replace the values below with your actual Firebase project config.
 * Get these from Firebase Console > Project Settings > Your apps > Web app
 */

/**
 * Firebase Configuration for Inverter Automation Dashboard
 * Project: inverter-automation-firebase
 */

const firebaseConfig = {
  apiKey: "AIzaSyDUbi89rbCYvTgoOVQRjx5zkhpYUU1f8eo",
  authDomain: "inverter-automation-firebase.firebaseapp.com",
  projectId: "inverter-automation-firebase",
  storageBucket: "inverter-automation-firebase.firebasestorage.app",
  messagingSenderId: "527688083750",
  appId: "1:527688083750:web:b508cc98adb9926c7a79e7",
  measurementId: "G-MWF4ZBMREE"
};

// Expose config to browser global so non-module scripts can access it
if (typeof window !== 'undefined') {
  window.firebaseConfig = firebaseConfig;
}

// Export for use in CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = firebaseConfig;
}
