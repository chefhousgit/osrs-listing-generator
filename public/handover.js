// Buyer handover message, sent to the buyer after a sale. Shared by the listing page (app.js)
// and the Orders page (orders.js).

window.HANDOVER_TEMPLATE = `RSN: {rsn}
2FA Secret Key: 


2FA Secret Key Generator:
https://totp.danhersam.com/

Please send a message confirming you have logged into the account so I can remove the account details from my panel. If you have any other questions or concerns feel free to reach out. Thank you!`;

// Put a 2FA secret key on the "2FA Secret Key:" line of a message (added at the end if missing).
window.withSecretKey = function (text, key) {
  const line = /^2FA Secret Key:.*$/m;
  return line.test(text) ? text.replace(line, '2FA Secret Key: ' + key) : text.replace(/\s*$/, '') + '\n2FA Secret Key: ' + key;
};

// The full message for an account: RSN and (if known) its 2FA secret key filled in.
window.buildHandover = function (rsn, key) {
  const text = window.HANDOVER_TEMPLATE.replace('{rsn}', rsn || '');
  return key ? window.withSecretKey(text, key) : text;
};
