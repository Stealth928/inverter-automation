const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Generate P-256 key pair
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

console.log('PRIVATE_KEY_START');
console.log(privateKey);
console.log('PRIVATE_KEY_END');
console.log('PUBLIC_KEY_START');
console.log(publicKey);
console.log('PUBLIC_KEY_END');
