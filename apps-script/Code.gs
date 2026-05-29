
/**
 * Google Apps Script backend for Country Club Pool Ordering MVP.
 *
 * Setup:
 * 1. Create a Google Sheet with tabs: MenuItems, Orders, TruckMenuItems, TruckOrders, Settings.
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
const ADMIN_EDITABLE_SETTINGS = ['OrderingOpen', 'DeliveryAvailable', 'TruckOrderingOpen', 'MemberTipsEnabled', 'TruckMemberTipsEnabled', 'OrderingScheduleEnabled', 'OrderingOpenTime', 'OrderingCloseTime', 'TruckOrderingScheduleEnabled', 'TruckOrderingOpenTime', 'TruckOrderingCloseTime'];
const STATION_STATUSES = ['Not Needed', 'New', 'Preparing', 'Ready', 'Completed'];
const STATION_COLUMNS = ['RouteStations', 'BarStatus', 'KitchenStatus', 'RunnerStatus', 'BarUpdatedAt', 'KitchenUpdatedAt', 'RunnerUpdatedAt', 'POSPosted', 'POSPostedAt', 'POSPostedBy'];
const PAYMENT_COLUMNS = ['PaymentType', 'PaymentStatus', 'GuestCardType', 'TipLabel', 'TipAmount', 'EstimatedTotal'];
const TRUCK_FEE_COLUMNS = ['CustomerType', 'ServiceFeeLabel', 'ServiceFeeRate', 'ServiceFeeAmount', 'ServiceFeeVisible', 'CreditCardFeeLabel', 'CreditCardFeeRate', 'CreditCardFeeAmount', 'CreditCardFeeVisible', 'FinalTotal'];
const TRUCK_ORDER_COLUMNS = ['Timestamp', 'OrderID', 'Status', 'MemberName', 'MemberNumber', 'Phone', 'ItemsSummary', 'ItemsJSON', 'SubtotalKnownItems', 'AuthorizationAccepted', 'AlcoholIncluded', 'AlcoholVerificationAccepted', 'StaffNotes', 'UpdatedAt', 'CompletedAt', 'POSPosted', 'POSPostedAt', 'POSPostedBy', 'PaymentType', 'PaymentStatus', 'GuestCardType', 'TipLabel', 'TipAmount', 'EstimatedTotal'].concat(TRUCK_FEE_COLUMNS);

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
    sortOrder: Number(row.SortOrder || 9999),
    modifierGroups: parseModifierGroups(row.ModifierGroups)
  };
}

function parseModifierGroups(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const groups = JSON.parse(raw);
    if (!Array.isArray(groups)) return [];
    return groups.map(group => ({
      name: String(group.name || '').trim(),
      type: group.type === 'multi' ? 'multi' : 'single',
      required: group.required === true || String(group.required).toUpperCase() === 'TRUE',
      options: Array.isArray(group.options)
        ? group.options.map(option => {
          if (typeof option === 'string') return { name: option, priceDelta: 0 };
          return {
            name: String(option.name || '').trim(),
            priceDelta: Number(option.priceDelta || 0)
          };
        }).filter(option => option.name)
        : []
    })).filter(group => group.name && group.options.length);
  } catch (err) {
    return [];
  }
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

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function settingEnabled(settings, key, fallback) {
  const value = settings[key];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toUpperCase() !== 'FALSE';
}

function numericSetting(settings, key, fallback) {
  const value = settings[key];
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percentSetting(settings, key, fallback) {
  const value = numericSetting(settings, key, fallback);
  return value > 1 ? value / 100 : value;
}

function normalizeCustomerType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'guest') return 'Guest';
  if (raw === 'rsm') return 'RSM';
  if (['approved non-member', 'approved non member', 'non-member', 'non member', 'nonmember'].includes(raw)) {
    return 'RSM';
  }
  return 'Golf Member';
}

function customerTypeForPayment(paymentType, memberCustomerType) {
  if (paymentType === 'Guest Pay at Pickup') return 'Guest';
  const normalizedMemberType = normalizeCustomerType(memberCustomerType);
  if (normalizedMemberType === 'RSM') return 'RSM';
  return 'Golf Member';
}

function truckFeeSettingsPrefix(paymentType, customerType) {
  if (paymentType === 'Guest Pay at Pickup' || customerType === 'Guest') return 'TruckGuest';
  if (customerType === 'RSM') return 'TruckNonMember';
  return 'TruckMember';
}

function calculateTruckFees(subtotal, tipAmount, paymentType, settings, memberCustomerType) {
  const customerType = customerTypeForPayment(paymentType, memberCustomerType);
  const prefix = truckFeeSettingsPrefix(paymentType, customerType);
  const serviceFeeRate = percentSetting(settings, 'TruckServiceFeeRate', 0.22);
  const creditCardFeeRate = percentSetting(settings, 'TruckCreditCardFeeRate', 0.03);
  const serviceFeeEnabled = settingEnabled(settings, `${prefix}ServiceFeeEnabled`, true);
  const serviceFeeVisible = settingEnabled(settings, `${prefix}ServiceFeeVisible`, customerType !== 'Golf Member');
  const creditCardFeeEnabled = settingEnabled(settings, `${prefix}CreditCardFeeEnabled`, paymentType === 'Guest Pay at Pickup');
  const creditCardFeeVisible = settingEnabled(settings, `${prefix}CreditCardFeeVisible`, creditCardFeeEnabled);
  const serviceFeeAmount = serviceFeeEnabled ? roundMoney(Number(subtotal || 0) * serviceFeeRate) : 0;
  const creditCardBase = String(settings.TruckCreditCardFeeBase || 'SubtotalPlusServiceFee') === 'SubtotalOnly'
    ? Number(subtotal || 0)
    : Number(subtotal || 0) + serviceFeeAmount;
  const creditCardFeeAmount = creditCardFeeEnabled ? roundMoney(creditCardBase * creditCardFeeRate) : 0;
  const safeTip = roundMoney(tipAmount);
  const finalTotal = roundMoney(Number(subtotal || 0) + serviceFeeAmount + creditCardFeeAmount + safeTip);
  return {
    customerType,
    serviceFeeLabel: `Service Fee (${Math.round(serviceFeeRate * 100)}%)`,
    serviceFeeRate,
    serviceFeeAmount,
    serviceFeeVisible,
    creditCardFeeLabel: `Credit Card Transaction Fee (${Math.round(creditCardFeeRate * 100)}%)`,
    creditCardFeeRate,
    creditCardFeeAmount,
    creditCardFeeVisible,
    estimatedTotal: finalTotal,
    finalTotal
  };
}

function isDeliveryAvailable() {
  const settings = getSettingsObject();
  return String(settings.DeliveryAvailable || 'TRUE').toUpperCase() !== 'FALSE';
}

function isOrderingOpen() {
  const settings = getSettingsObject();
  if (hasExplicitSetting(settings, 'OrderingOpen')) {
    return String(settings.OrderingOpen).toUpperCase() !== 'FALSE';
  }
  const scheduled = scheduleOpenNow(settings, '');
  if (scheduled !== null) return scheduled;
  return String(settings.OrderingOpen || 'TRUE').toUpperCase() !== 'FALSE';
}

function isTruckOrderingOpen() {
  const settings = getSettingsObject();
  if (hasExplicitSetting(settings, 'TruckOrderingOpen')) {
    return String(settings.TruckOrderingOpen).toUpperCase() !== 'FALSE';
  }
  const scheduled = scheduleOpenNow(settings, 'Truck');
  if (scheduled !== null) return scheduled;
  return String(settings.TruckOrderingOpen || 'TRUE').toUpperCase() !== 'FALSE';
}

function hasExplicitSetting(settings, key) {
  return settings[key] !== undefined && settings[key] !== null && String(settings[key]).trim() !== '';
}

function normalizeTimeSetting(value, fallback) {
  const raw = String(value || fallback || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  return match[1].padStart(2, '0') + ':' + match[2];
}

function scheduleOpenNow(settings, prefix) {
  const enabledKey = prefix ? prefix + 'OrderingScheduleEnabled' : 'OrderingScheduleEnabled';
  if (String(settings[enabledKey] || 'FALSE').toUpperCase() !== 'TRUE') return null;
  const openKey = prefix ? prefix + 'OrderingOpenTime' : 'OrderingOpenTime';
  const closeKey = prefix ? prefix + 'OrderingCloseTime' : 'OrderingCloseTime';
  const open = normalizeTimeSetting(settings[openKey], '08:30');
  const close = normalizeTimeSetting(settings[closeKey], '16:30');
  const now = Utilities.formatDate(new Date(), 'America/New_York', 'HH:mm');
  return now >= open && now < close;
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

function updateMenuAvailability(itemId, available) {
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId) throw new Error('Missing menu item.');

  const sheet = getSheet('MenuItems');
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const itemIdCol = headers.indexOf('ItemID') + 1;
  const availableCol = headers.indexOf('Available') + 1;
  if (itemIdCol < 1 || availableCol < 1) {
    throw new Error('MenuItems sheet is missing required columns.');
  }

  for (let r = 2; r <= values.length; r++) {
    if (String(sheet.getRange(r, itemIdCol).getValue()).trim() === normalizedItemId) {
      sheet.getRange(r, availableCol).setValue(Boolean(available));
      return;
    }
  }

  throw new Error('Menu item not found.');
}

function updateTruckMenuAvailability(itemId, available) {
  updateMenuAvailabilityForSheet('TruckMenuItems', itemId, available);
}

function updateMenuAvailabilityForSheet(sheetName, itemId, available) {
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId) throw new Error('Missing menu item.');

  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const itemIdCol = headers.indexOf('ItemID') + 1;
  const availableCol = headers.indexOf('Available') + 1;
  if (itemIdCol < 1 || availableCol < 1) {
    throw new Error(sheetName + ' sheet is missing required columns.');
  }

  for (let r = 2; r <= values.length; r++) {
    if (String(sheet.getRange(r, itemIdCol).getValue()).trim() === normalizedItemId) {
      sheet.getRange(r, availableCol).setValue(Boolean(available));
      return;
    }
  }

  throw new Error('Menu item not found.');
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

function getTruckMenu() {
  const sheet = getSheet('TruckMenuItems');
  const items = rowsToObjects(sheet)
    .map(normalizeMenuItem)
    .filter(i => i.itemId && i.itemName)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return items;
}


function getMembers() {
  const sheet = getSheet('Members');
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values[0].map(h => String(h).trim());
  const memberCol = headers.indexOf('MemberNumber');
  const statusCol = headers.indexOf('Status');
  const customerTypeCol = headers.indexOf('CustomerType');

  if (memberCol >= 0) {
    return values.slice(1)
      .filter(row => String(row[memberCol] || '').trim())
      .map(row => ({
        memberNumber: String(row[memberCol] || '').trim(),
        status: statusCol >= 0 ? String(row[statusCol] || '').trim() || 'Active' : 'Active',
        customerType: normalizeCustomerType(customerTypeCol >= 0 ? row[customerTypeCol] : '')
      }));
  }

  return values
    .filter(row => String(row[0] || '').trim())
    .map(row => ({
      memberNumber: String(row[0] || '').trim(),
      status: String(row[1] || '').trim() || 'Active',
      customerType: normalizeCustomerType(row[2] || '')
    }));
}

function memberLookupValue(memberNumber) {
  const digits = String(memberNumber || '').replace(/\D/g, '');
  return digits.replace(/^0+/, '') || '0';
}

function memberNumbersMatch(a, b) {
  return memberLookupValue(a) === memberLookupValue(b);
}

function phoneLookupValue(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function phoneNumbersMatch(a, b) {
  const left = phoneLookupValue(a);
  const right = phoneLookupValue(b);
  return Boolean(left && right && left === right);
}

function validateMemberNumber(memberNumber, serviceName) {
  const contactName = serviceName || 'Pool Bar';
  const normalized = String(memberNumber || '').trim();
  if (!/^\d{4,6}$/.test(normalized)) {
    throw new Error('Member number must be 4–6 digits.');
  }

  const member = getMembers().find(m => memberNumbersMatch(m.memberNumber, normalized));
  if (!member) {
    throw new Error(`Member number not found. Please check your member number or contact ${contactName}.`);
  }

  if (String(member.status || '').toLowerCase() !== 'active') {
    throw new Error(`Member account is not active. Please contact ${contactName}.`);
  }

  return member;
}

function getMemberProfile(memberNumber) {
  const member = validateMemberNumber(memberNumber, 'The Turn Truck');
  return {
    memberNumber: String(member.memberNumber || ''),
    status: String(member.status || 'Active'),
    customerType: normalizeCustomerType(member.customerType)
  };
}


function makeOrderId() {
  const props = PropertiesService.getScriptProperties();
  const current = Number(props.getProperty('LAST_ORDER_ID') || '1000') + 1;
  props.setProperty('LAST_ORDER_ID', String(current));
  return String(current);
}

function makeTruckOrderId() {
  const props = PropertiesService.getScriptProperties();
  const current = Number(props.getProperty('LAST_TRUCK_ORDER_ID') || '5000') + 1;
  props.setProperty('LAST_TRUCK_ORDER_ID', String(current));
  return String(current);
}

function itemSummary(items) {
  if (!items || !items.length) return '';
  return items.map(i => {
    const unitPrice = Number(i.price || 0) + modifierUnitTotal(i);
    const price = unitPrice * Number(i.quantity || 0);
    const modifiers = modifierSummaryLines(i).map(line => `  - ${line}`).join('\n');
    const itemNote = String(i.itemNote || '').trim();
    const note = itemNote ? `\n  - Note: ${itemNote}` : '';
    return `${i.itemName} x${i.quantity} — $${price.toFixed(2)}${modifiers ? '\n' + modifiers : ''}${note}`;
  }).join('\n');
}

function modifierSummaryLines(item) {
  const groups = Array.isArray(item.selectedModifiers) ? item.selectedModifiers : [];
  return groups.flatMap(group =>
    (Array.isArray(group.selections) ? group.selections : []).map(option => {
      const price = Number(option.priceDelta || 0);
      return `${group.group}: ${option.name}${price ? ` +$${price.toFixed(2)}` : ''}`;
    })
  );
}

function modifierUnitTotal(item) {
  const groups = Array.isArray(item.selectedModifiers) ? item.selectedModifiers : [];
  return groups.reduce((sum, group) =>
    sum + (Array.isArray(group.selections) ? group.selections : []).reduce((groupSum, option) =>
      groupSum + Number(option.priceDelta || 0), 0), 0);
}

function isBarItem(item) {
  const category = String(item.category || '').toLowerCase();
  return Boolean(item.alcoholic) ||
    category.includes('beer') ||
    category.includes('wine') ||
    category.includes('cocktail') ||
    category.includes('seltzer') ||
    category.includes('non-alcoholic') ||
    category.includes('drink');
}

function routeOrder(order, items) {
  const requiresBar = Boolean(order.alcoholIncluded) ||
    String(order.barRequest || '').trim().length > 0 ||
    items.some(isBarItem);
  const requiresKitchen = items.some(item => !isBarItem(item));
  const requiresRunner = order.fulfillmentType === 'Delivery' || (requiresBar && requiresKitchen);
  const routes = [];
  if (requiresBar) routes.push('Bar');
  if (requiresKitchen) routes.push('Kitchen');
  if (requiresRunner) routes.push('Wait Station');
  return {
    routes,
    barStatus: requiresBar ? 'New' : 'Not Needed',
    kitchenStatus: requiresKitchen ? 'New' : 'Not Needed',
    runnerStatus: requiresRunner ? 'New' : 'Not Needed'
  };
}

function ensureOrderColumns(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim());
  STATION_COLUMNS.concat(PAYMENT_COLUMNS).forEach(column => {
    if (!headers.includes(column)) {
      sheet.getRange(1, headers.length + 1).setValue(column);
      headers.push(column);
    }
  });
  return headers;
}

function ensureTruckOrderColumns(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values.length ? values[0].map(h => String(h).trim()) : [];
  TRUCK_ORDER_COLUMNS.forEach(column => {
    if (!headers.includes(column)) {
      sheet.getRange(1, headers.length + 1).setValue(column);
      headers.push(column);
    }
  });
  return headers;
}

function normalizeStationStatus(value, needed) {
  const status = String(value || '').trim();
  if (status) return status;
  return needed ? 'New' : 'Not Needed';
}

function deriveOverallStatus(row) {
  const existingStatus = String(row.Status || 'New');
  if (existingStatus === 'Cancelled') return 'Cancelled';
  if (existingStatus === 'Completed') return 'Completed';
  const bar = normalizeStationStatus(row.BarStatus, String(row.RouteStations || '').includes('Bar'));
  const kitchen = normalizeStationStatus(row.KitchenStatus, String(row.RouteStations || '').includes('Kitchen'));
  const runner = normalizeStationStatus(row.RunnerStatus, String(row.RouteStations || '').includes('Wait Station'));
  const active = [bar, kitchen, runner].filter(status => status !== 'Not Needed');
  if (!active.length) return existingStatus;
  if (active.every(status => status === 'Completed')) return 'Completed';

  const prepStatuses = [bar, kitchen].filter(status => status !== 'Not Needed');
  if (prepStatuses.length && prepStatuses.every(status => ['Ready', 'Completed'].includes(status))) {
    return 'Ready for Pickup';
  }

  if (active.some(status => ['Preparing', 'Ready', 'Completed'].includes(status))) return 'Preparing';
  return existingStatus;
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'menu') {
      return jsonResponse({ ok: true, items: getMenu() });
    }

    if (action === 'truckMenu') {
      return jsonResponse({ ok: true, items: getTruckMenu() });
    }

    if (action === 'settings') {
      return jsonResponse({ ok: true, settings: getSettingsObject() });
    }

    if (action === 'memberProfile') {
      return jsonResponse({ ok: true, ...getMemberProfile(e.parameter.memberNumber) });
    }

    if (action === 'orders') {
      if (e.parameter.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      return jsonResponse({ ok: true, orders: getOrders() });
    }

    if (action === 'truckOrders') {
      if (e.parameter.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      return jsonResponse({ ok: true, orders: getTruckOrders() });
    }

    if (action === 'orderStatus') {
      return jsonResponse({ ok: true, ...getOrderStatus(e.parameter.orderId, e.parameter.memberNumber) });
    }

    if (action === 'latestOrderStatus') {
      return jsonResponse({ ok: true, ...getLatestOrderStatus(e.parameter.memberNumber) });
    }

    if (action === 'truckOrderStatus') {
      return jsonResponse({ ok: true, ...getTruckOrderStatus(e.parameter.orderId, e.parameter.memberNumber, e.parameter.phone) });
    }

    if (action === 'latestTruckOrderStatus') {
      return jsonResponse({ ok: true, ...getLatestTruckOrderStatus(e.parameter.memberNumber) });
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

    if (action === 'createTruckOrder') {
      const result = createTruckOrder(body.order);
      return jsonResponse({ ok: true, orderId: result.orderId });
    }

    if (action === 'updateStatus') {
      if (body.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      updateOrderStatus(body.orderId, body.status);
      return jsonResponse({ ok: true });
    }

    if (action === 'updateTruckStatus') {
      if (body.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      updateTruckOrderStatus(body.orderId, body.status);
      return jsonResponse({ ok: true });
    }

    if (action === 'updateStationStatus') {
      if (body.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      updateStationStatus(body.orderId, body.station, body.status);
      return jsonResponse({ ok: true });
    }

    if (action === 'updatePosPosted') {
      if (body.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      updatePosPosted(body.orderId, body.posted, body.postedBy);
      return jsonResponse({ ok: true });
    }

    if (action === 'updateTruckPosPosted') {
      if (body.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      updateTruckPosPosted(body.orderId, body.posted, body.postedBy);
      return jsonResponse({ ok: true });
    }

    if (action === 'updateSetting') {
      if (body.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      updateSetting(body.key, body.value);
      return jsonResponse({ ok: true, settings: getSettingsObject() });
    }

    if (action === 'updateMenuAvailability') {
      if (body.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      updateMenuAvailability(body.itemId, body.available);
      return jsonResponse({ ok: true, items: getMenu() });
    }

    if (action === 'updateTruckMenuAvailability') {
      if (body.adminKey !== ADMIN_KEY) throw new Error('Unauthorized.');
      updateTruckMenuAvailability(body.itemId, body.available);
      return jsonResponse({ ok: true, items: getTruckMenu() });
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
  const paymentType = order.paymentType === 'Guest Pay at Pickup' ? 'Guest Pay at Pickup' : 'Member Account';
  const paymentStatus = paymentType === 'Guest Pay at Pickup' ? 'Due at Pickup' : 'Member Account';
  const settings = getSettingsObject();
  const tipsEnabled = paymentType === 'Guest Pay at Pickup' || String(settings.MemberTipsEnabled || 'TRUE').toUpperCase() !== 'FALSE';
  const guestCardType = paymentType === 'Guest Pay at Pickup' ? String(order.guestCardType || '').trim() : '';
  const tipAmount = tipsEnabled ? Math.max(0, Number(order.tipAmount || 0)) : 0;
  const tipLabel = tipsEnabled ? String(order.tipLabel || 'No tip').trim() : '';
  if (paymentType !== 'Guest Pay at Pickup') validateMemberNumber(order.memberNumber);
  if (!String(order.memberName || '').trim()) throw new Error(paymentType === 'Guest Pay at Pickup' ? 'Guest name is required.' : 'Member name is required.');
  if (!String(order.phone || '').trim()) throw new Error('Mobile number is required.');
  if (!order.authorizationAccepted) throw new Error(paymentType === 'Guest Pay at Pickup' ? 'Guest payment acknowledgement is required.' : 'Charge authorization is required.');
  if (paymentType === 'Guest Pay at Pickup' && !guestCardType) throw new Error('Guest card type is required.');
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
  const routing = routeOrder({ ...order, fulfillmentType }, items);
  let orderId;
  let timestamp;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    orderId = makeOrderId();
    timestamp = new Date();
    const sheet = getSheet('Orders');
    ensureOrderColumns(sheet);
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
      '',
      '',
      routing.routes.join(', '),
      routing.barStatus,
      routing.kitchenStatus,
      routing.runnerStatus,
      '',
      '',
      '',
      false,
      '',
      '',
      paymentType,
      paymentStatus,
      guestCardType,
      tipLabel,
      tipAmount,
      estimatedTotal
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

function validateTruckItems(items) {
  const menu = getTruckMenu();
  const byId = {};
  menu.forEach(item => byId[item.itemId] = item);
  return items.map(item => {
    const menuItem = byId[String(item.itemId || '').trim()];
    if (!menuItem) throw new Error('A selected food truck item is no longer available.');
    if (!menuItem.available) throw new Error(menuItem.itemName + ' is currently sold out.');
    return {
      itemId: menuItem.itemId,
      category: menuItem.category,
      itemName: menuItem.itemName,
      price: menuItem.price,
      quantity: Number(item.quantity || 0),
      alcoholic: Boolean(menuItem.alcoholic),
      selectedModifiers: validateSelectedModifiers(menuItem, item.selectedModifiers),
      itemNote: String(item.itemNote || '').trim()
    };
  }).filter(item => item.quantity > 0);
}

function validateSelectedModifiers(menuItem, selectedModifiers) {
  const selected = Array.isArray(selectedModifiers) ? selectedModifiers : [];
  const selectedByGroup = {};
  selected.forEach(group => {
    selectedByGroup[String(group.group || '').trim()] = Array.isArray(group.selections) ? group.selections : [];
  });

  return (menuItem.modifierGroups || []).map(group => {
    const requested = selectedByGroup[group.name] || [];
    if (group.required && !requested.length) {
      throw new Error(`Please choose ${group.name} for ${menuItem.itemName}.`);
    }
    const allowed = {};
    group.options.forEach(option => allowed[option.name] = option);
    const cleanSelections = requested.map(option => allowed[String(option.name || '').trim()])
      .filter(Boolean);
    if (group.type !== 'multi' && cleanSelections.length > 1) {
      throw new Error(`Please choose only one ${group.name} for ${menuItem.itemName}.`);
    }
    return cleanSelections.length ? { group: group.name, selections: cleanSelections } : null;
  }).filter(Boolean);
}

function createTruckOrder(order) {
  if (!order) throw new Error('Missing order.');
  if (!isTruckOrderingOpen()) {
    throw new Error('Food truck ordering is currently closed. Please order directly at the truck.');
  }
  const allowedPaymentTypes = ['Member Account', 'Guest Pay at Pickup'];
  const paymentType = allowedPaymentTypes.includes(order.paymentType) ? order.paymentType : 'Member Account';
  const pickupPayment = paymentType === 'Guest Pay at Pickup';
  const paymentStatus = pickupPayment ? 'Due at Pickup' : 'Member Account';
  const settings = getSettingsObject();
  const tipsEnabled = pickupPayment || String(settings.TruckMemberTipsEnabled || 'TRUE').toUpperCase() !== 'FALSE';
  const guestCardType = paymentType === 'Guest Pay at Pickup' ? String(order.guestCardType || '').trim() : '';
  const tipAmount = tipsEnabled ? roundMoney(Math.max(0, Number(order.tipAmount || 0))) : 0;
  const tipLabel = tipsEnabled ? String(order.tipLabel || 'No tip').trim() : '';
  const memberProfile = pickupPayment ? null : validateMemberNumber(order.memberNumber, 'The Turn Truck');
  const memberCustomerType = memberProfile ? memberProfile.customerType : '';
  if (!String(order.memberName || '').trim()) throw new Error(pickupPayment ? 'Name is required.' : 'Member name is required.');
  if (!String(order.phone || '').trim()) throw new Error('Mobile number is required.');
  if (!order.authorizationAccepted) throw new Error(pickupPayment ? 'Payment acknowledgement is required.' : 'Charge authorization is required.');
  if (paymentType === 'Guest Pay at Pickup' && !guestCardType) throw new Error('Guest card type is required.');

  const incomingItems = Array.isArray(order.items) ? order.items : [];
  const items = validateTruckItems(incomingItems);
  if (!items.length) throw new Error('Please select at least one food truck item.');
  const subtotalKnownItems = items.reduce((sum, item) =>
    sum + (Number(item.price || 0) + modifierUnitTotal(item)) * Number(item.quantity || 0), 0);
  const fees = calculateTruckFees(subtotalKnownItems, tipAmount, paymentType, settings, memberCustomerType);
  const alcoholIncluded = items.some(item => item.alcoholic);
  if (alcoholIncluded && !order.alcoholVerificationAccepted) {
    throw new Error('Alcohol verification acknowledgement is required.');
  }
  const summary = itemSummary(items);
  let orderId;
  let timestamp;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    orderId = makeTruckOrderId();
    timestamp = new Date();
    const sheet = getSheet('TruckOrders');
    ensureTruckOrderColumns(sheet);
    sheet.appendRow([
      timestamp,
      orderId,
      'New',
      String(order.memberName || '').trim(),
      String(order.memberNumber || '').trim(),
      String(order.phone || '').trim(),
      summary,
      JSON.stringify(items),
      subtotalKnownItems,
      Boolean(order.authorizationAccepted),
      alcoholIncluded,
      Boolean(order.alcoholVerificationAccepted),
      String(order.specialInstructions || '').trim(),
      timestamp,
      '',
      false,
      '',
      '',
      paymentType,
      paymentStatus,
      guestCardType,
      tipLabel,
      tipAmount,
      fees.estimatedTotal,
      fees.customerType,
      fees.serviceFeeLabel,
      fees.serviceFeeRate,
      fees.serviceFeeAmount,
      fees.serviceFeeVisible,
      fees.creditCardFeeLabel,
      fees.creditCardFeeRate,
      fees.creditCardFeeAmount,
      fees.creditCardFeeVisible,
      fees.finalTotal
    ]);
  } finally {
    lock.releaseLock();
  }

  return { orderId };
}

function getOrders() {
  const sheet = getSheet('Orders');
  ensureOrderColumns(sheet);
  const rows = rowsToObjects(sheet);
  return rows.map(row => {
    let items = [];
    try { items = JSON.parse(row.ItemsJSON || '[]'); } catch (e) {}
    const routing = routeOrder({
      fulfillmentType: String(row.FulfillmentType || 'Pickup'),
      barRequest: String(row.BarRequest || ''),
      alcoholIncluded: String(row.AlcoholIncluded).toUpperCase() === 'TRUE' || row.AlcoholIncluded === true
    }, items);
    const routeStations = String(row.RouteStations || '').trim() || routing.routes.join(', ');
    const derivedStatus = deriveOverallStatus({ ...row, RouteStations: routeStations });
    return {
      timestamp: row.Timestamp ? new Date(row.Timestamp).toLocaleString() : '',
      orderId: String(row.OrderID || ''),
      status: derivedStatus,
      fulfillmentType: String(row.FulfillmentType || 'Pickup'),
      paymentType: String(row.PaymentType || 'Member Account'),
      paymentStatus: String(row.PaymentStatus || ''),
      guestCardType: String(row.GuestCardType || ''),
      tipLabel: String(row.TipLabel || ''),
      tipAmount: Number(row.TipAmount || 0),
      estimatedTotal: Number(row.EstimatedTotal || row.SubtotalKnownItems || 0),
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
      completedAt: row.CompletedAt ? new Date(row.CompletedAt).toLocaleString() : '',
      routeStations,
      barStatus: normalizeStationStatus(row.BarStatus, routeStations.includes('Bar')),
      kitchenStatus: normalizeStationStatus(row.KitchenStatus, routeStations.includes('Kitchen')),
      runnerStatus: normalizeStationStatus(row.RunnerStatus, routeStations.includes('Wait Station')),
      barUpdatedAt: row.BarUpdatedAt ? new Date(row.BarUpdatedAt).toLocaleString() : '',
      kitchenUpdatedAt: row.KitchenUpdatedAt ? new Date(row.KitchenUpdatedAt).toLocaleString() : '',
      runnerUpdatedAt: row.RunnerUpdatedAt ? new Date(row.RunnerUpdatedAt).toLocaleString() : '',
      posPosted: String(row.POSPosted).toUpperCase() === 'TRUE' || row.POSPosted === true,
      posPostedAt: row.POSPostedAt ? new Date(row.POSPostedAt).toLocaleString() : '',
      posPostedBy: String(row.POSPostedBy || '')
    };
  }).reverse();
}

function normalizeTruckOrder(row) {
  let items = [];
  try { items = JSON.parse(row.ItemsJSON || '[]'); } catch (e) {}
  return {
    timestamp: row.Timestamp ? new Date(row.Timestamp).toLocaleString() : '',
    orderId: String(row.OrderID || ''),
    status: String(row.Status || 'New'),
    paymentType: String(row.PaymentType || 'Member Account'),
    paymentStatus: String(row.PaymentStatus || ''),
    customerType: normalizeCustomerType(row.CustomerType || customerTypeForPayment(String(row.PaymentType || 'Member Account'))),
    guestCardType: String(row.GuestCardType || ''),
    tipLabel: String(row.TipLabel || ''),
    tipAmount: Number(row.TipAmount || 0),
    estimatedTotal: Number(row.EstimatedTotal || row.SubtotalKnownItems || 0),
    serviceFeeLabel: String(row.ServiceFeeLabel || ''),
    serviceFeeRate: Number(row.ServiceFeeRate || 0),
    serviceFeeAmount: Number(row.ServiceFeeAmount || 0),
    serviceFeeVisible: String(row.ServiceFeeVisible).toUpperCase() === 'TRUE' || row.ServiceFeeVisible === true,
    creditCardFeeLabel: String(row.CreditCardFeeLabel || ''),
    creditCardFeeRate: Number(row.CreditCardFeeRate || 0),
    creditCardFeeAmount: Number(row.CreditCardFeeAmount || 0),
    creditCardFeeVisible: String(row.CreditCardFeeVisible).toUpperCase() === 'TRUE' || row.CreditCardFeeVisible === true,
    finalTotal: Number(row.FinalTotal || row.EstimatedTotal || row.SubtotalKnownItems || 0),
    memberName: String(row.MemberName || ''),
    memberNumber: String(row.MemberNumber || ''),
    phone: String(row.Phone || ''),
    itemsSummary: String(row.ItemsSummary || ''),
    items,
    subtotalKnownItems: Number(row.SubtotalKnownItems || 0),
    authorizationAccepted: String(row.AuthorizationAccepted).toUpperCase() === 'TRUE' || row.AuthorizationAccepted === true,
    alcoholIncluded: String(row.AlcoholIncluded).toUpperCase() === 'TRUE' || row.AlcoholIncluded === true,
    alcoholVerificationAccepted: String(row.AlcoholVerificationAccepted).toUpperCase() === 'TRUE' || row.AlcoholVerificationAccepted === true,
    staffNotes: String(row.StaffNotes || ''),
    updatedAt: row.UpdatedAt ? new Date(row.UpdatedAt).toLocaleString() : '',
    completedAt: row.CompletedAt ? new Date(row.CompletedAt).toLocaleString() : '',
    posPosted: String(row.POSPosted).toUpperCase() === 'TRUE' || row.POSPosted === true,
    posPostedAt: row.POSPostedAt ? new Date(row.POSPostedAt).toLocaleString() : '',
    posPostedBy: String(row.POSPostedBy || '')
  };
}

function getTruckOrders() {
  const sheet = getSheet('TruckOrders');
  ensureTruckOrderColumns(sheet);
  const rows = rowsToObjects(sheet);
  return rows.map(normalizeTruckOrder).reverse();
}


function getOrderStatus(orderId, memberNumber) {
  validateMemberNumber(memberNumber);
  const sheet = getSheet('Orders');
  const rows = rowsToObjects(sheet);
  const order = rows.find(row =>
    String(row.OrderID || '') === String(orderId || '') &&
    memberNumbersMatch(row.MemberNumber, memberNumber)
  );
  if (!order) throw new Error('Order not found.');
  const derivedStatus = deriveOverallStatus(order);
  return {
    orderId: String(order.OrderID || ''),
    status: derivedStatus,
    fulfillmentType: String(order.FulfillmentType || 'Pickup'),
    paymentType: String(order.PaymentType || 'Member Account'),
    paymentStatus: String(order.PaymentStatus || ''),
    guestCardType: String(order.GuestCardType || ''),
    tipLabel: String(order.TipLabel || ''),
    tipAmount: Number(order.TipAmount || 0),
    estimatedTotal: Number(order.EstimatedTotal || order.SubtotalKnownItems || 0),
    memberName: String(order.MemberName || ''),
    tableNumber: String(order.TableNumber || ''),
    updatedAt: order.UpdatedAt ? new Date(order.UpdatedAt).toLocaleString() : '',
    completedAt: order.CompletedAt ? new Date(order.CompletedAt).toLocaleString() : ''
  };
}

function isTodayValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!date.getTime()) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
}

function orderStatusPayload(order) {
  const derivedStatus = deriveOverallStatus(order);
  return {
    orderId: String(order.OrderID || ''),
    status: derivedStatus,
    fulfillmentType: String(order.FulfillmentType || 'Pickup'),
    paymentType: String(order.PaymentType || 'Member Account'),
    paymentStatus: String(order.PaymentStatus || ''),
    guestCardType: String(order.GuestCardType || ''),
    tipLabel: String(order.TipLabel || ''),
    tipAmount: Number(order.TipAmount || 0),
    estimatedTotal: Number(order.EstimatedTotal || order.SubtotalKnownItems || 0),
    memberName: String(order.MemberName || ''),
    tableNumber: String(order.TableNumber || ''),
    updatedAt: order.UpdatedAt ? new Date(order.UpdatedAt).toLocaleString() : '',
    completedAt: order.CompletedAt ? new Date(order.CompletedAt).toLocaleString() : ''
  };
}

function getLatestOrderStatus(memberNumber) {
  const normalizedMemberNumber = String(memberNumber || '').trim();
  validateMemberNumber(normalizedMemberNumber);
  const sheet = getSheet('Orders');
  const rows = rowsToObjects(sheet)
    .filter(row => memberNumbersMatch(row.MemberNumber, normalizedMemberNumber))
    .reverse();
  if (!rows.length) throw new Error('No orders found for that member number.');

  const activeToday = rows.find(row =>
    isTodayValue(row.Timestamp || row.UpdatedAt) &&
    !['Completed', 'Cancelled'].includes(deriveOverallStatus(row))
  );
  if (activeToday) return orderStatusPayload(activeToday);

  const today = rows.find(row => isTodayValue(row.Timestamp || row.UpdatedAt));
  if (today) return orderStatusPayload(today);

  const active = rows.find(row => !['Completed', 'Cancelled'].includes(deriveOverallStatus(row)));
  if (active) return orderStatusPayload(active);

  return orderStatusPayload(rows[0]);
}

function truckStatusPayload(order) {
  return normalizeTruckOrder(order);
}

function getTruckOrderStatus(orderId, memberNumber, phone) {
  const normalizedMemberNumber = String(memberNumber || '').trim();
  const normalizedPhone = String(phone || '').trim();
  if (normalizedMemberNumber) {
    validateMemberNumber(normalizedMemberNumber, 'The Turn Truck');
  } else if (!normalizedPhone) {
    throw new Error('Member number or mobile number is required.');
  }
  const sheet = getSheet('TruckOrders');
  const rows = rowsToObjects(sheet);
  const order = rows.find(row =>
    String(row.OrderID || '') === String(orderId || '') &&
    (
      normalizedMemberNumber
        ? memberNumbersMatch(row.MemberNumber, normalizedMemberNumber)
        : phoneNumbersMatch(row.Phone, normalizedPhone)
    )
  );
  if (!order) throw new Error('Food truck order not found.');
  return truckStatusPayload(order);
}

function getLatestTruckOrderStatus(memberNumber) {
  const normalizedMemberNumber = String(memberNumber || '').trim();
  validateMemberNumber(normalizedMemberNumber, 'The Turn Truck');
  const sheet = getSheet('TruckOrders');
  const rows = rowsToObjects(sheet)
    .filter(row => memberNumbersMatch(row.MemberNumber, normalizedMemberNumber))
    .reverse();
  if (!rows.length) throw new Error('No food truck orders found for that member number.');

  const activeToday = rows.find(row =>
    isTodayValue(row.Timestamp || row.UpdatedAt) &&
    !['Completed', 'Cancelled'].includes(String(row.Status || 'New'))
  );
  if (activeToday) return truckStatusPayload(activeToday);

  const today = rows.find(row => isTodayValue(row.Timestamp || row.UpdatedAt));
  if (today) return truckStatusPayload(today);

  const active = rows.find(row => !['Completed', 'Cancelled'].includes(String(row.Status || 'New')));
  if (active) return truckStatusPayload(active);

  return truckStatusPayload(rows[0]);
}

function updateStationStatus(orderId, station, status) {
  const stationMap = {
    Bar: { statusCol: 'BarStatus', updatedCol: 'BarUpdatedAt' },
    Kitchen: { statusCol: 'KitchenStatus', updatedCol: 'KitchenUpdatedAt' },
    Runner: { statusCol: 'RunnerStatus', updatedCol: 'RunnerUpdatedAt' },
    'Wait Station': { statusCol: 'RunnerStatus', updatedCol: 'RunnerUpdatedAt' }
  };
  const config = stationMap[String(station || '')];
  if (!config || !STATION_STATUSES.includes(status)) throw new Error('Invalid station status update.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet('Orders');
    const headers = ensureOrderColumns(sheet);
    const idCol = headers.indexOf('OrderID') + 1;
    const overallStatusCol = headers.indexOf('Status') + 1;
    const updatedCol = headers.indexOf('UpdatedAt') + 1;
    const completedCol = headers.indexOf('CompletedAt') + 1;
    const stationStatusCol = headers.indexOf(config.statusCol) + 1;
    const stationUpdatedCol = headers.indexOf(config.updatedCol) + 1;
    if (idCol < 1 || overallStatusCol < 1 || stationStatusCol < 1 || updatedCol < 1) {
      throw new Error('Orders sheet is missing a required column.');
    }

    const values = sheet.getDataRange().getValues();
    for (let r = 2; r <= values.length; r++) {
      if (String(sheet.getRange(r, idCol).getValue()) === String(orderId)) {
        const now = new Date();
        sheet.getRange(r, stationStatusCol).setValue(status);
        sheet.getRange(r, stationUpdatedCol).setValue(now);
        sheet.getRange(r, updatedCol).setValue(now);

        const row = {};
        headers.forEach((header, index) => {
          row[header] = index === stationStatusCol - 1 ? status : sheet.getRange(r, index + 1).getValue();
        });
        const nextOverall = deriveOverallStatus(row);
        sheet.getRange(r, overallStatusCol).setValue(nextOverall);
        if (nextOverall === 'Completed' && completedCol > 0) {
          sheet.getRange(r, completedCol).setValue(now);
        }
        return;
      }
    }
  } finally {
    lock.releaseLock();
  }
  throw new Error('Order not found.');
}

function updatePosPosted(orderId, posted, postedBy) {
  const isPosted = posted === true || String(posted).toUpperCase() === 'TRUE';
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet('Orders');
    const headers = ensureOrderColumns(sheet);
    const idCol = headers.indexOf('OrderID') + 1;
    const posPostedCol = headers.indexOf('POSPosted') + 1;
    const posPostedAtCol = headers.indexOf('POSPostedAt') + 1;
    const posPostedByCol = headers.indexOf('POSPostedBy') + 1;
    const updatedCol = headers.indexOf('UpdatedAt') + 1;
    if (idCol < 1 || posPostedCol < 1 || posPostedAtCol < 1 || posPostedByCol < 1) {
      throw new Error('Orders sheet is missing POS reconciliation columns.');
    }

    const values = sheet.getDataRange().getValues();
    for (let r = 2; r <= values.length; r++) {
      if (String(sheet.getRange(r, idCol).getValue()) === String(orderId)) {
        const now = new Date();
        sheet.getRange(r, posPostedCol).setValue(isPosted);
        sheet.getRange(r, posPostedAtCol).setValue(isPosted ? now : '');
        sheet.getRange(r, posPostedByCol).setValue(isPosted ? String(postedBy || 'Pool Staff').trim() : '');
        if (updatedCol > 0) sheet.getRange(r, updatedCol).setValue(now);
        return;
      }
    }
  } finally {
    lock.releaseLock();
  }
  throw new Error('Order not found.');
}

function updateTruckOrderStatus(orderId, status) {
  const allowed = ['New', 'Acknowledged', 'Ready for Pickup', 'Completed', 'Cancelled'];
  if (!allowed.includes(status)) throw new Error('Invalid truck order status.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet('TruckOrders');
    const headers = ensureTruckOrderColumns(sheet);
    const idCol = headers.indexOf('OrderID') + 1;
    const statusCol = headers.indexOf('Status') + 1;
    const updatedCol = headers.indexOf('UpdatedAt') + 1;
    const completedCol = headers.indexOf('CompletedAt') + 1;
    if (idCol < 1 || statusCol < 1 || updatedCol < 1) {
      throw new Error('TruckOrders sheet is missing a required column.');
    }

    const values = sheet.getDataRange().getValues();
    for (let r = 2; r <= values.length; r++) {
      if (String(sheet.getRange(r, idCol).getValue()) === String(orderId)) {
        const now = new Date();
        sheet.getRange(r, statusCol).setValue(status);
        sheet.getRange(r, updatedCol).setValue(now);
        if (status === 'Completed' && completedCol > 0) {
          sheet.getRange(r, completedCol).setValue(now);
        }
        return;
      }
    }
  } finally {
    lock.releaseLock();
  }
  throw new Error('Food truck order not found.');
}

function updateTruckPosPosted(orderId, posted, postedBy) {
  const isPosted = posted === true || String(posted).toUpperCase() === 'TRUE';
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet('TruckOrders');
    const headers = ensureTruckOrderColumns(sheet);
    const idCol = headers.indexOf('OrderID') + 1;
    const posPostedCol = headers.indexOf('POSPosted') + 1;
    const posPostedAtCol = headers.indexOf('POSPostedAt') + 1;
    const posPostedByCol = headers.indexOf('POSPostedBy') + 1;
    const updatedCol = headers.indexOf('UpdatedAt') + 1;
    if (idCol < 1 || posPostedCol < 1 || posPostedAtCol < 1 || posPostedByCol < 1) {
      throw new Error('TruckOrders sheet is missing POS reconciliation columns.');
    }

    const values = sheet.getDataRange().getValues();
    for (let r = 2; r <= values.length; r++) {
      if (String(sheet.getRange(r, idCol).getValue()) === String(orderId)) {
        const now = new Date();
        sheet.getRange(r, posPostedCol).setValue(isPosted);
        sheet.getRange(r, posPostedAtCol).setValue(isPosted ? now : '');
        sheet.getRange(r, posPostedByCol).setValue(isPosted ? String(postedBy || 'Truck Staff').trim() : '');
        if (updatedCol > 0) sheet.getRange(r, updatedCol).setValue(now);
        return;
      }
    }
  } finally {
    lock.releaseLock();
  }
  throw new Error('Food truck order not found.');
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
  const guestPayment = order.paymentType === 'Guest Pay at Pickup';
  const subject = `New Pool Order #${order.orderId} — Table ${order.tableNumber}`;
  const body = [
    `New Pool Order #${order.orderId}`,
    ``,
    `Service: ${order.fulfillmentType || 'Pickup'}`,
    `Table: ${order.tableNumber || '—'}`,
    `${guestPayment ? 'Guest' : 'Member'}: ${order.memberName}`,
    guestPayment ? `Payment: GUEST PAYMENT REQUIRED AT PICKUP` : `Member #: ${order.memberNumber}`,
    `Phone: ${order.phone}`,
    ``,
    `Items:`,
    order.itemsSummary || 'No standard menu items.',
    order.barRequest ? `\nBar / Cocktail Request:\n${order.barRequest}` : '',
    ``,
    `Subtotal: $${Number(order.subtotalKnownItems || 0).toFixed(2)}`,
    guestPayment ? `Card type: ${order.guestCardType || 'Not selected'}` : '',
    Number(order.tipAmount || 0) > 0 ? `Tip: ${order.tipLabel || 'Custom'} ($${Number(order.tipAmount || 0).toFixed(2)})` : '',
    Number(order.tipAmount || 0) > 0 || guestPayment ? `${guestPayment ? 'Estimated total' : 'Total with tip'}: $${Number(order.estimatedTotal || Number(order.subtotalKnownItems || 0) + Number(order.tipAmount || 0)).toFixed(2)}` : '',
    guestPayment ? `Collect physical credit card before handoff. Do not release without payment.` : '',
    order.hasCustomBarRequest ? `Custom bar request pricing to be entered in club POS.` : '',
    `Alcohol included: ${order.alcoholIncluded ? 'YES' : 'No'}`,
    ``,
    `Please verify member/ID at pickup when alcohol is included.`
  ].join('\n');

  MailApp.sendEmail(staffEmail, subject, body);
}
