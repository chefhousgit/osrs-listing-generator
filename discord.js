// Discord webhooks posted by the local app (the 24/7 sales / summary alerts live on the Worker,
// see worker/alerts.js). DISCORD_WEBHOOK_LISTED gets every new offer with the listing card;
// DISCORD_WEBHOOK_ERRORS (#errors; the old name DISCORD_WEBHOOK_ALERTS still works) gets publish
// problems. Never posts login details, keys or buyer info.
// Failures here are logged and swallowed: a Discord hiccup must not break publishing.

const { OSRS } = require('./eldorado');

const COLORS = { listed: 0xe4b04a, alert: 0xd68f3c, live: 0xd9534f };
const errorsHook = () => process.env.DISCORD_WEBHOOK_ERRORS || process.env.DISCORD_WEBHOOK_ALERTS;

async function post(url, payload, image) {
  if (!url) return;
  try {
    let res;
    if (image) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(payload));
      form.append('files[0]', new Blob([image.buffer], { type: image.mimetype || 'image/png' }), 'card.png');
      res = await fetch(url, { method: 'POST', body: form });
    } else {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    if (!res.ok) console.error('Discord webhook failed:', res.status);
  } catch (err) {
    console.error('Discord webhook failed:', err.message);
  }
}

function optionName(attrId, valueId) {
  const attr = OSRS.attributes.find((a) => a.id === attrId);
  const value = attr && attr.values.find((v) => v.id === valueId);
  return value ? value.name : null;
}

const DELIVERY = { Instant: 'Instant', Minute20: '20 min', Hour1: '1 hour', Hour5: '5 hours', Hour12: '12 hours', Day1: '1 day' };

// A new offer was created (and paused) from the app.
function listed(payload, result, mainImage, extraCount) {
  const attrs = payload.attributes || {};
  const total = payload.numeric && payload.numeric['osrs-total-level-numeric'];
  const fields = [
    { name: 'Type', value: optionName('osrs-account-type', attrs['osrs-account-type']) || '?', inline: true },
    { name: 'Total level', value: String(total || optionName('osrs-total-level', attrs['osrs-total-level']) || '?'), inline: true },
    { name: 'Price', value: '$' + Number(payload.price).toFixed(2), inline: true },
    { name: 'Delivery', value: (DELIVERY[payload.deliveryTime] || payload.deliveryTime) + (result.withDelivery ? '' : ' (no login details sent)'), inline: true },
    { name: 'Images', value: `card${extraCount ? ` + ${extraCount} more` : ''}`, inline: true },
    { name: 'State', value: result.paused ? 'Paused: resume it on Eldorado' : '**LIVE (pause failed)**', inline: true },
    { name: 'Offer', value: '`' + result.offerId + '`', inline: false }
  ];
  if (payload.folder) fields.push({ name: 'Folder', value: result.movedTo ? 'Moved to Listed' : payload.folder, inline: false });
  return post(process.env.DISCORD_WEBHOOK_LISTED, {
    embeds: [{
      title: ('🆕 Listed: ' + (payload.title || 'Account')).slice(0, 250),
      color: COLORS.listed,
      fields,
      image: mainImage ? { url: 'attachment://card.png' } : undefined,
      timestamp: new Date().toISOString()
    }]
  }, mainImage);
}

function alert(title, description, urgent) {
  return post(errorsHook(), {
    content: urgent ? '@here' : undefined,
    allowed_mentions: { parse: urgent ? ['everyone'] : [] },
    embeds: [{ title: '⚠️ ' + title, description: String(description).slice(0, 4000), color: urgent ? COLORS.live : COLORS.alert, timestamp: new Date().toISOString() }]
  });
}

// One sample message to each of the app's webhooks (GET /discord/test).
async function sendTests() {
  const sent = [];
  if (process.env.DISCORD_WEBHOOK_LISTED) {
    await post(process.env.DISCORD_WEBHOOK_LISTED, {
      content: 'Test message, ignore.',
      embeds: [{
        title: '🆕 Listed: TEST 1007 Total Level Hardcore Ironman',
        color: COLORS.listed,
        fields: [
          { name: 'Type', value: 'HCIM', inline: true }, { name: 'Total level', value: '1007', inline: true },
          { name: 'Price', value: '$49.99', inline: true }, { name: 'Delivery', value: 'Instant', inline: true },
          { name: 'Images', value: 'card + 1 more', inline: true }, { name: 'State', value: 'Paused: resume it on Eldorado', inline: true },
          { name: 'Offer', value: '`test-offer-0000`' }
        ],
        timestamp: new Date().toISOString()
      }]
    });
    sent.push('listed');
  }
  if (errorsHook()) {
    await post(errorsHook(), {
      content: 'Test message, ignore.',
      embeds: [{ title: '⚠️ Publish failed (test)', description: 'This is where problems from the app show up (publish failures, offers left live, folders not moved).', color: COLORS.alert }]
    });
    sent.push('errors');
  }
  return sent;
}

module.exports = { listed, alert, sendTests };
