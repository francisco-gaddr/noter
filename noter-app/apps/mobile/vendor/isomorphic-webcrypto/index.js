'use strict';
// Bare `require('isomorphic-webcrypto')` → same global.crypto-backed shim as the RN subpath.
module.exports = require('./src/react-native.js');
