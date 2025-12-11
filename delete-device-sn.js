#!/usr/bin/env node
// Script to delete deviceSN from user config

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccount = require('./functions/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://inverter-automation-firebase.firebaseio.com'
});

const db = admin.firestore();

async function deleteDeviceSN() {
  try {
    const userEmail = 'sardanapalos928@hotmail.com';
    const docRef = db.collection('users').doc(userEmail).collection('config').doc('main');
    
    console.log(`Deleting deviceSN from ${userEmail}/config/main...`);
    
    await docRef.update({
      deviceSN: admin.firestore.FieldValue.delete()
    });
    
    console.log('✓ deviceSN deleted successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

deleteDeviceSN();
