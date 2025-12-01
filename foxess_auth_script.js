var sdk = require('postman-collection');
var crypto = require('crypto-js');

// Get the path from the request URL
var path = "/" + pm.request.url.path.join("/");

var token = pm.variables.get("token");
if (!token) {
    token = "";
} else if (typeof token === 'string') {
    // Remove all whitespace and non-printable characters
    token = token.replace(/\s/g, '').replace(/[^\x20-\x7E]/g, '');
} else {
    token = String(token);
}

var timestamp = new Date().getTime();

// Signature rule: Encrypt the string url + "\r\n" + token + "\r\n" + timestamp with md5
var signaturePlain = path + "\\r\\n" + token + "\\r\\n" + timestamp;
var signature = crypto.MD5(signaturePlain).toString();

// Debugging
console.log("Path:", path);
console.log("Token:", token);
console.log("Signature:", signature);

pm.request.headers.upsert({key: "token", value: token});
pm.request.headers.upsert({key: "timestamp", value: timestamp.toString()});
pm.request.headers.upsert({key: "signature", value: signature});
pm.request.headers.upsert({key: "lang", value: "en"});
pm.request.headers.upsert({key: "Content-Type", value: "application/json"});
