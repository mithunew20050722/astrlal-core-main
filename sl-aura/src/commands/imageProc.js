'use strict';
/**
 * imageProc.js
 * Portable image processing — tries sharp first, falls back to jimp.
 * Works on Termux where sharp native binaries are unavailable.
 */

async function blurImage(buffer, radius = 15) {
  // Try sharp first
  try {
    const sharp = require('sharp');
    return await sharp(buffer).blur(radius).toBuffer();
  } catch { /* sharp not available or failed */ }

  // Fall back to jimp (pure JS, works everywhere)
  try {
    const Jimp = require('jimp');
    const img = await Jimp.read(buffer);
    img.blur(radius);
    return await img.getBuffer('image/png');
  } catch (e) {
    throw new Error(`blur failed: ${e.message}`);
  }
}

async function resizeImage(buffer, width, height, fit = 'cover') {
  try {
    const sharp = require('sharp');
    return await sharp(buffer).resize(width, height, { fit }).toBuffer();
  } catch { /* sharp not available */ }

  try {
    const Jimp = require('jimp');
    const img = await Jimp.read(buffer);
    img.resize(width, height);
    return await img.getBuffer('image/png');
  } catch (e) {
    throw new Error(`resize failed: ${e.message}`);
  }
}

module.exports = { blurImage, resizeImage };
