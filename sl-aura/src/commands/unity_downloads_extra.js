'use strict';
const { getT } = require('../lang');
const axios    = require('axios');
const path     = require('path');
const cfg      = require('../../config');
const { sendButtons } = require('./helper');

// ══════════════════════════════════════════════════════
// SL AURA DOWNLOADS EXTRA — Rebuilt 2026
// FB, IG, Twitter — updated working APIs
// ══════════════════════════════════════════════════════

module.exports = {
  commands: [
    'twitter', 'twdl', 'twtstalk',
    'mediafire', 'mfire',
    'ig', 'instagram',
    'facebook', 'fb',
    'gdrive', 'gdrive2', 'googledrive',
    'downurl', 'down', 'dlurl',
    'apk',
    'rw', 'wallpaper', 'wall',
  ],

  async run({ sock, m }) {
    const tr   = await getT(m.sessionOwner);
    const cmd  = m.command;
    const chat = m.chat;
    const msg  = m.msg;
    const q    = m.text?.trim();

    // ══════════════════════════════════════════════════
    // TWITTER / X
    // ══════════════════════════════════════════════════
    if (['twitter', 'twdl', 'twtstalk'].includes(cmd)) {
      if (!q || !q.startsWith('http')) {
        return sendButtons(sock, chat, {
          text: `🐦 *Twitter / X Downloader*\n\n*Usage:* .twdl <twitter link>\n\n*Example:* .twdl https://twitter.com/...\n\n${cfg.footer}`,
          footer: cfg.footer,
          buttons: [{ label: '📋 Menu', id: '.menu' }],
          quoted: msg,
        });
      }
      await m.react('⏳');

      const twApis = [
        // 1. Cobalt — best 2026
        async () => {
          for (const inst of [
            'https://api.cobalt.tools',
            'https://cobalt.oisd.nl',
            'https://cobalt.catvibers.me',
            'https://cobalt.api.timelessnesses.me',
          ]) {
            try {
              const r = await axios.post(`${inst}/`, {
                url: q, downloadMode: 'auto', videoQuality: '720',
              }, {
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                timeout: 18000,
              });
              if (r?.data?.url) return { video_hd: r.data.url, video_sd: r.data.url, desc: 'Twitter Video', thumb: null };
            } catch {}
          }
          throw new Error('cobalt all failed');
        },
        // 2. Twittervideodownloader
        async () => {
          const r = await axios.get(
            `https://twittervideodownloader.com/api/request?url=${encodeURIComponent(q)}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }
          );
          const d = r.data;
          const vids = d?.videos || [];
          const hd = vids.find(v => v.type === 'video/mp4' && v.src?.includes('720'))?.src || vids.find(v => v.type === 'video/mp4')?.src;
          const sd = vids.find(v => v.type === 'video/mp4')?.src;
          if (!sd && !hd) throw new Error('no video');
          return { video_hd: hd || sd, video_sd: sd || hd, desc: d?.text || 'Twitter Video', thumb: d?.thumbnail || null };
        },
        // 3. TwDown
        async () => {
          const r = await axios.get(
            `https://twdown.net/api/?url=${encodeURIComponent(q)}`,
            { timeout: 20000 }
          );
          const d = r.data;
          const sd = d?.data?.SD || d?.data?.sd;
          const hd = d?.data?.HD || d?.data?.hd || sd;
          if (!sd) throw new Error('no url');
          return { video_hd: hd, video_sd: sd, desc: d?.data?.tweet || 'Twitter Video', thumb: null };
        },
        // 4. SaveTweetVid scrape
        async () => {
          const r = await axios.post(
            'https://savetweetvid.com/',
            new URLSearchParams({ url: q }),
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': 'https://savetweetvid.com/',
                'User-Agent': 'Mozilla/5.0',
              },
              timeout: 20000,
            }
          );
          const matches = [...(r.data || '').matchAll(/href="(https:\/\/video\.twimg\.com\/[^"]+\.mp4[^"]*)"/g)].map(m => m[1]);
          if (!matches.length) throw new Error('no links');
          const hd = matches.find(u => u.includes('720')) || matches[0];
          const sd = matches[matches.length - 1] || hd;
          return { video_hd: hd, video_sd: sd, desc: 'Twitter Video', thumb: null };
        },
        // 5. GetVideoBot API
        async () => {
          const r = await axios.get(
            `https://getvideobot.com/api?url=${encodeURIComponent(q)}`,
            { timeout: 20000 }
          );
          const links = r.data?.links || [];
          const hd = links.find(l => l.quality?.includes('720'))?.url || links[0]?.url;
          if (!hd) throw new Error('no url');
          return { video_hd: hd, video_sd: links[links.length - 1]?.url || hd, desc: 'Twitter Video', thumb: null };
        },
        // 6. SnapSave API (supports Twitter)
        async () => {
          const r = await axios.post(
            'https://snapsave.app/action.php',
            new URLSearchParams({ url: q }),
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Referer: 'https://snapsave.app/',
                'User-Agent': 'Mozilla/5.0',
              },
              timeout: 20000,
            }
          );
          const html = r?.data || '';
          const urlM = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/);
          if (!urlM?.[1]) throw new Error('no url');
          return { video_hd: urlM[1], video_sd: urlM[1], desc: 'Twitter Video', thumb: null };
        },
        // 7. Dark-Yasiya (legacy fallback)
        async () => {
          const r = await axios.get(
            `https://www.dark-yasiya-api.site/download/twitter?url=${encodeURIComponent(q)}`,
            { timeout: 25000 }
          );
          if (!r.data?.status || !r.data?.result) throw new Error('no result');
          const { desc, thumb, video_sd, video_hd } = r.data.result;
          if (!video_sd && !video_hd) throw new Error('no video');
          return { video_hd: video_hd || video_sd, video_sd: video_sd || video_hd, desc, thumb };
        },
      ];

      let twData = null;
      for (let i = 0; i < twApis.length; i++) {
        try {
          twData = await twApis[i]();
          if (twData?.video_sd || twData?.video_hd) {
            console.log(`[TW DL] ✅ method ${i + 1}`);
            break;
          }
        } catch (e) {
          console.log(`[TW DL] ❌ method ${i + 1}: ${e.message?.substring(0, 60)}`);
        }
      }

      if (!twData?.video_sd && !twData?.video_hd) {
        await m.react('❌');
        return m.reply(`❌ Twitter video download failed.\n\nLink check කරලා retry කරන්න.\n\n${cfg.footer}`);
      }

      const { video_sd, video_hd, desc, thumb } = twData;

      try {
        const captionText = `🐦 *Twitter Downloader*\n\n📝 *${desc || 'Twitter Video'}*\n\n*Reply with:*\n*1* — SD Video\n*2* — HD Video\n*3* — Audio (MP3)\n\n${cfg.footer}`;
        if (thumb) {
          await sock.sendMessage(chat, { image: { url: thumb }, caption: captionText }, { quoted: msg });
        } else {
          await sock.sendMessage(chat, { text: captionText }, { quoted: msg });
        }
        await m.react('✅');
      } catch {
        await m.react('✅');
      }

      const listener = sock.ev.on('messages.upsert', async (upsert) => {
        const reply = upsert.messages[0];
        if (!reply?.message) return;
        const repText = reply.message?.conversation || reply.message?.extendedTextMessage?.text;
        const replyJid = reply.key.remoteJid;
        if (replyJid !== chat) return;
        if (repText === '1') {
          await sock.sendMessage(chat, { video: { url: video_sd }, caption: `*SD Video*\n\n${cfg.footer}` }, { quoted: reply });
          sock.ev.off('messages.upsert', listener);
        } else if (repText === '2') {
          await sock.sendMessage(chat, { video: { url: video_hd || video_sd }, caption: `*HD Video*\n\n${cfg.footer}` }, { quoted: reply });
          sock.ev.off('messages.upsert', listener);
        } else if (repText === '3') {
          await sock.sendMessage(chat, { audio: { url: video_sd }, mimetype: 'audio/mpeg' }, { quoted: reply });
          sock.ev.off('messages.upsert', listener);
        }
      });
      setTimeout(() => sock.ev.off('messages.upsert', listener), 120000);
    }

    // ══════════════════════════════════════════════════
    // MEDIAFIRE
    // ══════════════════════════════════════════════════
    if (['mediafire', 'mfire'].includes(cmd)) {
      if (!q || !q.startsWith('http')) {
        return sendButtons(sock, chat, {
          text: `📦 *MediaFire Downloader*\n\n*Usage:* .mfire <mediafire link>\n\n${cfg.footer}`,
          footer: cfg.footer,
          buttons: [{ label: '📋 Menu', id: '.menu' }],
          quoted: msg,
        });
      }
      await m.react('⏳');
      try {
        // Extract real download link from MediaFire page
        const page = await axios.get(q, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });
        const html = page.data || '';
        const dlUrl = html.match(/href="(https:\/\/download[^"]+mediafire[^"]+)"/)?.[1]
          || html.match(/id="downloadButton"[^>]+href="([^"]+)"/)?.[1]
          || html.match(/a\s+id="downloadButton"[^>]+href="([^"]+)"/)?.[1];
        if (!dlUrl) throw new Error('Could not find download link');
        const fileName = html.match(/<div class="filename">([^<]+)<\/div>/)?.[1]?.trim() || 'mediafire_file';
        await m.react('⬆️');
        await sock.sendMessage(chat, {
          document: { url: dlUrl },
          fileName,
          mimetype: 'application/octet-stream',
          caption: `📦 *MediaFire*\n\n📄 ${fileName}\n\n${cfg.footer}`,
        }, { quoted: msg });
        await m.react('✅');
      } catch (e) {
        await m.react('❌');
        return m.reply(`❌ MediaFire error: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ══════════════════════════════════════════════════
    // INSTAGRAM
    // ══════════════════════════════════════════════════
    if (['ig', 'instagram'].includes(cmd)) {
      if (!q || !q.startsWith('http')) {
        return sendButtons(sock, chat, {
          text: `📸 *Instagram Downloader*\n\n*Usage:* .ig <instagram link>\n\n*Example:* .ig https://www.instagram.com/p/...\n\n${cfg.footer}`,
          footer: cfg.footer,
          buttons: [{ label: '📋 Menu', id: '.menu' }],
          quoted: msg,
        });
      }
      await m.react('⏳');

      const igExtract = (d) => {
        if (!d) return null;
        const raw = d?.result || d?.data || d?.medias || d?.items || d;
        const arr = Array.isArray(raw) ? raw : [raw];
        const items = [];
        for (const item of arr) {
          const url = item?.url || item?.video_url || item?.display_url
            || item?.image || item?.download_url || item?.src || item?.link;
          if (!url || typeof url !== 'string' || !url.startsWith('http')) continue;
          const isVideo = item?.type === 'video' || item?.media_type === 1
            || url.includes('.mp4') || url.includes('/video/');
          items.push({ url, isVideo });
        }
        return items.length ? items : null;
      };

      const igApis = [
        // 1. Cobalt — best for reels/videos 2026
        async () => {
          for (const inst of [
            'https://api.cobalt.tools',
            'https://cobalt.oisd.nl',
            'https://cobalt.catvibers.me',
            'https://cobalt.api.timelessnesses.me',
          ]) {
            try {
              const r = await axios.post(`${inst}/`, { url: q, downloadMode: 'auto' }, {
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 18000,
              });
              if (r?.data?.url) return [{ url: r.data.url, isVideo: true }];
              if (r?.data?.picker) return r.data.picker.map(p => ({ url: p.url, isVideo: p.type === 'video' }));
            } catch {}
          }
          throw new Error('cobalt all failed');
        },
        // 2. SaveInsta (most reliable scraper 2026)
        async () => {
          const r1 = await axios.get('https://saveinsta.app/', {
            headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000,
          });
          const csrfMatch = r1.data?.match(/name="_token"\s+value="([^"]+)"/);
          const token = csrfMatch?.[1];
          const body = { url: q };
          if (token) body._token = token;
          const r = await axios.post('https://saveinsta.app/api/ajaxSearch',
            new URLSearchParams({ q }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://saveinsta.app/' }, timeout: 22000 }
          );
          const urls = [...(r?.data?.data || '').matchAll(/href="(https:\/\/[^"]+\.(?:mp4|jpg|jpeg|png)[^"]*)"/g)].map(m => m[1]);
          if (!urls.length) throw new Error('no urls');
          return urls.map(url => ({ url, isVideo: url.includes('.mp4') }));
        },
        // 3. SnapSave
        async () => {
          const r = await axios.post('https://snapsave.app/action.php',
            new URLSearchParams({ url: q }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://snapsave.app/', 'User-Agent': 'Mozilla/5.0' }, timeout: 22000 }
          );
          const html = r?.data || '';
          const videos = [...html.matchAll(/href="(https:\/\/[^"]+\.mp4[^"]*)"/g)].map(m => m[1]);
          const images = [...html.matchAll(/src="(https:\/\/[^"]+\.(jpg|jpeg|png)[^"]*)"/g)].map(m => m[1]);
          const all = [...videos.map(u => ({ url: u, isVideo: true })), ...images.map(u => ({ url: u, isVideo: false }))];
          if (!all.length) throw new Error('no media');
          return all;
        },
        // 4. InstaDownloader
        async () => {
          const r = await axios.post('https://instadownloader.co/backend/post.php',
            new URLSearchParams({ url: q }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://instadownloader.co/' }, timeout: 22000 }
          );
          const d = r.data;
          const items = igExtract(d);
          if (!items) throw new Error('no items');
          return items;
        },
        // 5. Dpviewer API
        async () => {
          const r = await axios.get(`https://www.dpviewer.com/media.php?url=${encodeURIComponent(q)}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }
          );
          const items = igExtract(r.data?.result || r.data);
          if (!items) throw new Error('no result');
          return items;
        },
        // 6. Reelsaver
        async () => {
          const r = await axios.post('https://reelsaver.net/wp-json/aio-dl/video-data/',
            JSON.stringify({ url: q }),
            { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
          );
          const medias = r.data?.medias || [];
          if (!medias.length) throw new Error('no media');
          return medias.map(m => ({ url: m.url, isVideo: m.extension === 'mp4' }));
        },
        // 7. Instasave.io
        async () => {
          const r = await axios.get(`https://instasave.io/api/?url=${encodeURIComponent(q)}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }
          );
          const items = igExtract(r.data?.media || r.data?.result || r.data);
          if (!items) throw new Error('no result');
          return items;
        },
        // 8. BKAPI
        async () => {
          const r = await axios.get(`https://bk9.fun/download/instagram?url=${encodeURIComponent(q)}`, { timeout: 25000 });
          const items = igExtract(r.data?.BK9 || r.data?.data || r.data);
          if (!items) throw new Error('no result');
          return items;
        },
        // 9. Ndevapi
        async () => {
          const r = await axios.get(`https://ndevapi.com/download/instagram?url=${encodeURIComponent(q)}`, { timeout: 25000 });
          const items = igExtract(r.data?.data || r.data);
          if (!items) throw new Error('no result');
          return items;
        },
        // 10. Siputzx fallback
        async () => {
          const r = await axios.get(`https://api.siputzx.my.id/api/d/instagram?url=${encodeURIComponent(q)}`, { timeout: 25000 });
          const items = igExtract(r.data?.data || r.data);
          if (!items) throw new Error('no result');
          return items;
        },
        // 11. SnapInsta (added 2026-07)
        async () => {
          const r = await axios.post('https://snapinsta.app/action.php',
            new URLSearchParams({ url: q }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://snapinsta.app/', 'User-Agent': 'Mozilla/5.0' }, timeout: 22000 }
          );
          const html = r?.data || '';
          const videos = [...html.matchAll(/href="(https:\/\/[^"]+\.mp4[^"]*)"/g)].map(m => m[1]);
          const images = [...html.matchAll(/src="(https:\/\/[^"]+\.(jpg|jpeg|png)[^"]*)"/g)].map(m => m[1]);
          const all = [...videos.map(u => ({ url: u, isVideo: true })), ...images.map(u => ({ url: u, isVideo: false }))];
          if (!all.length) throw new Error('no media');
          return all;
        },
        // 12. FastDL (added 2026-07)
        async () => {
          const r = await axios.get(`https://fastdl.app/api/convert?url=${encodeURIComponent(q)}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }
          );
          const items = igExtract(r.data?.result || r.data?.medias || r.data);
          if (!items) throw new Error('no result');
          return items;
        },
        // 13. IGram.world (added 2026-07)
        async () => {
          const r = await axios.post('https://api.igram.world/api/convert',
            { url: q },
            { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
          );
          const items = igExtract(r.data?.medias || r.data?.data || r.data);
          if (!items) throw new Error('no result');
          return items;
        },
      ];

      let igMedia = null;
      for (const [i, fn] of igApis.entries()) {
        try {
          igMedia = await fn();
          if (igMedia?.length) { console.log(`[IG DL] ✅ method ${i + 1}`); break; }
        } catch (e) { console.log(`[IG DL] ❌ method ${i + 1}: ${e.message?.substring(0, 60)}`); }
      }

      if (!igMedia?.length) {
        await m.react('❌');
        return m.reply(`❌ Instagram download failed.\n\nLink valid ද check කරන්න. Private posts download කරන්න බෑ.\n\n${cfg.footer}`);
      }

      await m.react('⬆️');
      for (const item of igMedia.slice(0, 10)) {
        if (!item?.url) continue;
        if (item.isVideo) {
          await sock.sendMessage(chat, { video: { url: item.url }, caption: `📸 *Instagram*\n\n${cfg.footer}` }, { quoted: msg }).catch(() => {});
        } else {
          await sock.sendMessage(chat, { image: { url: item.url }, caption: `📸 *Instagram*\n\n${cfg.footer}` }, { quoted: msg }).catch(() => {});
        }
      }
      await m.react('✅');
    }

    // ══════════════════════════════════════════════════
    // FACEBOOK
    // ══════════════════════════════════════════════════
    if (['facebook', 'fb'].includes(cmd)) {
      if (!q || !q.startsWith('http')) {
        return sendButtons(sock, chat, {
          text: `📘 *Facebook Video Downloader*\n\n*Usage:* .fb <facebook link>\n\n*Example:* .fb https://www.facebook.com/...\n\n${cfg.footer}`,
          footer: cfg.footer,
          buttons: [{ label: '📋 Menu', id: '.menu' }],
          quoted: msg,
        });
      }
      await m.react('⏳');

      const FB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';

      const fbApis = [
        // 1. Cobalt — #1 working 2026
        async () => {
          for (const inst of [
            'https://api.cobalt.tools',
            'https://cobalt.oisd.nl',
            'https://cobalt.catvibers.me',
            'https://cobalt.api.timelessnesses.me',
          ]) {
            try {
              const r = await axios.post(`${inst}/`, { url: q, downloadMode: 'auto', videoQuality: '720' }, {
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 18000,
              });
              if (r?.data?.url) return { sd: r.data.url, hd: r.data.url, title: 'Facebook Video', thumbnail: null };
            } catch {}
          }
          throw new Error('cobalt all failed');
        },
        // 2. Snapsave — very reliable 2026
        async () => {
          const r = await axios.post('https://snapsave.app/action.php',
            new URLSearchParams({ url: q }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://snapsave.app/', 'User-Agent': FB_UA }, timeout: 25000 }
          );
          const html = r?.data || '';
          const hdMatch = html.match(/href="(https:\/\/video[^"]+\.mp4[^"]*)"/);
          const sdMatch = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/);
          const url = hdMatch?.[1] || sdMatch?.[1];
          if (!url) throw new Error('no url in html');
          return { sd: url, hd: url, title: 'Facebook Video', thumbnail: null };
        },
        // 3. FBDownloader.net
        async () => {
          const r = await axios.post('https://www.fbdownloader.net/api/getAjax',
            new URLSearchParams({ url: q }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': FB_UA }, timeout: 22000 }
          );
          const d = r.data;
          const sd = d?.sd || d?.urls?.sd || d?.download;
          const hd = d?.hd || d?.urls?.hd || sd;
          if (!sd) throw new Error('no url');
          return { sd, hd: hd || sd, title: d?.title || 'Facebook Video', thumbnail: d?.thumbnail || null };
        },
        // 4. getfvid.com
        async () => {
          const r = await axios.post('https://www.getfvid.com/downloader',
            new URLSearchParams({ url: q }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://www.getfvid.com/', 'User-Agent': FB_UA }, timeout: 25000 }
          );
          const html = r?.data || '';
          const hdM = html.match(/href="(https:\/\/[^"]*\.(mp4)[^"]*)"[^>]*>.*?HD/is)?.[1];
          const sdM = html.match(/href="(https:\/\/[^"]*\.(mp4)[^"]*)"/)?.[1];
          const sd = sdM || hdM;
          const hd = hdM || sd;
          if (!sd) throw new Error('no url');
          return { sd, hd, title: 'Facebook Video', thumbnail: null };
        },
        // 5. Fdown.net
        async () => {
          const r = await axios.post('https://fdown.net/download.php',
            new URLSearchParams({ URLz: q }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://fdown.net/', 'User-Agent': FB_UA }, timeout: 25000 }
          );
          const html = r?.data || '';
          const hdM = html.match(/id="hdlink"[^>]*href="([^"]+)"/)?.[1];
          const sdM = html.match(/id="sdlink"[^>]*href="([^"]+)"/)?.[1];
          const sd = sdM || hdM;
          const hd = hdM || sd;
          if (!sd) throw new Error('no url in fdown');
          return { sd, hd, title: 'Facebook Video', thumbnail: null };
        },
        // 6. SaveFrom API (supports FB)
        async () => {
          const r = await axios.get(
            `https://sfrom.us/api/convert?url=${encodeURIComponent(q)}&lang=en`,
            { headers: { 'User-Agent': FB_UA }, timeout: 20000 }
          );
          const links = r.data?.url || [];
          const hd = links.find(l => l.id?.includes('hd') || l.q?.includes('HD'))?.url;
          const sd = links.find(l => !l.id?.includes('hd'))?.url || links[0]?.url;
          if (!sd && !hd) throw new Error('no url');
          return { sd: sd || hd, hd: hd || sd, title: 'Facebook Video', thumbnail: null };
        },
        // 7. VidDownloader
        async () => {
          const r = await axios.post('https://viddownloader.app/api/analyze',
            JSON.stringify({ url: q }),
            { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
          );
          const d = r.data;
          const medias = d?.medias || d?.data || [];
          const arr = Array.isArray(medias) ? medias : [medias];
          const hd = arr.find(m => m.quality?.includes('HD') || m.quality?.includes('720'))?.url;
          const sd = arr.find(m => m.extension === 'mp4')?.url || arr[0]?.url;
          if (!sd && !hd) throw new Error('no url');
          return { sd: sd || hd, hd: hd || sd, title: d?.title || 'Facebook Video', thumbnail: d?.thumbnail || null };
        },
        // 8. Siputzx fallback
        async () => {
          const r = await axios.get(`https://api.siputzx.my.id/api/d/fb?url=${encodeURIComponent(q)}`, { timeout: 25000 });
          const d = r.data?.data || r.data;
          const sd = d?.sd || d?.download || d?.url;
          const hd = d?.hd || sd;
          if (!sd) throw new Error('no url');
          return { sd, hd, title: d?.title || 'Facebook Video', thumbnail: d?.thumbnail || null };
        },
        // 9. Ndevapi fallback
        async () => {
          const r = await axios.get(`https://ndevapi.com/download/facebook?url=${encodeURIComponent(q)}`, { timeout: 25000 });
          const d = r.data?.data || r.data;
          const sd = d?.sd || d?.url;
          if (!sd) throw new Error('no url');
          return { sd, hd: d?.hd || sd, title: d?.title || 'Facebook Video', thumbnail: d?.thumbnail || null };
        },
        // 10. FastDL (added 2026-07)
        async () => {
          const r = await axios.get(`https://fastdl.app/api/convert?url=${encodeURIComponent(q)}`,
            { headers: { 'User-Agent': FB_UA }, timeout: 20000 }
          );
          const d = r.data?.result || r.data;
          const sd = d?.sd || d?.url || d?.medias?.[0]?.url;
          if (!sd) throw new Error('no url');
          return { sd, hd: d?.hd || sd, title: d?.title || 'Facebook Video', thumbnail: d?.thumbnail || null };
        },
        // 11. GetInDevice (added 2026-07)
        async () => {
          const r = await axios.post('https://getindevice.com/api/facebook',
            { url: q },
            { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
          );
          const d = r.data?.data || r.data;
          const sd = d?.sd || d?.low || d?.url;
          const hd = d?.hd || d?.high || sd;
          if (!sd) throw new Error('no url');
          return { sd, hd, title: d?.title || 'Facebook Video', thumbnail: d?.thumbnail || null };
        },
        // 12. Siputzx retry (fb-specific endpoint, added 2026-07)
        async () => {
          const r = await axios.get(`https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(q)}`, { timeout: 25000 });
          const d = r.data?.data || r.data;
          const sd = d?.sd || d?.low || d?.url;
          const hd = d?.hd || d?.high || sd;
          if (!sd) throw new Error('no url');
          return { sd, hd, title: d?.title || 'Facebook Video', thumbnail: d?.thumbnail || null };
        },
      ];

      let fbData = null;
      let usedApi = '';
      const apiNames = ['Cobalt','SnapSave','FBDownloader','GetFVid','Fdown','SaveFrom','VidDownloader','Siputzx','Ndevapi','FastDL','GetInDevice','SiputzxFB'];
      for (let i = 0; i < fbApis.length; i++) {
        try {
          fbData = await fbApis[i]();
          if (fbData?.sd || fbData?.hd) {
            usedApi = apiNames[i] || `API${i + 1}`;
            console.log(`[FB DL] ✅ ${usedApi}`);
            break;
          }
        } catch (e) {
          console.log(`[FB DL] ❌ ${apiNames[i] || i + 1}: ${e.message?.substring(0, 60)}`);
        }
      }

      if (!fbData?.sd && !fbData?.hd) {
        await m.react('❌');
        return m.reply(`❌ Facebook video download failed.\n\nLink valid ද check කරන්න. Public posts විතරයි download කරන්න පුළුවන්.\n\n${cfg.footer}`);
      }

      const { sd, hd, title, thumbnail } = fbData;

      const captionText = `📘 *Facebook Downloader*\n\n📝 *${title || 'Facebook Video'}*\n✅ via ${usedApi}\n\n*Reply with:*\n*1.1* — SD Video\n*1.2* — HD Video\n*2.1* — Audio\n*2.2* — Document\n\n${cfg.footer}`;

      try {
        if (thumbnail) {
          await sock.sendMessage(chat, { image: { url: thumbnail }, caption: captionText }, { quoted: msg });
        } else {
          throw new Error('no thumbnail');
        }
      } catch {
        await sock.sendMessage(chat, { text: captionText }, { quoted: msg });
      }
      await m.react('✅');

      const listener = sock.ev.on('messages.upsert', async (upsert) => {
        const reply = upsert.messages[0];
        if (!reply?.message) return;
        const repText = reply.message?.conversation || reply.message?.extendedTextMessage?.text;
        const replyJid = reply.key.remoteJid;
        if (replyJid !== chat) return;
        if (repText === '1.1') {
          await sock.sendMessage(chat, { video: { url: sd }, caption: `*SD Video*\n\n${cfg.footer}` }, { quoted: reply });
          sock.ev.off('messages.upsert', listener);
        } else if (repText === '1.2') {
          await sock.sendMessage(chat, { video: { url: hd || sd }, caption: `*HD Video*\n\n${cfg.footer}` }, { quoted: reply });
          sock.ev.off('messages.upsert', listener);
        } else if (repText === '2.1') {
          await sock.sendMessage(chat, { audio: { url: sd }, mimetype: 'audio/mpeg' }, { quoted: reply });
          sock.ev.off('messages.upsert', listener);
        } else if (repText === '2.2') {
          await sock.sendMessage(chat, { document: { url: sd }, mimetype: 'video/mp4', fileName: 'FB_Video.mp4', caption: cfg.footer }, { quoted: reply });
          sock.ev.off('messages.upsert', listener);
        }
      });
      setTimeout(() => sock.ev.off('messages.upsert', listener), 120000);
    }

    // ══════════════════════════════════════════════════
    // GDRIVE
    // ══════════════════════════════════════════════════
    if (['gdrive', 'gdrive2', 'googledrive'].includes(cmd)) {
      if (!q || !q.startsWith('http')) {
        return sendButtons(sock, chat, {
          text: `📂 *Google Drive Downloader*\n\n*Usage:* .gdrive <drive link>\n\n${cfg.footer}`,
          footer: cfg.footer,
          buttons: [{ label: '📋 Menu', id: '.menu' }],
          quoted: msg,
        });
      }
      await m.react('⏳');
      try {
        const res  = await axios.get(`https://api.fgmods.xyz/api/downloader/gdrive?url=${encodeURIComponent(q)}&apikey=mnp3grlZ`, { timeout: 30000 });
        const data = res.data;
        if (!data?.result?.download) throw new Error('no download link');
        await m.react('⬆️');
        await sock.sendMessage(chat, {
          document: { url: data.result.download },
          mimetype: data.result.mimeType || 'application/octet-stream',
          fileName: data.result.name || 'GDrive_File',
          caption: `📂 *Google Drive*\n\n📄 *${data.result.name || 'File'}*\n\n${cfg.footer}`,
        }, { quoted: msg });
        await m.react('✅');
      } catch (e) {
        await m.react('❌');
        return m.reply(`❌ GDrive error: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ══════════════════════════════════════════════════
    // DIRECT URL DOWNLOAD
    // ══════════════════════════════════════════════════
    if (['downurl', 'down', 'dlurl'].includes(cmd)) {
      if (!q) {
        return sendButtons(sock, chat, {
          text: `📁 *Direct URL Downloader*\n\n*Usage:* .down <direct link>\n\n${cfg.footer}`,
          footer: cfg.footer,
          buttons: [{ label: '📋 Menu', id: '.menu' }],
          quoted: msg,
        });
      }
      const urlMatch = /^(https?:\/\/[^\s]+)/i;
      if (!urlMatch.test(q.trim())) return m.reply(`❌ Invalid URL.\n\n${cfg.footer}`);

      await m.react('⬇️');
      try {
        const headRes  = await axios.head(q.trim(), { timeout: 15000 });
        const mimeType = headRes.headers['content-type'] || 'application/octet-stream';
        const disp     = headRes.headers['content-disposition'] || '';
        let fileName   = disp.includes('filename=')
          ? disp.split('filename=')[1].replaceAll('"', '').trim()
          : path.basename(new URL(q.trim()).pathname) || 'Downloaded_File';
        await m.react('⬆️');
        await sock.sendMessage(chat, { document: { url: q.trim() }, mimetype: mimeType, fileName, caption: `📁 *${fileName}*\n\n${cfg.footer}` }, { quoted: msg });
        await m.react('✅');
      } catch (e) {
        await m.react('❌');
        return m.reply(`❌ Download failed: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ══════════════════════════════════════════════════
    // APK
    // ══════════════════════════════════════════════════
    if (cmd === 'apk') {
      if (!q) {
        return sendButtons(sock, chat, {
          text: `📱 *APK Downloader*\n\n*Usage:* .apk <app name>\n\n${cfg.footer}`,
          footer: cfg.footer,
          buttons: [{ label: '📋 Menu', id: '.menu' }],
          quoted: msg,
        });
      }
      await m.react('⬇️');
      try {
        const apiUrl = `http://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(q)}/limit=1`;
        const res    = await axios.get(apiUrl, { timeout: 30000 });
        const app    = res.data?.datalist?.list?.[0];
        if (!app) throw new Error('App not found');
        const sizeMB = (app.size / 1000000).toFixed(2);
        await m.react('⬆️');
        await sock.sendMessage(chat, {
          document: { url: app.file?.path_alt },
          fileName: app.name,
          mimetype: 'application/vnd.android.package-archive',
          caption: `📱 *APK Downloader*\n\n🏷️ *${app.name}*\n💾 ${sizeMB} MB\n📦 ${app.package}\n\n${cfg.footer}`,
        }, { quoted: msg });
        await m.react('✅');
      } catch (e) {
        await m.react('❌');
        return m.reply(`❌ APK error: ${e.message}\n\n${cfg.footer}`);
      }
    }

    // ══════════════════════════════════════════════════
    // WALLPAPER
    // ══════════════════════════════════════════════════
    if (['rw', 'wallpaper', 'wall'].includes(cmd)) {
      if (!q) {
        return sendButtons(sock, chat, {
          text: `🖼️ *Wallpaper Download*\n\n*Usage:* .wallpaper <search term>\n\n${cfg.footer}`,
          footer: cfg.footer,
          buttons: [{ label: '📋 Menu', id: '.menu' }],
          quoted: msg,
        });
      }
      await m.react('⏳');
      try {
        const r = await axios.get(`https://api.unsplash.com/photos/random?query=${encodeURIComponent(q)}&client_id=WaOiSXvJ3mPFKHjSqCGMHD7bsGGJ9-Nmi5p8gqU3bpg`, { timeout: 20000 });
        const url = r.data?.urls?.full || r.data?.urls?.regular;
        if (!url) throw new Error('not found');
        await sock.sendMessage(chat, { image: { url }, caption: `🖼️ *Wallpaper* — ${q}\n\n${cfg.footer}` }, { quoted: msg });
        await m.react('✅');
      } catch {
        try {
          await sock.sendMessage(chat, { image: { url: `https://source.unsplash.com/1920x1080/?${encodeURIComponent(q)}` }, caption: `🖼️ *Wallpaper* — ${q}\n\n${cfg.footer}` }, { quoted: msg });
          await m.react('✅');
        } catch (e2) {
          await m.react('❌');
          return m.reply(`❌ Wallpaper error: ${e2.message}\n\n${cfg.footer}`);
        }
      }
    }
  },
};
