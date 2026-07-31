'use strict';
const axios  = require('axios');
const cfg    = require('../../config');
const { sendButtons } = require('./helper');

const SL_CITY_ALIASES = {
  'kotte':          'Sri Jayawardenepura Kotte',
  'jayawardena':    'Sri Jayawardenepura Kotte',
  'nuwara':         'Nuwara Eliya',
  'nuwaraeliya':    'Nuwara Eliya',
  'nuwara eliya':   'Nuwara Eliya',
  'trinco':         'Trincomalee',
  'dehiwala':       'Dehiwala-Mount Lavinia',
  'mount lavinia':  'Dehiwala-Mount Lavinia',
  'jaela':          'Ja-Ela',
  'ja ela':         'Ja-Ela',
  'anuradapura':    'Anuradhapura',
  'polonnaruva':    'Polonnaruwa',
};

function resolveCity(input) {
  return SL_CITY_ALIASES[input.toLowerCase().trim()] || input.trim();
}

function weatherEmoji(desc = '') {
  const d = desc.toLowerCase();
  if (d.includes('thunder') || d.includes('storm'))         return '⛈️';
  if (d.includes('snow') || d.includes('sleet'))            return '❄️';
  if (d.includes('heavy rain') || d.includes('torrential')) return '🌧️';
  if (d.includes('rain') || d.includes('shower'))           return '🌦️';
  if (d.includes('drizzle'))                                return '🌂';
  if (d.includes('fog') || d.includes('mist'))              return '🌫️';
  if (d.includes('haze') || d.includes('smoke'))            return '😶‍🌫️';
  if (d.includes('overcast'))                               return '☁️';
  if (d.includes('partly cloudy') || d.includes('partial')) return '⛅';
  if (d.includes('cloudy'))                                 return '🌥️';
  if (d.includes('sunny') || d.includes('clear'))           return '☀️';
  return '🌤️';
}

function uvLabel(uv) {
  const n = parseInt(uv, 10);
  if (n <= 2)  return `${uv} 🟢 Low`;
  if (n <= 5)  return `${uv} 🟡 Moderate`;
  if (n <= 7)  return `${uv} 🟠 High`;
  if (n <= 10) return `${uv} 🔴 Very High`;
  return `${uv} 🟣 Extreme`;
}

function windArrow(dir = '') {
  const map = { N:'↑',NNE:'↑↗',NE:'↗',ENE:'↗',E:'→',ESE:'↘',SE:'↘',SSE:'↓↘',S:'↓',SSW:'↓↙',SW:'↙',WSW:'↙',W:'←',WNW:'↖',NW:'↖',NNW:'↑↖' };
  return map[dir] || dir;
}

function fmtDate(dateStr) {
  try { return new Date(dateStr).toLocaleDateString('en-LK', { weekday:'short', day:'2-digit', month:'short' }); }
  catch { return dateStr; }
}

module.exports = {
  commands: ['weather', 'wthr', 'wt', 'forecast'],

  async run({ sock, m }) {
    const rawCity = (m.text || '').trim();

    // ── No city → ask for it ──────────────────────────────
    if (!rawCity) {
      return sendButtons(sock, m.chat, {
        text:
          `🌦️ *AURA WEATHER*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🏙️ Type city name:\n` +
          `  *.weather Colombo*\n` +
          `  *.weather Kandy*\n` +
          `  *.weather Galle*\n\n` +
          `Or tap a city below:\n\n` +
          `${cfg.footer}`,
        footer: cfg.footer,
        buttons: [
          { label: '🏙️ Colombo',      id: '.weather Colombo'      },
          { label: '🏔️ Kandy',        id: '.weather Kandy'        },
          { label: '🌊 Galle',        id: '.weather Galle'        },
          { label: '❄️ Nuwara Eliya', id: '.weather Nuwara Eliya' },
        ],
      });
    }

    const city = resolveCity(rawCity);
    await m.reply(`🔍 Fetching weather for *${city}*...`);

    try {
      const res = await axios.get(
        `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
        { timeout: 15000, headers: { 'User-Agent': 'curl/7.68.0', Accept: 'application/json' } }
      );

      const data = res.data;
      if (!data?.current_condition?.[0]) throw new Error('No data returned');

      const cur     = data.current_condition[0];
      const area    = data.nearest_area[0];
      const cityOut = area.areaName[0]?.value || city;
      const country = area.country[0]?.value || '';
      const flag    = country.toLowerCase().includes('sri lanka') ? '🇱🇰' : '🌍';
      const desc    = cur.weatherDesc[0]?.value || '';
      const emo     = weatherEmoji(desc);

      const tempFilled = Math.round(Math.max(0, Math.min(100, ((parseInt(cur.temp_C, 10) - 10) / 30) * 100)) / 10);
      const tempBar    = '🟥'.repeat(tempFilled) + '⬜'.repeat(10 - tempFilled);

      const forecastLines = (data.weather || []).slice(0, 3).map(day => {
        const fe   = weatherEmoji(day.hourly?.[4]?.weatherDesc?.[0]?.value || '');
        const rain = day.hourly?.[4]?.chanceofrain || '0';
        return `│  ${fe} *${fmtDate(day.date)}*\n│      🌡️ ${day.mintempC}° – ${day.maxtempC}°C   🌧️ ${rain}%`;
      }).join('\n│\n');

      const msg =
        `╔══════════════════════════════╗\n` +
        `║  ${emo} *AURA WEATHER REPORT* ${emo}\n` +
        `║  ${flag} *${cityOut}*, ${country}\n` +
        `╠══════════════════════════════╣\n` +
        `║\n` +
        `║  ${emo} *${desc}*\n` +
        `║  🌡️ *${cur.temp_C}°C*  _(feels like ${cur.FeelsLikeC}°C)_\n` +
        `║\n` +
        `║  ${tempBar}\n` +
        `║  10°C ─────────────────── 40°C\n` +
        `║\n` +
        `╠══════════════════════════════╣\n` +
        `│  💧 Humidity   : ${cur.humidity}%\n` +
        `│  💨 Wind       : ${cur.windspeedKmph} km/h ${windArrow(cur.winddir16Point)} ${cur.winddir16Point}\n` +
        `│  🔵 Pressure   : ${cur.pressure} hPa\n` +
        `│  👁️ Visibility : ${cur.visibility} km\n` +
        `│  ☀️ UV Index   : ${uvLabel(cur.uvIndex)}\n` +
        `│  ☁️ Cloud      : ${cur.cloudcover}%\n` +
        `╠══════════════════════════════╣\n` +
        `║  📅 *3-DAY FORECAST*\n` +
        `╠══════════════════════════════╣\n` +
        `│\n` +
        `${forecastLines}\n` +
        `│\n` +
        `╚══════════════════════════════╝\n` +
        `\n${cfg.footer}`;

      await sendButtons(sock, m.chat, {
        text: msg,
        footer: cfg.footer,
        buttons: [
          { label: `🔄 Refresh`,    id: `.weather ${rawCity}` },
          { label: `🏙️ Other city`, id: `.weather`            },
        ],
      });

    } catch (e) {
      const is404 = e?.response?.status === 404
        || String(e?.response?.data || '').includes('Unknown location')
        || String(e?.response?.data || '').includes('not found');

      await sendButtons(sock, m.chat, {
        text: is404
          ? `❌ *"${city}"* not found.\n\n💡 Try a nearby larger city.\n\n${cfg.footer}`
          : `❌ Failed to get weather.\n\n_${e.message}_\n\n${cfg.footer}`,
        footer: cfg.footer,
        buttons: [
          { label: '🏙️ Colombo',      id: '.weather Colombo'  },
          { label: '🏔️ Kandy',        id: '.weather Kandy'    },
          { label: '🌊 Galle',        id: '.weather Galle'    },
        ],
      });
    }
  },
};
