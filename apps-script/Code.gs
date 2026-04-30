
/**
 * Google Apps Script backend for Country Club Pool Ordering MVP.
 *
 * Setup:
 * 1. Create a Google Sheet with tabs: MenuItems, Orders, Settings.
 * 2. Paste this file into Extensions > Apps Script.
 * 3. Set constants below.
 * 4. Deploy as Web App:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the Web App URL into Netlify env var VITE_SCRIPT_URL.
 */

const SPREADSHEET_ID = '1LUax2G_gf1AO4wnqCVfZ2yh3tOv780ijlLB7XeMk2R0';
const ADMIN_KEY = 'EastpointeTest2026!';
const STAFF_EMAIL_FALLBACK = 'athenawlynn@gmail.com';
const ADMIN_EDITABLE_SETTINGS = ['OrderingOpen', 'DeliveryAvailable'];

/**
 * Optional SMS texting through Twilio.
 *
 * To enable:
 * 1. In Apps Script, go to Project Settings > Script Properties.
 * 2. Add:
 *    TWILIO_ACCOUNT_SID = your Twilio Account SID
 *    TWILIO_AUTH_TOKEN = your Twilio Auth Token
 *    TWILIO_FROM_NUMBER = your Twilio phone number, e.g. +15615551234
 * 3. In the Settings sheet, set:
 *    SendReadyTexts | TRUE
 *
 * If Twilio is not configured, the app will still work; it simply will not send SMS texts.
 */


function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`Missing sheet tab: ${name}`);
  return sheet;
}

function rowsToObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(h => String(h).trim());
  return values.slice(1)
    .filter(row => row.some(cell => String(cell).trim() !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
}

function normalizeMenuItem(row) {
  return {
    itemId: String(row.ItemID || '').trim(),
    category: String(row.Category || '').trim(),
    itemName: String(row.ItemName || '').trim(),
    description: String(row.Description || '').trim(),
    price: Number(row.Price || 0),
    available: String(row.Available).toUpperCase() === 'TRUE' || row.Available === true,
    alcoholic: String(row.Alcoholic).toUpperCase() === 'TRUE' || row.Alcoholic === true,
    sortOrder: Number(row.SortOrder || 9999)
  };
}

function getSettingsObject() {
  const sheet = getSheet('Settings');
  const rows = rowsToObjects(sheet);
  const settings = {};
  rows.forEach(r => {
    if (r.SettingKey) settings[String(r.SettingKey).trim()] = String(r.SettingValue ?? '').trim();
  });
  return settings;
}

function isDeliveryAvailable() {
  const settings = getSettingsObject();
  return String(settings.DeliveryAvailable || 'TRUE').toUpperCase() !== 'FALSE';
}

function isOrderingOpen() {
  const settings = getSettingsObject();
  return String(settings.OrderingOpen || 'TRUE').toUpperCase() !== 'FALSE';
}

function updateSetting(key, value) {
  const normalizedKey = String(key || '').trim();
  if (!ADMIN_EDITABLE_SETTINGS.includes(normalizedKey)) {
    throw new Error('Setting cannot be updated from the staff dashboard.');
  }

  const normalizedValue = String(value || '').trim();
  const sheet = getSheet('Settings');
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const keyCol = headers.indexOf('SettingKey') + 1;
  const valueCol = headers.indexOf('SettingValue') + 1;
  if (keyCol < 1 || valueCol < 1) {
    throw new Error('Settings sheet is missing required columns.');
  }

  for (let r = 2; r <= values.length; r++) {
    if (String(sheet.getRange(r, keyCol).getValue()).trim() === normalizedKey) {
      sheet.getRange(r, valueCol).setValue(normalizedValue);
      return;
    }
  }

  sheet.appendRow([normalizedKey, normalizedValue]);
}

function getMenu() {
  const sheet = getSheet('MenuItems');
  const items = rowsToObjects(sheet)
    .map(normalizeMenuItem)
    .filter(i => i.itemId && i.itemName)
    .sort((a, b) => {
      if (a.category === b.category) return a.sortOrder - b.sortOrder;
      return a.category.localeCompare(b.category);
    });
  return items;
}


function getMembers() {
  const sheet = getSheet('Members');
  return rowsToObjects(sheet).map(row => ({
    memberNumber: String(row.MemberNumber || '').trim(),
    status: String(row.Status || '').trim() || 'Active'
  }));
}

function validateMemberNumber(memberNumber) {
  const normalized = String(memberNumber || '').trim();
  if (!/^\d{4,6}$/.test(normalized)) {
    throw new Error('Member number must be 4–6 digits.');
  }

  const member = getMembers().find(m => m.memberNumber === normalized);
  if (!member) {
    throw new Error('Member number not found. Please check your member number or contact the Pool Bar.');
  }

  if (String(member.status || '').toLowerCase() !== 'active') {
    throw new Error('Member account is not active. Please contact the Pool Bar.');
  }

  return true;
}


function makeOrderId() {
  const props = PropertiesService.getScriptProperties();
  const current = Number(props.getProperty('LAST_ORDER_ID') || '1000') + 1;
  props.setProperty('LAST_ORDER_ID', String(current));
  return String(current);
}

function itemSummary(items) {
  if (!items || !items.length) return '';
  return items.map(i => {
    const price = Number(i.price || 0) * Number(i.quantity || 0);
    return `${i.itemName} x${i.quantity} — $${price.toFixed(2)}`;
  }).join('\n');
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'menu') {
      return jsonResponse({ ok: true, items: getMenu() });
    }

    if (action === 'settings') {
      return jsonResponse({ ok: true, settings: getSettingsObject() });
    }

    if (action === 'orders') {
      if (e.parameter.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      return jsonResponse({ ok: true, orders: getOrders() });
    }

    if (action === 'orderStatus') {
      return jsonResponse({ ok: true, ...getOrderStatus(e.parameter.orderId, e.parameter.memberNumber) });
    }

    return jsonResponse({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;

    if (action === 'createOrder') {
      const result = createOrder(body.order);
      return jsonResponse({ ok: true, orderId: result.orderId });
    }

    if (action === 'updateStatus') {
      if (body.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      updateOrderStatus(body.orderId, body.status);
      return jsonResponse({ ok: true });
    }

    if (action === 'updateSetting') {
      if (body.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      updateSetting(body.key, body.value);
      return jsonResponse({ ok: true, settings: getSettingsObject() });
    }

    return jsonResponse({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function createOrder(order) {
  if (!order) throw new Error('Missing order.');
  if (!isOrderingOpen()) {
    throw new Error('Pool ordering is currently closed. Please order directly at the Pool Bar.');
  }
  validateMemberNumber(order.memberNumber);
  if (!String(order.memberName || '').trim()) throw new Error('Member name is required.');
  if (!String(order.phone || '').trim()) throw new Error('Mobile number is required.');
  if (!order.authorizationAccepted) throw new Error('Charge authorization is required.');
  if (order.alcoholIncluded && !order.alcoholVerificationAccepted) {
    throw new Error('Alcohol verification acknowledgement is required.');
  }

  const fulfillmentType = order.fulfillmentType === 'Delivery' ? 'Delivery' : 'Pickup';
  if (fulfillmentType === 'Delivery' && !isDeliveryAvailable()) {
    throw new Error('Delivery is currently unavailable. Please choose pickup at the Pool Bar.');
  }
  const tableNumberRaw = String(order.tableNumber || '').trim();
  const tableNumber = tableNumberRaw ? Number(tableNumberRaw) : '';
  if (fulfillmentType === 'Delivery' && (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 100)) {
    throw new Error('Delivery table number must be between 1 and 100.');
  }
  if (tableNumberRaw && (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 100)) {
    throw new Error('Table number must be between 1 and 100.');
  }

  const items = Array.isArray(order.items) ? order.items.filter(item =>
    item &&
    String(item.itemName || '').trim() &&
    Number(item.quantity || 0) > 0
  ) : [];
  if (!items.length && !String(order.barRequest || '').trim()) {
    throw new Error('Please select at least one item or enter a bar/cocktail request.');
  }
  const summary = itemSummary(items);
  let orderId;
  let timestamp;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    orderId = makeOrderId();
    timestamp = new Date();
    const sheet = getSheet('Orders');
    sheet.appendRow([
      timestamp,
      orderId,
      'New',
      fulfillmentType,
      String(order.memberName || '').trim(),
      String(order.memberNumber || '').trim(),
      String(order.phone || '').trim(),
      tableNumber,
      summary,
      JSON.stringify(items),
      String(order.barRequest || '').trim(),
      Number(order.subtotalKnownItems || 0),
      Boolean(order.hasCustomBarRequest),
      Boolean(order.alcoholIncluded),
      Boolean(order.authorizationAccepted),
      Boolean(order.alcoholVerificationAccepted),
      '',
      timestamp,
      ''
    ]);
  } finally {
    lock.releaseLock();
  }

  try {
    sendOrderEmail({
      ...order,
      orderId,
      timestamp,
      items,
      itemsSummary: summary
    });
  } catch (err) {
    console.warn('Order email failed for #' + orderId + ': ' + err.message);
  }

  return { orderId };
}

function getOrders() {
  const sheet = getSheet('Orders');
  const rows = rowsToObjects(sheet);
  return rows.map(row => {
    let items = [];
    try { items = JSON.parse(row.ItemsJSON || '[]'); } catch (e) {}
    return {
      timestamp: row.Timestamp ? new Date(row.Timestamp).toLocaleString() : '',
      orderId: String(row.OrderID || ''),
      status: String(row.Status || 'New'),
      fulfillmentType: String(row.FulfillmentType || 'Pickup'),
      memberName: String(row.MemberName || ''),
      memberNumber: String(row.MemberNumber || ''),
      phone: String(row.Phone || ''),
      tableNumber: String(row.TableNumber || ''),
      itemsSummary: String(row.ItemsSummary || ''),
      items,
      barRequest: String(row.BarRequest || ''),
      subtotalKnownItems: Number(row.SubtotalKnownItems || 0),
      hasCustomBarRequest: String(row.HasCustomBarRequest).toUpperCase() === 'TRUE' || row.HasCustomBarRequest === true,
      alcoholIncluded: String(row.AlcoholIncluded).toUpperCase() === 'TRUE' || row.AlcoholIncluded === true,
      staffNotes: String(row.StaffNotes || ''),
      updatedAt: row.UpdatedAt ? new Date(row.UpdatedAt).toLocaleString() : '',
      completedAt: row.CompletedAt ? new Date(row.CompletedAt).toLocaleString() : ''
    };
  }).reverse();
}


function getOrderStatus(orderId, memberNumber) {
  validateMemberNumber(memberNumber);
  const sheet = getSheet('Orders');
  const rows = rowsToObjects(sheet);
  const order = rows.find(row =>
    String(row.OrderID || '') === String(orderId || '') &&
    String(row.MemberNumber || '') === String(memberNumber || '')
  );
  if (!order) throw new Error('Order not found.');
  return {
    status: String(order.Status || 'New'),
    updatedAt: order.UpdatedAt ? new Date(order.UpdatedAt).toLocaleString() : '',
    completedAt: order.CompletedAt ? new Date(order.CompletedAt).toLocaleString() : ''
  };
}


function updateOrderStatus(orderId, status) {
  const allowed = ['New', 'Accepted', 'Preparing', 'Ready for Pickup', 'Completed', 'Cancelled'];
  if (!allowed.includes(status)) throw new Error('Invalid status.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet('Orders');
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const idCol = headers.indexOf('OrderID') + 1;
    const statusCol = headers.indexOf('Status') + 1;
    const phoneCol = headers.indexOf('Phone') + 1;
    const memberNameCol = headers.indexOf('MemberName') + 1;
    const tableCol = headers.indexOf('TableNumber') + 1;
    const updatedCol = headers.indexOf('UpdatedAt') + 1;
    const completedCol = headers.indexOf('CompletedAt') + 1;
    const readyTextSentCol = headers.indexOf('ReadyTextSentAt') + 1;
    if (idCol < 1 || statusCol < 1 || updatedCol < 1) {
      throw new Error('Orders sheet is missing a required column.');
    }

    for (let r = 2; r <= values.length; r++) {
      if (String(sheet.getRange(r, idCol).getValue()) === String(orderId)) {
        sheet.getRange(r, statusCol).setValue(status);
        sheet.getRange(r, updatedCol).setValue(new Date());

        if (status === 'Completed' && completedCol > 0) {
          sheet.getRange(r, completedCol).setValue(new Date());
        }

        if (status === 'Ready for Pickup') {
          const alreadySent = readyTextSentCol > 0 ? String(sheet.getRange(r, readyTextSentCol).getValue() || '').trim() : '';
          if (!alreadySent) {
            const phone = phoneCol > 0 ? sheet.getRange(r, phoneCol).getValue() : '';
            const memberName = memberNameCol > 0 ? sheet.getRange(r, memberNameCol).getValue() : '';
            const tableNumber = tableCol > 0 ? sheet.getRange(r, tableCol).getValue() : '';
            const sent = sendReadyPickupText({
              orderId,
              phone,
              memberName,
              tableNumber
            });
            if (sent && readyTextSentCol > 0) {
              sheet.getRange(r, readyTextSentCol).setValue(new Date());
            }
          }
        }
        return;
      }
    }
  } finally {
    lock.releaseLock();
  }
  throw new Error('Order not found.');
}


function sendReadyPickupText(order) {
  const settings = getSettingsObject();
  if (String(settings.SendReadyTexts || '').toUpperCase() !== 'TRUE') {
    return false;
  }

  const props = PropertiesService.getScriptProperties();
  const accountSid = props.getProperty('TWILIO_ACCOUNT_SID');
  const authToken = props.getProperty('TWILIO_AUTH_TOKEN');
  const fromNumber = props.getProperty('TWILIO_FROM_NUMBER');

  if (!accountSid || !authToken || !fromNumber) {
    console.warn('Twilio not configured. Ready text not sent.');
    return false;
  }

  const toNumber = normalizePhoneNumber(order.phone);
  if (!toNumber) {
    console.warn('Invalid phone number. Ready text not sent.');
    return false;
  }

  const pickupLocation = settings.PickupLocation || 'Pool Bar';
  const clubName = settings.ClubName || 'The Club';
  const messageTemplate = settings.ReadyTextMessage ||
    `${clubName}: Your pool order #{{ORDER_ID}} is ready for pickup at ${pickupLocation}. Please provide your name/member number at pickup.`;

  const message = messageTemplate
    .replace('{{ORDER_ID}}', order.orderId)
    .replace('{{MEMBER_NAME}}', order.memberName || '')
    .replace('{{TABLE_NUMBER}}', order.tableNumber || '')
    .replace('{{PICKUP_LOCATION}}', pickupLocation);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const payload = {
    To: toNumber,
    From: fromNumber,
    Body: message
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    payload,
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(accountSid + ':' + authToken)
    },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code >= 200 && code < 300) {
    return true;
  }

  console.warn('Twilio SMS failed: ' + response.getContentText());
  return false;
}

function normalizePhoneNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (String(phone || '').trim().startsWith('+')) return String(phone).trim();
  return '';
}


function sendOrderEmail(order) {
  const settings = getSettingsObject();
  const staffEmail = settings.StaffEmail || STAFF_EMAIL_FALLBACK;
  const subject = `New Pool Order #${order.orderId} — Table ${order.tableNumber}`;
  const body = [
    `New Pool Order #${order.orderId}`,
    ``,
    `Service: ${order.fulfillmentType || 'Pickup'}`,
    `Table: ${order.tableNumber || '—'}`,
    `Member: ${order.memberName}`,
    `Member #: ${order.memberNumber}`,
    `Phone: ${order.phone}`,
    ``,
    `Items:`,
    order.itemsSummary || 'No standard menu items.',
    order.barRequest ? `\nBar / Cocktail Request:\n${order.barRequest}` : '',
    ``,
    `Known subtotal: $${Number(order.subtotalKnownItems || 0).toFixed(2)}`,
    order.hasCustomBarRequest ? `Custom bar request pricing to be entered in club POS.` : '',
    `Alcohol included: ${order.alcoholIncluded ? 'YES' : 'No'}`,
    ``,
    `Please verify member/ID at pickup when alcohol is included.`
  ].join('\n');

  MailApp.sendEmail(staffEmail, subject, body);
}
