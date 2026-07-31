'use strict';
/**
 * pub_download_social.js
 * NOTE: Download pending reply handling has been moved to unity_dl.js.
 * messageHandler.js now calls unity_dl.handlePendingDownload directly.
 * This stub is kept for backward compatibility only — always returns false.
 */
async function handleSocialPendingReply(_sock, _m) {
  return false;
}
module.exports = { handleSocialPendingReply };
