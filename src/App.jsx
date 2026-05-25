
import React, { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, ClipboardList, RefreshCcw, Printer, Lock, CheckCircle, AlertTriangle, Phone, MapPin, Utensils, UserRound, ShieldCheck, Undo2, Truck, Wine, ChefHat, Users, QrCode, ExternalLink, TableProperties, BookOpen, Flag, PencilLine, Volume2, Home } from 'lucide-react';

const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL || '';
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || '';
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'poolstaff';
const TRUCK_PASSWORD = import.meta.env.VITE_TRUCK_STAFF_PASSWORD || 'truckstaff';
const API_TIMEOUT_MS = 12000;
const API_RETRIES = 2;
const CONFIRMATION_KEY = 'eastpointeLastConfirmation';
const TRUCK_CONFIRMATION_KEY = 'eastpointeLastTruckConfirmation';
const ADMIN_TOKEN_KEY = 'eastpointeAdminToken';
const TRUCK_TOKEN_KEY = 'eastpointeTruckToken';
const PUBLIC_BASE_URL = 'https://eastpointeordering.netlify.app';
const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1LUax2G_gf1AO4wnqCVfZ2yh3tOv780ijlLB7XeMk2R0/edit';
const NETLIFY_DEPLOYS_URL = 'https://app.netlify.com/projects/eastpointeordering/deploys';
let notificationAudioContext = null;

function qrUrl(url) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(url)}`;
}

const ALL_ORDER_COLUMNS = [
  { id: 'Active', title: 'Active Orders', statuses: ['New', 'Accepted', 'Preparing'], tone: 'new' },
  { id: 'Ready', title: 'Ready', statuses: ['Ready for Pickup'], tone: 'ready' },
  { id: 'Completed', title: 'Completed', statuses: ['Completed'], tone: 'completed', todayOnly: true },
  { id: 'Cancelled', title: 'Cancelled', statuses: ['Cancelled'], tone: 'cancelled', todayOnly: true }
];

const STATION_TABS = [
  { id: 'all', title: 'All Orders', route: '', station: '', statusKey: '', updatedKey: '', Icon: ClipboardList },
  { id: 'bar', title: 'Bar', route: 'Bar', station: 'Bar', statusKey: 'barStatus', updatedKey: 'barUpdatedAt', Icon: Wine },
  { id: 'kitchen', title: 'Kitchen', route: 'Kitchen', station: 'Kitchen', statusKey: 'kitchenStatus', updatedKey: 'kitchenUpdatedAt', Icon: ChefHat },
  { id: 'wait', title: 'Wait Station', route: 'Wait Station', station: 'Wait Station', statusKey: 'runnerStatus', updatedKey: 'runnerUpdatedAt', Icon: Users }
];

const STATION_COLUMNS = [
  { id: 'New', title: 'New', statuses: ['New'], tone: 'new' },
  { id: 'Preparing', title: 'Preparing', statuses: ['Preparing'], tone: 'preparing' },
  { id: 'Ready', title: 'Ready', statuses: ['Ready'], tone: 'ready' },
  { id: 'Completed', title: 'Completed', statuses: ['Completed'], tone: 'completed', todayOnly: true }
];

const TRUCK_COLUMNS = [
  { id: 'New', title: 'Order Received', statuses: ['New'], tone: 'new' },
  { id: 'Acknowledged', title: 'Acknowledged', statuses: ['Acknowledged'], tone: 'preparing' },
  { id: 'Ready', title: 'Ready for Pickup', statuses: ['Ready for Pickup'], tone: 'ready' },
  { id: 'Completed', title: 'Completed', statuses: ['Completed'], tone: 'completed', todayOnly: true },
  { id: 'Cancelled', title: 'Cancelled', statuses: ['Cancelled'], tone: 'cancelled', todayOnly: true }
];

function currency(value) {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeModifierOption(option) {
  if (typeof option === 'string') return { name: option, priceDelta: 0 };
  return {
    name: String(option?.name || '').trim(),
    priceDelta: Number(option?.priceDelta || 0)
  };
}

function modifierGroupsForItem(item) {
  const raw = item?.modifierGroups;
  const groups = Array.isArray(raw) ? raw : [];
  return groups.map(group => ({
    name: String(group?.name || '').trim(),
    type: group?.type === 'multi' ? 'multi' : 'single',
    required: Boolean(group?.required),
    options: Array.isArray(group?.options)
      ? group.options.map(normalizeModifierOption).filter(option => option.name)
      : []
  })).filter(group => group.name && group.options.length);
}

function selectedModifierGroups(item, selectionsByGroup = {}) {
  return modifierGroupsForItem(item).map(group => {
    const selectedNames = Array.isArray(selectionsByGroup[group.name])
      ? selectionsByGroup[group.name]
      : selectionsByGroup[group.name]
        ? [selectionsByGroup[group.name]]
        : [];
    const options = group.options.filter(option => selectedNames.includes(option.name));
    return options.length ? { group: group.name, selections: options } : null;
  }).filter(Boolean);
}

function modifierUnitTotal(item) {
  return (item.selectedModifiers || []).reduce((sum, group) =>
    sum + (group.selections || []).reduce((groupSum, option) => groupSum + Number(option.priceDelta || 0), 0), 0);
}

function orderItemUnitPrice(item) {
  return Number(item.price || 0) + modifierUnitTotal(item);
}

function orderItemLineTotal(item) {
  return orderItemUnitPrice(item) * Number(item.quantity || 0);
}

function modifierSummaryLines(item) {
  return (item.selectedModifiers || []).reduce((lines, group) => {
    (group.selections || []).forEach(option => {
      const price = Number(option.priceDelta || 0);
      lines.push(`${group.group}: ${option.name}${price ? ` ${currency(price)}` : ''}`);
    });
    return lines;
  }, []);
}

function printableItems(order) {
  if (Array.isArray(order.items) && order.items.length) return order.items;
  return String(order.itemsSummary || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => ({ itemName: line, quantity: '', price: '' }));
}

function printCustomerChit(order, onBlocked) {
  const w = window.open('', '_blank');
  if (!w) {
    if (onBlocked) onBlocked('Pop-up blocked. Please allow pop-ups to print the customer chit.');
    return;
  }
  const items = printableItems(order);
  const rows = items.length
    ? items.map(item => {
      const qty = Number(item.quantity || 0);
      const lineTotal = orderItemLineTotal(item);
      const hasKnownPrice = Number(item.price || 0) > 0 && qty > 0;
      const modifiers = modifierSummaryLines(item);
      return `
        <tr>
          <td>${escapeHtml(qty ? `${qty}x` : '')}</td>
          <td>${escapeHtml(item.itemName || item.name || '')}${modifiers.length ? `<div class="muted">${escapeHtml(modifiers.join(' · '))}</div>` : ''}</td>
          <td>${hasKnownPrice ? escapeHtml(currency(lineTotal)) : ''}</td>
        </tr>`;
    }).join('')
    : '<tr><td colspan="3">No standard items listed.</td></tr>';
  const customRequest = order.barRequest || order.specialInstructions || '';
  const customLabel = order.barRequest ? 'Bar / Cocktail Request' : 'Special Instructions';
  const isGuestPayment = order.paymentType === 'Guest Pay at Pickup';
  const tipAmount = Number(order.tipAmount || 0);
  const totalWithTip = Number(order.subtotalKnownItems || 0) + tipAmount;
  const hasTip = tipAmount > 0;
  w.document.write(`
    <html>
      <head>
        <title>Customer Chit ${escapeHtml(order.orderId || '')}</title>
        <style>
          body{font-family:Arial,sans-serif;color:#111;padding:18px;max-width:360px}
          h1{font-size:22px;margin:0 0 6px} h2{font-size:15px;margin:18px 0 8px;border-top:1px solid #ddd;padding-top:12px}
          p{margin:4px 0;font-size:14px}.meta{margin:12px 0}.muted{color:#555;font-size:12px}
          table{width:100%;border-collapse:collapse;margin-top:8px}td{padding:6px 0;border-bottom:1px solid #eee;font-size:14px;vertical-align:top}
          td:first-child{width:42px}td:last-child{text-align:right;white-space:nowrap}.total{font-size:17px;font-weight:700;text-align:right;margin-top:12px}
        </style>
      </head>
      <body>
        <h1>Customer Chit</h1>
        <p><strong>Order #${escapeHtml(order.orderId || '')}</strong></p>
        <div class="meta">
          <p>${escapeHtml(order.memberName || 'Member')}${order.memberNumber ? ` · Member #${escapeHtml(order.memberNumber)}` : ''}</p>
          <p>${escapeHtml(order.fulfillmentType || 'Pickup')}${order.tableNumber ? ` · Table ${escapeHtml(order.tableNumber)}` : ''}</p>
          <p class="muted">${escapeHtml(order.timestamp ? new Date(order.timestamp).toLocaleString() : new Date().toLocaleString())}</p>
        </div>
        <h2>Items</h2>
        <table>${rows}</table>
        ${customRequest ? `<h2>${escapeHtml(customLabel)}</h2><p>${escapeHtml(customRequest)}</p><p class="muted">Custom requests may be priced by staff.</p>` : ''}
        <p class="total">Known subtotal: ${escapeHtml(currency(order.subtotalKnownItems))}</p>
        ${isGuestPayment ? `<h2>Payment</h2><p><strong>Guest payment required at pickup.</strong></p><p>Card type: ${escapeHtml(order.guestCardType || 'Not selected')}</p><p>Tip: ${escapeHtml(order.tipLabel || 'No tip')} ${tipAmount > 0 ? `(${escapeHtml(currency(tipAmount))})` : ''}</p><p><strong>Estimated total: ${escapeHtml(currency(totalWithTip))}</strong></p>` : hasTip ? `<h2>Tip</h2><p>Tip: ${escapeHtml(order.tipLabel || 'Custom')} (${escapeHtml(currency(tipAmount))})</p><p><strong>Total with tip: ${escapeHtml(currency(totalWithTip))}</strong></p>` : ''}
        <p class="muted">Final club account charge may include staff-priced custom items, tax, service charge, or adjustments.</p>
      </body>
    </html>
  `);
  w.document.close();
  w.print();
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function todayISO() {
  return new Date().toISOString();
}

function shortDate() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
}

function timeLabel(value) {
  const date = new Date(value);
  if (!date.getTime()) return '';
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
}

function ageLabel(value) {
  const time = new Date(value).getTime();
  if (!time) return '';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(value).toLocaleDateString();
}

function itemLines(order) {
  if (Array.isArray(order.items) && order.items.length) {
    return order.items.reduce((lines, item) => {
      lines.push(`${item.quantity || 1}x ${item.itemName}`);
      modifierSummaryLines(item).forEach(line => lines.push(`  ${line}`));
      return lines;
    }, []);
  }
  return String(order.itemsSummary || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function stationRoutes(order) {
  const savedRoutes = String(order.routeStations || '')
    .split(',')
    .map(route => route.trim())
    .filter(Boolean);
  if (savedRoutes.length) return savedRoutes;

  const items = Array.isArray(order.items) ? order.items : [];
  const isBarItem = item => {
    const category = String(item.category || '').toLowerCase();
    return Boolean(item.alcoholic) ||
      category.includes('beer') ||
      category.includes('wine') ||
      category.includes('cocktail') ||
      category.includes('seltzer') ||
      category.includes('non-alcoholic') ||
      category.includes('drink');
  };
  const needsBar = Boolean(order.alcoholIncluded) || Boolean(String(order.barRequest || '').trim()) || items.some(isBarItem);
  const needsKitchen = items.some(item => !isBarItem(item));
  const needsWaitStation = order.fulfillmentType === 'Delivery' || (needsBar && needsKitchen);
  const routes = [];
  if (needsBar) routes.push('Bar');
  if (needsKitchen) routes.push('Kitchen');
  if (needsWaitStation) routes.push('Wait Station');
  return routes;
}

function hasStationRoute(order, route) {
  return stationRoutes(order).includes(route);
}

function stationStatus(order, station) {
  if (!station || !station.statusKey) return order.status || 'New';
  if (!hasStationRoute(order, station.route)) return 'Not Needed';
  return order[station.statusKey] || 'New';
}

function displayPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return String(phone || '').trim();
}

function isGuestOrder(order) {
  return order?.paymentType === 'Guest Pay at Pickup' || order?.paymentStatus === 'Due at Pickup';
}

function tipOrdersToday(orders) {
  return orders.filter(order =>
    Number(order.tipAmount || 0) > 0 &&
    isOrderToday(order) &&
    order.status !== 'Cancelled'
  );
}

function sumTips(orders) {
  return orders.reduce((sum, order) => sum + Number(order.tipAmount || 0), 0);
}

function tipDetails(subtotal, tipChoice, customTip) {
  if (tipChoice === 'custom') {
    const custom = Math.max(0, Number(customTip || 0) || 0);
    return { amount: custom, label: custom > 0 ? 'Custom' : 'No tip' };
  }
  const percent = Number(tipChoice || 0);
  const amount = percent > 0 ? Number(subtotal || 0) * (percent / 100) : 0;
  return { amount, label: percent > 0 ? `${percent}%` : 'No tip' };
}

function memberStatusSteps(status, fulfillmentType) {
  const labels = fulfillmentType === 'Delivery'
    ? ['Order received', 'Accepted by staff', 'Preparing now', 'On its way', 'Enjoy']
    : ['Order received', 'Accepted by staff', 'Preparing now', 'Ready for pickup', 'Enjoy'];
  const statusIndex = {
    New: 0,
    Accepted: 1,
    Preparing: 2,
    'Ready for Pickup': 3,
    Completed: 4
  };
  const activeIndex = statusIndex[status] ?? 0;
  return labels.map((label, index) => ({
    label,
    state: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending'
  }));
}

function truckStatusSteps(status) {
  const labels = ['Order received', 'Ready for pickup'];
  const stateByStatus = {
    New: ['active', 'pending'],
    Acknowledged: ['done', 'pending'],
    'Ready for Pickup': ['done', 'done'],
    Completed: ['done', 'done']
  };
  const states = stateByStatus[status] || stateByStatus.New;
  return labels.map((label, index) => ({
    label,
    state: states[index] || 'pending'
  }));
}

function memberTruckStatus(status) {
  return ['Ready for Pickup', 'Completed'].includes(status) ? 'Ready for Pickup' : 'Order received';
}

function isToday(value) {
  const date = new Date(value);
  if (!date.getTime()) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
}

function isOrderToday(order) {
  return isToday(order.timestamp) || isToday(order.updatedAt) || isToday(order.completedAt);
}

function settingEnabled(settings, key, fallback = true) {
  const value = settings?.[key];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toUpperCase() !== 'FALSE';
}

function settingValue(settings, key, fallback = '') {
  const value = settings?.[key];
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function timeInputValue(settings, key, fallback) {
  const raw = settingValue(settings, key, fallback);
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function scheduleIsOpen(settings, prefix = '') {
  const enabled = settingEnabled(settings, `${prefix}OrderingScheduleEnabled`, false);
  if (!enabled) return null;
  const open = timeInputValue(settings, `${prefix}OrderingOpenTime`, '08:30');
  const close = timeInputValue(settings, `${prefix}OrderingCloseTime`, '16:30');
  const now = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
  return now >= open && now < close;
}

function effectiveOrderingOpen(settings, key = 'OrderingOpen', prefix = '') {
  const manualValue = settings?.[key];
  if (manualValue !== undefined && manualValue !== null && manualValue !== '') {
    return settingEnabled(settings, key, true);
  }
  const scheduledOpen = scheduleIsOpen(settings, prefix);
  if (scheduledOpen !== null) return scheduledOpen;
  return settingEnabled(settings, key, true);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function apiErrorMessage(error, action) {
  if (error.name === 'AbortError') return 'The ordering system is taking longer than expected to respond. Please try again.';
  if (String(error.message || '').includes('Failed to fetch')) return 'Unable to reach the ordering system. Please check the connection and try again.';
  return error.message || `Unable to complete ${action}.`;
}

async function fetchJsonWithRetry(url, options, action) {
  let lastError;
  for (let attempt = 0; attempt <= API_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error('The ordering system returned an unexpected response. Please refresh and try again.');
      }
      if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}.`);
      if (!data.ok) throw new Error(data.error || 'Request failed.');
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < API_RETRIES) await sleep(450 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(apiErrorMessage(lastError || new Error('Request failed.'), action));
}

async function apiGet(action, extra = {}) {
  if (!SCRIPT_URL) throw new Error('Missing VITE_SCRIPT_URL. Add your Apps Script URL in Netlify environment variables.');
  const url = new URL(SCRIPT_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('_', Date.now().toString());
  Object.entries(extra).forEach(([k, v]) => url.searchParams.set(k, v));
  return fetchJsonWithRetry(url.toString(), {}, action);
}

async function apiPost(action, payload) {
  if (!SCRIPT_URL) throw new Error('Missing VITE_SCRIPT_URL. Add your Apps Script URL in Netlify environment variables.');
  return fetchJsonWithRetry(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload })
  }, action);
}

async function localAdminFunction(name, options = {}) {
  if (name === 'truck-login') {
    const body = JSON.parse(options.body || '{}');
    if (String(body.password || '') !== TRUCK_PASSWORD) {
      throw new Error('Incorrect password.');
    }
    return { ok: true, token: `local-dev.${Date.now() + 4 * 60 * 60 * 1000}` };
  }

  if (name === 'admin-login') {
    const body = JSON.parse(options.body || '{}');
    if (String(body.password || '') !== ADMIN_PASSWORD) {
      throw new Error('Incorrect password.');
    }
    return { ok: true, token: `local-dev.${Date.now() + 4 * 60 * 60 * 1000}` };
  }

  if (!getAdminToken()) {
    const isTruckFunction = name.startsWith('truck-');
    if (!isTruckFunction || !getTruckToken()) {
      throw new Error('Staff session expired. Please sign in again.');
    }
  }

  if (!ADMIN_KEY) {
    throw new Error('Missing VITE_ADMIN_KEY. Add your Apps Script admin key to local environment variables.');
  }

  if (name === 'admin-orders') {
    return apiGet('orders', { adminKey: ADMIN_KEY });
  }

  if (name === 'truck-orders') {
    return apiGet('truckOrders', { adminKey: ADMIN_KEY });
  }

  if (name === 'admin-update-status') {
    const body = JSON.parse(options.body || '{}');
    return apiPost('updateStatus', { ...body, adminKey: ADMIN_KEY });
  }

  if (name === 'admin-update-station-status') {
    const body = JSON.parse(options.body || '{}');
    return apiPost('updateStationStatus', { ...body, adminKey: ADMIN_KEY });
  }

  if (name === 'admin-update-pos-posted') {
    const body = JSON.parse(options.body || '{}');
    return apiPost('updatePosPosted', { ...body, adminKey: ADMIN_KEY });
  }

  if (name === 'admin-update-setting') {
    const body = JSON.parse(options.body || '{}');
    return apiPost('updateSetting', { ...body, adminKey: ADMIN_KEY });
  }

  if (name === 'admin-update-menu-availability') {
    const body = JSON.parse(options.body || '{}');
    return apiPost('updateMenuAvailability', { ...body, adminKey: ADMIN_KEY });
  }

  if (name === 'truck-update-status') {
    const body = JSON.parse(options.body || '{}');
    return apiPost('updateTruckStatus', { ...body, adminKey: ADMIN_KEY });
  }

  if (name === 'truck-update-pos-posted') {
    const body = JSON.parse(options.body || '{}');
    return apiPost('updateTruckPosPosted', { ...body, adminKey: ADMIN_KEY });
  }

  if (name === 'truck-update-setting') {
    const body = JSON.parse(options.body || '{}');
    return apiPost('updateSetting', { ...body, adminKey: ADMIN_KEY });
  }

  if (name === 'truck-update-menu-availability') {
    const body = JSON.parse(options.body || '{}');
    return apiPost('updateTruckMenuAvailability', { ...body, adminKey: ADMIN_KEY });
  }

  throw new Error(`Unknown local admin function: ${name}`);
}

async function adminFunction(name, options = {}) {
  if (import.meta.env.DEV) {
    return localAdminFunction(name, options);
  }

  return fetchJsonWithRetry(`/.netlify/functions/${name}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  }, name);
}

function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

function getTruckToken() {
  return sessionStorage.getItem(TRUCK_TOKEN_KEY) || '';
}

function setAdminToken(token) {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

function setTruckToken(token) {
  sessionStorage.setItem(TRUCK_TOKEN_KEY, token);
}

function clearAdminToken() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

function clearTruckToken() {
  sessionStorage.removeItem(TRUCK_TOKEN_KEY);
}

function readSavedConfirmation() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CONFIRMATION_KEY) || 'null');
    if (!saved?.orderId) return null;
    return saved;
  } catch {
    return null;
  }
}

function readSavedTruckConfirmation() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TRUCK_CONFIRMATION_KEY) || 'null');
    if (!saved?.orderId) return null;
    return saved;
  } catch {
    return null;
  }
}

function clearSavedConfirmation() {
  sessionStorage.removeItem(CONFIRMATION_KEY);
}

function clearSavedTruckConfirmation() {
  sessionStorage.removeItem(TRUCK_CONFIRMATION_KEY);
}

function getNotificationAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!notificationAudioContext || notificationAudioContext.state === 'closed') {
    notificationAudioContext = new AudioContext();
  }
  return notificationAudioContext;
}

function playNewOrderSound() {
  try {
    const ctx = getNotificationAudioContext();
    if (!ctx || ctx.state !== 'running') return false;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
    return true;
  } catch {
    return false;
  }
}

async function enableNotificationSound() {
  const ctx = getNotificationAudioContext();
  if (!ctx) throw new Error('Audio is not supported in this browser.');
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  if (!playNewOrderSound()) {
    throw new Error('Tap Enable Sound again. iPad may need one more tap to allow audio.');
  }
  return true;
}

function Header({ mode, setMode }) {
  return (
    <header className="header">
      <div className="brandLockup">
        <img src="/eastpointe-logo-tight.png" alt="Eastpointe Country Club" className="brandLogo" />
        <div>
          <p className="eyebrow">Eastpointe Country Club</p>
          <h1>Eastpointe Pool Bar</h1>
        </div>
      </div>
      <button className="ghostButton" onClick={() => setMode(mode === 'admin' ? 'order' : 'admin')}>
        {mode === 'admin' ? 'Order Page' : 'Staff'}
      </button>
    </header>
  );
}

function TruckHeader({ mode, setMode }) {
  return (
    <header className="header truckHeader">
      <div className="brandLockup">
        <img src="/eastpointe-logo-tight.png" alt="Eastpointe Country Club" className="brandLogo" />
        <div>
          <p className="eyebrow">Eastpointe Country Club</p>
          <h1>The Turn Truck</h1>
        </div>
      </div>
      <button className="ghostButton" onClick={() => setMode(mode === 'truck-admin' ? 'truck' : 'truck-admin')}>
        {mode === 'truck-admin' ? 'Order Page' : 'Truck Staff'}
      </button>
    </header>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card login">
          <div className="alert"><AlertTriangle size={18} /> Something on this page did not load correctly.</div>
          <p className="hint">Please refresh the page. If it stays blank, sign out and sign back in.</p>
          <button className="primaryButton" onClick={() => window.location.reload()} type="button">Refresh Page</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function LoadingCard({ message = 'Loading...' }) {
  return <div className="card centered"><RefreshCcw className="spin" size={22} /><p>{message}</p></div>;
}

function EmptyState({ title, body }) {
  return <div className="card centered"><ClipboardList size={26} /><h3>{title}</h3><p>{body}</p></div>;
}

function CategoryTabs({ categories, active, setActive }) {
  return (
    <div className="tabs">
      {categories.map(cat => (
        <button key={cat} className={cat === active ? 'tab active' : 'tab'} onClick={() => setActive(cat)}>
          {cat}
        </button>
      ))}
    </div>
  );
}

function CategorySelect({ categories, active, setActive }) {
  return (
    <label className="categorySelectLabel">Menu Category
      <select value={active} onChange={event => setActive(event.target.value)}>
        {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
      </select>
    </label>
  );
}

function MenuItem({ item, quantity, setQuantity, modifierSelections = {}, setModifierSelection }) {
  const modifierGroups = modifierGroupsForItem(item);

  function toggleModifier(group, option) {
    if (!setModifierSelection) return;
    const current = modifierSelections[group.name];
    if (group.type === 'multi') {
      const currentList = Array.isArray(current) ? current : [];
      const next = currentList.includes(option.name)
        ? currentList.filter(name => name !== option.name)
        : [...currentList, option.name];
      setModifierSelection(group.name, next);
      return;
    }
    setModifierSelection(group.name, current === option.name ? '' : option.name);
  }

  function isModifierSelected(group, option) {
    const current = modifierSelections[group.name];
    return Array.isArray(current) ? current.includes(option.name) : current === option.name;
  }

  return (
    <div className={!item.available ? 'menuItem unavailable' : 'menuItem'}>
      <div className="menuText">
        <div className="menuTitleLine">
          <h3>{item.itemName}</h3>
          <strong>{currency(item.price)}</strong>
        </div>
        {item.description && <p>{item.description}</p>}
        {item.alcoholic && <span className="pill warning">Alcohol</span>}
        {!item.available && <span className="pill muted">Unavailable</span>}
        {modifierGroups.length > 0 && (
          <div className="modifierGroups">
            {modifierGroups.map(group => (
              <div className="modifierGroup" key={`${item.itemId}-${group.name}`}>
                <div className="modifierGroupTitle">
                  <span>{group.name}</span>
                  {group.required && <em>Required</em>}
                </div>
                <div className={group.type === 'multi' ? 'modifierOptions multi' : 'modifierOptions'}>
                  {group.options.map(option => (
                    <button
                      type="button"
                      key={`${group.name}-${option.name}`}
                      disabled={!item.available}
                      className={isModifierSelected(group, option) ? 'selected' : ''}
                      onClick={() => toggleModifier(group, option)}
                    >
                      {option.name}{Number(option.priceDelta || 0) ? ` +${currency(option.priceDelta)}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="qty">
        <button disabled={!item.available || quantity <= 0} onClick={() => setQuantity(Math.max(0, quantity - 1))}>−</button>
        <span>{quantity}</span>
        <button disabled={!item.available} onClick={() => setQuantity(quantity + 1)}>+</button>
      </div>
    </div>
  );
}

function modifierOptionCount(item) {
  return modifierGroupsForItem(item).reduce((sum, group) => sum + group.options.length, 0);
}

function TruckMenuItem({ item, quantity, modifierSelections = {}, onQuickAdd, onQuantityChange, onCustomize }) {
  const modifierGroups = modifierGroupsForItem(item);
  const hasModifiers = modifierGroups.length > 0;

  return (
    <div className={!item.available ? 'menuItem truckMenuItem unavailable' : 'menuItem truckMenuItem'}>
      <div className="menuText">
        <div className="menuTitleLine">
          <h3>{item.itemName}</h3>
          <strong>{currency(item.price)}</strong>
        </div>
        {item.description && <p>{item.description}</p>}
        <div className="menuPillRow">
          {item.alcoholic && <span className="pill warning">Alcohol</span>}
          {hasModifiers && <span className="pill muted">Choose options</span>}
          {!item.available && <span className="pill muted">Unavailable</span>}
        </div>
      </div>
      <div className="truckMenuActions">
        {hasModifiers ? (
          <>
            <button className="customizeButton" disabled={!item.available} onClick={onCustomize} type="button">
              {quantity > 0 ? 'Edit' : modifierOptionCount(item) > 8 ? 'Customize' : 'Choose Options'}
            </button>
            {quantity > 0 && (
              <div className="qty compactQty">
                <button disabled={!item.available || quantity <= 0} onClick={() => onQuantityChange(Math.max(0, quantity - 1))}>−</button>
                <span>{quantity}</span>
                <button disabled={!item.available} onClick={() => onQuantityChange(quantity + 1)}>+</button>
              </div>
            )}
          </>
        ) : (
          <div className="qty">
            <button disabled={!item.available || quantity <= 0} onClick={() => onQuantityChange(Math.max(0, quantity - 1))}>−</button>
            <span>{quantity}</span>
            <button disabled={!item.available} onClick={onQuickAdd}>+</button>
          </div>
        )}
      </div>
    </div>
  );
}

function TruckItemCustomizer({ item, quantity, modifierSelections = {}, setModifierSelection, setQuantity, onClose }) {
  const [localError, setLocalError] = useState('');
  const [draftQuantity, setDraftQuantity] = useState(Math.max(1, Number(quantity || 0) || 1));
  const modifierGroups = modifierGroupsForItem(item);

  function toggleModifier(group, option) {
    const current = modifierSelections[group.name];
    if (group.type === 'multi') {
      const currentList = Array.isArray(current) ? current : [];
      const next = currentList.includes(option.name)
        ? currentList.filter(name => name !== option.name)
        : [...currentList, option.name];
      setModifierSelection(group.name, next);
      return;
    }
    setModifierSelection(group.name, current === option.name && !group.required ? '' : option.name);
  }

  function isModifierSelected(group, option) {
    const current = modifierSelections[group.name];
    return Array.isArray(current) ? current.includes(option.name) : current === option.name;
  }

  function finish() {
    const missingGroup = modifierGroups.find(group => {
      if (!group.required) return false;
      const current = modifierSelections[group.name];
      return Array.isArray(current) ? current.length === 0 : !current;
    });
    if (missingGroup) {
      setLocalError(`Please choose ${missingGroup.name}.`);
      return;
    }
    setQuantity(draftQuantity);
    onClose();
  }

  return (
    <div className="customizerOverlay" role="presentation" onClick={onClose}>
      <div className="customizerSheet" role="dialog" aria-modal="true" aria-label={`Customize ${item.itemName}`} onClick={event => event.stopPropagation()}>
        <div className="customizerHeader">
          <div>
            <span>Customize</span>
            <h2>{item.itemName}</h2>
            <p>{currency(item.price)} base price</p>
          </div>
          <button className="iconCloseButton" onClick={onClose} type="button" aria-label="Close customizer">×</button>
        </div>
        {item.description && <p className="customizerDescription">{item.description}</p>}
        {localError && <div className="inlineAlert"><AlertTriangle size={16} />{localError}</div>}
        <div className="customizerGroups">
          {modifierGroups.map(group => (
            <div className="modifierGroup customizerGroup" key={`${item.itemId}-${group.name}`}>
              <div className="modifierGroupTitle">
                <span>{group.name}</span>
                {group.required ? <em>Required</em> : <em>{group.type === 'multi' ? 'Choose any' : 'Optional'}</em>}
              </div>
              <div className={group.type === 'multi' ? 'modifierOptions multi' : 'modifierOptions'}>
                {group.options.map(option => (
                  <button
                    type="button"
                    key={`${group.name}-${option.name}`}
                    className={isModifierSelected(group, option) ? 'selected' : ''}
                    onClick={() => {
                      setLocalError('');
                      toggleModifier(group, option);
                    }}
                  >
                    {option.name}{Number(option.priceDelta || 0) ? ` +${currency(option.priceDelta)}` : ''}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="customizerFooter">
          <div className="qty modalQty">
            <button onClick={() => setDraftQuantity(prev => Math.max(1, prev - 1))} disabled={draftQuantity <= 1}>−</button>
            <span>{draftQuantity}</span>
            <button onClick={() => setDraftQuantity(prev => prev + 1)}>+</button>
          </div>
          <button className="primaryButton customizerDoneButton" onClick={finish} type="button">
            {quantity > 0 ? 'Update Item' : 'Add to Order'}
          </button>
          {quantity > 0 && (
            <button className="removeItemButton" onClick={() => { setQuantity(0); onClose(); }} type="button">
              Remove from order
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function OrderPage() {
  const initialTable = getQueryParam('table') || '';
  const savedConfirmation = readSavedConfirmation();
  const [menu, setMenu] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statusError, setStatusError] = useState('');
  const [activeCat, setActiveCat] = useState('');
  const [quantities, setQuantities] = useState({});
  const [lookup, setLookup] = useState({
    orderId: getQueryParam('order') || '',
    memberNumber: savedConfirmation?.memberNumber || ''
  });
  const [form, setForm] = useState({
    fulfillmentType: savedConfirmation?.fulfillmentType || 'Pickup',
    paymentType: savedConfirmation?.paymentType || 'Member Account',
    guestCardType: savedConfirmation?.guestCardType || '',
    tipChoice: savedConfirmation?.tipChoice || '20',
    customTip: '',
    memberName: savedConfirmation?.memberName || '',
    memberNumber: savedConfirmation?.memberNumber || '',
    phone: '',
    tableNumber: savedConfirmation?.tableNumber || initialTable,
    barRequest: '',
    authorizationAccepted: false,
    alcoholVerificationAccepted: false
  });
  const [submitting, setSubmitting] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [confirmation, setConfirmation] = useState(savedConfirmation ? {
    orderId: savedConfirmation.orderId,
    pickupLocation: savedConfirmation.pickupLocation || 'Pool Bar',
    chit: savedConfirmation.chit || null
  } : null);
  const [liveStatus, setLiveStatus] = useState(savedConfirmation?.status || '');
  const [readyAt, setReadyAt] = useState(savedConfirmation?.readyAt || '');

  useEffect(() => {
    async function load() {
      try {
        const [menuData, settingsData] = await Promise.all([
          apiGet('menu'),
          apiGet('settings')
        ]);
        setMenu(menuData.items || []);
        setSettings(settingsData.settings || {});
        setActiveCat('All Items');
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (confirmation) return;
    async function refreshSettings() {
      try {
        const settingsData = await apiGet('settings');
        setSettings(settingsData.settings || {});
      } catch {
        // Keep the last known settings; order submission still validates server-side.
      }
    }
    const id = setInterval(refreshSettings, 20000);
    return () => clearInterval(id);
  }, [confirmation]);

  const categories = useMemo(() => {
    const itemCategories = [...new Set(menu.filter(i => i.available).map(i => i.category))];
    return itemCategories.length ? ['All Items', ...itemCategories] : [];
  }, [menu]);
  const visibleItems = useMemo(() => {
    if (activeCat === 'All Items') return menu.filter(i => i.available);
    return menu.filter(i => i.available && i.category === activeCat);
  }, [menu, activeCat]);

  const selectedItems = useMemo(() => {
    return menu
      .filter(item => Number(quantities[item.itemId] || 0) > 0)
      .map(item => ({ ...item, quantity: Number(quantities[item.itemId]) }));
  }, [menu, quantities]);

  const subtotal = selectedItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const hasAlcohol = selectedItems.some(i => i.alcoholic) || form.barRequest.trim().length > 0;
  const hasBarRequest = form.barRequest.trim().length > 0;
  const orderingOpen = effectiveOrderingOpen(settings, 'OrderingOpen', '');
  const deliveryAvailable = settingEnabled(settings, 'DeliveryAvailable', true);
  const isGuestPayment = form.paymentType === 'Guest Pay at Pickup';
  const memberTipsEnabled = settingEnabled(settings, 'MemberTipsEnabled', true);
  const showTipSection = isGuestPayment || memberTipsEnabled;
  const checkoutTip = tipDetails(subtotal, form.tipChoice, form.customTip);
  const checkoutTotal = subtotal + checkoutTip.amount;

  useEffect(() => {
    if (!loading && !confirmation && !deliveryAvailable && form.fulfillmentType === 'Delivery') {
      setField('fulfillmentType', 'Pickup');
    }
  }, [loading, confirmation, deliveryAvailable, form.fulfillmentType]);

  function setField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function setLookupField(field, value) {
    setLookup(prev => ({ ...prev, [field]: value }));
  }

  function validate() {
    if (!['Pickup', 'Delivery'].includes(form.fulfillmentType)) return 'Please choose pickup or delivery.';
    if (!orderingOpen) return 'Pool ordering is currently closed. Please order directly at the Pool Bar.';
    if (form.fulfillmentType === 'Delivery' && !deliveryAvailable) return 'Delivery is currently unavailable. Please choose pickup at the Pool Bar.';
    if (!form.memberName.trim()) return isGuestPayment ? 'Please enter guest name.' : 'Please enter member name.';
    if (!isGuestPayment && !/^\d{4,6}$/.test(form.memberNumber.trim())) return 'Member number must be 4–6 digits.';
    if (!form.phone.trim()) return 'Please enter mobile number.';
    const t = Number(form.tableNumber);
    if (form.fulfillmentType === 'Delivery' && (!Number.isInteger(t) || t < 1 || t > 100)) {
      return 'For delivery, table number must be between 1 and 100.';
    }
    if (form.tableNumber && (!Number.isInteger(t) || t < 1 || t > 100)) {
      return 'Table number must be between 1 and 100.';
    }
    if (selectedItems.length === 0 && !form.barRequest.trim()) return 'Please select at least one item or enter a bar/cocktail request.';
    if (!form.authorizationAccepted) {
      return isGuestPayment
        ? 'Please acknowledge that a physical credit card must be provided at pickup.'
        : 'Please authorize the charge to the member account.';
    }
    if (isGuestPayment && !form.guestCardType) return 'Please choose the card type you will provide at pickup.';
    if (hasAlcohol && !form.alcoholVerificationAccepted) return 'Please accept the alcohol verification notice.';
    return '';
  }

  async function submitOrder() {
    const v = validate();
    if (v) {
      setErr(v);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSubmitting(true);
    setErr('');
    try {
      const payload = {
        order: {
          timestamp: todayISO(),
          status: 'New',
          fulfillmentType: form.fulfillmentType,
          paymentType: form.paymentType,
          paymentStatus: isGuestPayment ? 'Due at Pickup' : 'Member Account',
          guestCardType: isGuestPayment ? form.guestCardType : '',
          tipAmount: showTipSection ? checkoutTip.amount : 0,
          tipLabel: showTipSection ? checkoutTip.label : '',
          estimatedTotal: showTipSection ? checkoutTotal : subtotal,
          memberName: form.memberName.trim(),
          memberNumber: isGuestPayment ? '' : form.memberNumber.trim(),
          phone: form.phone.trim(),
          tableNumber: form.tableNumber.trim(),
          items: selectedItems.map(i => ({
            itemId: i.itemId,
            category: i.category,
            itemName: i.itemName,
            price: Number(i.price || 0),
            quantity: Number(i.quantity || 0),
            alcoholic: Boolean(i.alcoholic)
          })),
          barRequest: form.barRequest.trim(),
          subtotalKnownItems: subtotal,
          hasCustomBarRequest: hasBarRequest,
          alcoholIncluded: hasAlcohol,
          authorizationAccepted: form.authorizationAccepted,
          alcoholVerificationAccepted: form.alcoholVerificationAccepted
        }
      };
      const res = await apiPost('createOrder', payload);
      const chit = {
        ...payload.order,
        orderId: res.orderId,
        pickupLocation: settings.PickupLocation || 'Pool Bar'
      };
      const nextConfirmation = { orderId: res.orderId, pickupLocation: settings.PickupLocation || 'Pool Bar', chit };
      setConfirmation(nextConfirmation);
      setLiveStatus('New');
      sessionStorage.setItem(CONFIRMATION_KEY, JSON.stringify({
        ...nextConfirmation,
        status: 'New',
        memberName: form.memberName.trim(),
        memberNumber: isGuestPayment ? '' : form.memberNumber.trim(),
        paymentType: form.paymentType,
        guestCardType: isGuestPayment ? form.guestCardType : '',
        tipChoice: showTipSection ? form.tipChoice : '0',
        fulfillmentType: form.fulfillmentType,
        tableNumber: form.tableNumber.trim(),
        chit
      }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function lookupOrder() {
    const orderId = String(lookup.orderId || '').trim();
    const memberNumber = String(lookup.memberNumber || '').trim();
    if (!/^\d{4,6}$/.test(memberNumber)) {
      setErr('Enter your 4–6 digit member number.');
      return;
    }

    setLookingUp(true);
    setErr('');
    try {
      const res = orderId
        ? await apiGet('orderStatus', { orderId, memberNumber })
        : await apiGet('latestOrderStatus', { memberNumber });
      const resolvedOrderId = res.orderId || orderId;
      const nextReadyAt = res.status === 'Ready for Pickup' || res.status === 'Completed'
        ? (res.updatedAt || res.completedAt || '')
        : '';
      const restored = {
        orderId: resolvedOrderId,
        pickupLocation: settings.PickupLocation || 'Pool Bar',
        status: res.status || 'New',
        memberNumber,
        memberName: res.memberName || '',
        paymentType: res.paymentType || 'Member Account',
        fulfillmentType: res.fulfillmentType || 'Pickup',
        tableNumber: res.tableNumber || '',
        readyAt: nextReadyAt,
        chit: res.items || res.itemsSummary || res.subtotalKnownItems ? {
          orderId: resolvedOrderId,
          timestamp: res.timestamp || res.updatedAt || todayISO(),
          fulfillmentType: res.fulfillmentType || 'Pickup',
          memberName: res.memberName || '',
          paymentType: res.paymentType || 'Member Account',
          memberNumber,
          tableNumber: res.tableNumber || '',
          items: res.items || [],
          itemsSummary: res.itemsSummary || '',
          barRequest: res.barRequest || '',
          subtotalKnownItems: res.subtotalKnownItems || 0
        } : null
      };
      setForm(prev => ({ ...prev, memberName: restored.memberName || prev.memberName, memberNumber, paymentType: restored.paymentType, fulfillmentType: restored.fulfillmentType, tableNumber: restored.tableNumber }));
      setConfirmation({ orderId: resolvedOrderId, pickupLocation: restored.pickupLocation, chit: restored.chit });
      setLiveStatus(restored.status);
      setReadyAt(nextReadyAt);
      sessionStorage.setItem(CONFIRMATION_KEY, JSON.stringify(restored));
    } catch (e) {
      setErr(e.message || 'Order not found.');
    } finally {
      setLookingUp(false);
    }
  }


  useEffect(() => {
    if (!confirmation?.orderId || !form.memberNumber) return;
    async function pollStatus() {
      try {
        const res = await apiGet('orderStatus', {
          orderId: confirmation.orderId,
          memberNumber: form.memberNumber.trim()
        });
        const nextStatus = res.status || '';
        const nextReadyAt = nextStatus === 'Ready for Pickup' || nextStatus === 'Completed'
          ? (res.updatedAt || res.completedAt || '')
          : '';
        setLiveStatus(nextStatus);
        setReadyAt(nextReadyAt);
        setStatusError('');
        const saved = readSavedConfirmation();
        if (saved) sessionStorage.setItem(CONFIRMATION_KEY, JSON.stringify({ ...saved, status: nextStatus, readyAt: nextReadyAt }));
      } catch (e) {
        setStatusError('Status is reconnecting. Keep this page open.');
      }
    }
    pollStatus();
    const id = setInterval(pollStatus, 8000);
    return () => clearInterval(id);
  }, [confirmation?.orderId, form.memberNumber]);

  if (loading) return <LoadingCard message="Loading menu..." />;

  if (confirmation) {
    const ready = liveStatus === 'Ready for Pickup';
    const chit = confirmation.chit || readSavedConfirmation()?.chit;
    const confirmationIsGuest = form.paymentType === 'Guest Pay at Pickup' || chit?.paymentType === 'Guest Pay at Pickup';
    return (
      <div className="stack memberStack">
        {err && <div className="alert"><AlertTriangle size={18} />{err}</div>}
        <div className={ready ? 'card success statusCard readyCard' : 'card success statusCard'}>
          <div className="orderNumHeader">
            <span>Order confirmed</span>
            <strong>#{confirmation.orderId}</strong>
            <small>{form.fulfillmentType}{form.tableNumber ? ` · Table ${form.tableNumber}` : ''}</small>
          </div>
          <CheckCircle size={34} />
          <h2>{ready ? (form.fulfillmentType === 'Delivery' ? 'Order Ready for Delivery' : 'Ready for Pickup') : 'Order Sent'}</h2>
          <p>Thank you, {form.memberName}. {confirmationIsGuest ? 'Please keep this screen for pickup.' : 'Your order status updates automatically.'}</p>
          {confirmationIsGuest && <div className="paymentDueNotice"><strong>Guest payment required at pickup.</strong> Staff will collect payment before handing off the order.</div>}
          <div className="statusPanel">
            <span>Current Status</span>
            <strong>{liveStatus || 'New'}</strong>
            {readyAt && <em>Ready at {timeLabel(readyAt) || readyAt}</em>}
            {statusError && <small>{statusError}</small>}
          </div>
          <div className="memberStatusTrail" aria-label="Order status progress">
            {memberStatusSteps(liveStatus || 'New', form.fulfillmentType).map(step => (
              <div className={`memberStatusStep ${step.state}`} key={step.label}>
                <div className="memberStatusDot">{step.state === 'done' ? '✓' : ''}</div>
                <span>{step.label}</span>
              </div>
            ))}
          </div>
          <div className={form.fulfillmentType === 'Delivery' ? 'notice' : 'notice pickupNotice'}>
            {form.fulfillmentType === 'Delivery' ? (
              <>
                <strong>Delivery:</strong> Table {form.tableNumber}<br />
                {confirmationIsGuest ? 'Staff will collect guest payment before handoff.' : 'Please keep this screen open. The order status will update automatically.'}
              </>
            ) : (
              <>
                <strong>Pickup:</strong> {confirmation.pickupLocation}<br />
                {confirmationIsGuest ? 'Staff will collect guest payment before handing off the order.' : 'Please keep this screen open. We will update this screen when your order is ready for pickup.'}
              </>
            )}
          </div>
          {ready && (
            <div className="readyNotice">
              {form.fulfillmentType === 'Delivery'
                ? `Your order was ready at ${timeLabel(readyAt) || 'the time shown above'} and will be delivered to your table.`
                : `Your order was ready at ${timeLabel(readyAt) || 'the time shown above'}. Please pick it up at the Pool Bar and provide your name${confirmationIsGuest ? '' : '/member number'}.`}
            </div>
          )}
        </div>
        <div className="confirmationActions">
          {chit && (
            <button className="secondaryButton" onClick={() => printCustomerChit(chit, setErr)} type="button">
              <Printer size={16} /> Print Customer Chit
            </button>
          )}
          <button className="primaryButton" onClick={() => { clearSavedConfirmation(); window.location.reload(); }} type="button">
            <Home size={16} /> Home / New Order
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack memberStack">
      {err && <div className="alert"><AlertTriangle size={18} />{err}</div>}
      {!orderingOpen && <div className="serviceBanner closed"><AlertTriangle size={18} /> Pool ordering is currently closed. Please order directly at the Pool Bar.</div>}
      {orderingOpen && !deliveryAvailable && <div className="serviceBanner"><Truck size={18} /> Pickup only today. Delivery is currently unavailable.</div>}

      <section className="card hero memberHero">
        <div>
          <p className="eyebrow">{settings.ClubName || 'Eastpointe Country Club'}</p>
          <h2>Poolside food & beverage</h2>
          <p>Order from your table. Members can charge their account, and guests can pay at pickup.</p>
        </div>
        {form.tableNumber ? (
          <div className="tableHighlight">
            <span>You're sitting at</span>
            <strong>Table {form.tableNumber}</strong>
            <small>Pre-filled from your QR code</small>
          </div>
        ) : (
          <div className="tableHighlight mutedTable">
            <span>Choose service</span>
            <strong>{form.fulfillmentType}</strong>
            <small>Add a table number for delivery</small>
          </div>
        )}
      </section>

      <section className="card statusLookupCard">
        <div className="sectionKicker"><ClipboardList size={15} /> Already ordered?</div>
        <h2>Check Order Status</h2>
        <p className="hint">If you closed your confirmation screen, enter your member number. Order number is optional if you have it.</p>
        <div className="lookupGrid">
          <label>Order Number <span className="optionalText">Optional</span>
            <input inputMode="numeric" value={lookup.orderId} onChange={e => setLookupField('orderId', e.target.value.replace(/\D/g, ''))} placeholder="Example: 1042" />
          </label>
          <label>Member Number
            <input inputMode="numeric" maxLength="6" value={lookup.memberNumber} onChange={e => setLookupField('memberNumber', e.target.value.replace(/\D/g, ''))} placeholder="4–6 digits" />
          </label>
        </div>
        <button className="ghostLookupButton" onClick={lookupOrder} disabled={lookingUp}>{lookingUp ? 'Checking...' : 'Check Status'}</button>
      </section>


      <section className="card">
        <div className="sectionKicker"><MapPin size={15} /> Service</div>
        <h2>How would you like your order?</h2>
        <div className="choiceGrid">
          <button
            className={form.fulfillmentType === 'Pickup' ? 'choiceCard activeChoice' : 'choiceCard'}
            onClick={() => setField('fulfillmentType', 'Pickup')}
            type="button"
          >
            <strong>Pickup</strong>
            <span>Pick up at the Pool Bar when ready.</span>
          </button>
          <button
            className={form.fulfillmentType === 'Delivery' ? 'choiceCard activeChoice' : 'choiceCard'}
            disabled={!deliveryAvailable}
            onClick={() => setField('fulfillmentType', 'Delivery')}
            type="button"
          >
            <strong>Delivery</strong>
            <span>{deliveryAvailable ? 'Delivered to your table. Table number is required.' : 'Currently unavailable. Please choose pickup.'}</span>
          </button>
        </div>
        {!deliveryAvailable && <div className="serviceNotice">Delivery is turned off by the pool bar today. Pickup orders are still available.</div>}
      </section>

      <section className="card">
        <div className="sectionKicker"><ShieldCheck size={15} /> Payment</div>
        <h2>How will this be paid?</h2>
        <div className="choiceGrid">
          <button
            className={form.paymentType === 'Member Account' ? 'choiceCard activeChoice' : 'choiceCard'}
            onClick={() => setField('paymentType', 'Member Account')}
            type="button"
          >
            <strong>Member Account</strong>
            <span>Charge this order to a verified member account.</span>
          </button>
          <button
            className={form.paymentType === 'Guest Pay at Pickup' ? 'choiceCard activeChoice guestChoice' : 'choiceCard guestChoice'}
            onClick={() => setField('paymentType', 'Guest Pay at Pickup')}
            type="button"
          >
            <strong>Guest - Pay at Pickup</strong>
            <span>A credit card must be provided at pickup before the order is released.</span>
          </button>
        </div>
      </section>

      <section className="card">
        <div className="sectionKicker"><UserRound size={15} /> {isGuestPayment ? 'Guest details' : 'Member details'}</div>
        <h2>{isGuestPayment ? 'Guest Information' : 'Member Information'}</h2>
        <label>{isGuestPayment ? 'Guest Name' : 'Member Name'}
          <input value={form.memberName} onChange={e => setField('memberName', e.target.value)} placeholder="First and last name" />
        </label>
        {!isGuestPayment && (
          <label>Member Number
            <input inputMode="numeric" maxLength="6" value={form.memberNumber} onChange={e => setField('memberNumber', e.target.value.replace(/\D/g, ''))} placeholder="4–6 digits" />
          </label>
        )}
        <label>Mobile Number
          <input inputMode="tel" value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="Example: 917-207-6562" />
          <span className="fieldHint">For staff to contact you if there is a question about your order.</span>
        </label>
        {form.fulfillmentType === 'Delivery' && (
          <label>Delivery Table Number
            <input inputMode="numeric" value={form.tableNumber} onChange={e => setField('tableNumber', e.target.value.replace(/\D/g, ''))} placeholder="1–100" />
            <span className="fieldHint">Required for delivery.</span>
          </label>
        )}
      </section>

      <section className="card">
        <div className="sectionTitle">
          <div>
            <div className="sectionKicker"><Utensils size={15} /> Browse & build</div>
            <h2>Menu</h2>
          </div>
          <span className="pill">{form.fulfillmentType}{form.tableNumber ? ` · Table ${form.tableNumber}` : ''}</span>
        </div>
        {categories.length ? (
          <>
            <CategorySelect categories={categories} active={activeCat} setActive={setActiveCat} />
            <CategoryTabs categories={categories} active={activeCat} setActive={setActiveCat} />
            <div className="menuList">
              {visibleItems.map(item => (
                <MenuItem
                  key={item.itemId}
                  item={item}
                  quantity={Number(quantities[item.itemId] || 0)}
                  setQuantity={(q) => setQuantities(prev => ({ ...prev, [item.itemId]: q }))}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState title="No menu available" body="Please check the MenuItems Google Sheet." />
        )}
      </section>

      <section className="card">
        <div className="sectionKicker"><ShoppingCart size={15} /> Custom drinks</div>
        <h2>Bar / Cocktail Request</h2>
        <p className="hint">Enter your bar or cocktail order exactly as you would tell the bartender.</p>
        <textarea
          rows="4"
          value={form.barRequest}
          onChange={e => setField('barRequest', e.target.value)}
          placeholder="Example: 2 Tito’s sodas with lime, 1 margarita, 1 bourbon rocks, 1 Transfusion"
        />
        <p className="finePrint">Custom bar requests will be priced according to standard club bar pricing and {isGuestPayment ? 'collected at pickup.' : 'charged to your member account.'}</p>
      </section>

      <section className="card">
        <div className="sectionTitle">
          <div>
            <div className="sectionKicker"><ShieldCheck size={15} /> Review & submit</div>
            <h2>Your Order</h2>
          </div>
          <span className="orderTotalPill">{selectedItems.length} item{selectedItems.length === 1 ? '' : 's'} · {currency(subtotal)}</span>
        </div>
        {selectedItems.length === 0 && !form.barRequest.trim() ? (
          <p className="hint">No items selected yet.</p>
        ) : (
          <div className="cartList">
            {selectedItems.map(item => (
              <div className="cartRow" key={item.itemId}>
                <span>{item.itemName} × {item.quantity}</span>
                <strong>{currency(Number(item.price) * Number(item.quantity))}</strong>
              </div>
            ))}
            {form.barRequest.trim() && (
              <div className="cartRow barRequest">
                <span>Bar Request: {form.barRequest}</span>
                <strong>Priced by bar</strong>
              </div>
            )}
            <div className="cartTotal">
              <span>Known subtotal</span>
              <strong>{currency(subtotal)}</strong>
            </div>
          </div>
        )}

        {showTipSection && (
          <div className="guestPaymentCheckout">
            <div className="sectionKicker"><ShieldCheck size={15} /> {isGuestPayment ? 'Guest payment' : 'Tip'}</div>
            <h3>{isGuestPayment ? 'Card at Pickup' : 'Add a Tip'}</h3>
            {isGuestPayment
              ? <p className="hint">No card number is collected online. Staff will collect the physical credit card at pickup or handoff.</p>
              : <p className="hint">Optional tip to add to the member account charge.</p>}
            {isGuestPayment && (
              <label>Card Type
                <div className="segmentedOptions">
                  {['Visa', 'Mastercard', 'Amex'].map(type => (
                    <button
                      key={type}
                      className={form.guestCardType === type ? 'segment active' : 'segment'}
                      onClick={() => setField('guestCardType', type)}
                      type="button"
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </label>
            )}
            <label>Tip <span className="optionalText">Optional</span>
              <div className="segmentedOptions">
                {[
                  { label: '18%', value: '18' },
                  { label: '20%', value: '20' },
                  { label: '22%', value: '22' },
                  { label: 'Custom', value: 'custom' },
                  { label: 'No Tip', value: '0' }
                ].map(option => (
                  <button
                    key={option.value}
                    className={form.tipChoice === option.value ? 'segment active' : 'segment'}
                    onClick={() => setField('tipChoice', option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </label>
            {form.tipChoice === 'custom' && (
              <label>Custom Tip
                <input inputMode="decimal" value={form.customTip} onChange={e => setField('customTip', e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
              </label>
            )}
            <div className="guestTotalBox">
              <span>Known subtotal</span><strong>{currency(subtotal)}</strong>
              <span>Tip</span><strong>{currency(checkoutTip.amount)}</strong>
              <span>{isGuestPayment ? 'Estimated total' : 'Total with tip'}</span><strong>{currency(checkoutTotal)}</strong>
            </div>
            {isGuestPayment && <div className="paymentDueNotice"><strong>Credit card required at pickup.</strong> Orders will not be released without the guest presenting a valid card to staff.</div>}
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={form.authorizationAccepted} onChange={e => setField('authorizationAccepted', e.target.checked)} />
          <span>{isGuestPayment
            ? 'I understand a valid credit card must be provided to staff at pickup or handoff before this guest order is released.'
            : 'I authorize this order to be charged to the member account listed above. I understand the club will verify the member number against its member list and may confirm my name at pickup or delivery.'}</span>
        </label>

        {hasAlcohol && (
          <label className="check alcoholCheck">
            <input type="checkbox" checked={form.alcoholVerificationAccepted} onChange={e => setField('alcoholVerificationAccepted', e.target.checked)} />
            <span>I understand alcoholic beverages must be picked up by a member or guest of legal drinking age and may require ID or member verification at pickup.</span>
          </label>
        )}

        <button className="primaryButton" onClick={submitOrder} disabled={submitting}>
          {submitting ? 'Sending Order...' : orderingOpen ? 'Submit Order' : 'Ordering Closed'}
        </button>
      </section>
    </div>
  );
}

function TruckOrderPage() {
  const savedConfirmation = readSavedTruckConfirmation();
  const [menu, setMenu] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statusError, setStatusError] = useState('');
  const [activeCat, setActiveCat] = useState('');
  const [quantities, setQuantities] = useState({});
  const [modifierSelections, setModifierSelections] = useState({});
  const [customizingItemId, setCustomizingItemId] = useState('');
  const [lookup, setLookup] = useState({
    orderId: getQueryParam('order') || '',
    memberNumber: savedConfirmation?.memberNumber || ''
  });
  const [form, setForm] = useState({
    paymentType: savedConfirmation?.paymentType || 'Member Account',
    guestCardType: savedConfirmation?.guestCardType || '',
    tipChoice: savedConfirmation?.tipChoice || '20',
    customTip: '',
    memberName: savedConfirmation?.memberName || '',
    memberNumber: savedConfirmation?.memberNumber || '',
    phone: '',
    specialInstructions: '',
    authorizationAccepted: false,
    alcoholVerificationAccepted: false
  });
  const [submitting, setSubmitting] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [confirmation, setConfirmation] = useState(savedConfirmation ? { orderId: savedConfirmation.orderId, chit: savedConfirmation.chit || null } : null);
  const [liveStatus, setLiveStatus] = useState(savedConfirmation?.status || '');
  const [readyAt, setReadyAt] = useState(savedConfirmation?.readyAt || '');

  useEffect(() => {
    async function load() {
      try {
        const [menuData, settingsData] = await Promise.all([
          apiGet('truckMenu'),
          apiGet('settings')
        ]);
        setMenu(menuData.items || []);
        setSettings(settingsData.settings || {});
        setActiveCat('All Items');
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const orderedTruckMenu = useMemo(() => [...menu].sort((a, b) => Number(a.sortOrder || 9999) - Number(b.sortOrder || 9999)), [menu]);
  const categories = useMemo(() => {
    const itemCategories = [...new Set(orderedTruckMenu.filter(i => i.available).map(i => i.category))];
    return itemCategories.length ? ['All Items', ...itemCategories] : [];
  }, [orderedTruckMenu]);
  const visibleItems = useMemo(() => {
    if (activeCat === 'All Items') return orderedTruckMenu.filter(i => i.available);
    return orderedTruckMenu.filter(i => i.available && i.category === activeCat);
  }, [orderedTruckMenu, activeCat]);
  const selectedItems = useMemo(() => orderedTruckMenu
    .filter(item => Number(quantities[item.itemId] || 0) > 0)
    .map(item => ({
      ...item,
      quantity: Number(quantities[item.itemId]),
      selectedModifiers: selectedModifierGroups(item, modifierSelections[item.itemId])
    })), [orderedTruckMenu, quantities, modifierSelections]);
  const subtotal = selectedItems.reduce((sum, item) => sum + orderItemLineTotal(item), 0);
  const truckHasAlcohol = selectedItems.some(item => item.alcoholic);
  const truckOrderingOpen = effectiveOrderingOpen(settings, 'TruckOrderingOpen', 'Truck');
  const isGuestPayment = form.paymentType === 'Guest Pay at Pickup';
  const memberTipsEnabled = settingEnabled(settings, 'TruckMemberTipsEnabled', true);
  const showTipSection = isGuestPayment || memberTipsEnabled;
  const checkoutTip = tipDetails(subtotal, form.tipChoice, form.customTip);
  const checkoutTotal = subtotal + checkoutTip.amount;
  const customizingItem = useMemo(() =>
    orderedTruckMenu.find(item => item.itemId === customizingItemId) || null,
    [orderedTruckMenu, customizingItemId]
  );

  function setField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function setLookupField(field, value) {
    setLookup(prev => ({ ...prev, [field]: value }));
  }

  function setItemModifier(itemId, groupName, value) {
    setModifierSelections(prev => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        [groupName]: value
      }
    }));
  }

  function setTruckItemQuantity(itemId, quantity) {
    const nextQuantity = Math.max(0, Number(quantity || 0));
    setQuantities(prev => ({ ...prev, [itemId]: nextQuantity }));
    if (nextQuantity === 0) {
      setModifierSelections(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }
  }

  function validateTruckOrder() {
    if (!truckOrderingOpen) return 'The Turn Truck ordering is currently closed.';
    if (!form.memberName.trim()) return isGuestPayment ? 'Please enter guest name.' : 'Please enter member name.';
    if (!isGuestPayment && !/^\d{4,6}$/.test(form.memberNumber.trim())) return 'Member number must be 4–6 digits.';
    if (!form.phone.trim()) return 'Please enter mobile number.';
    if (!selectedItems.length) return 'Please select at least one item.';
    for (const item of selectedItems) {
      const selectedByGroup = modifierSelections[item.itemId] || {};
      const missingGroup = modifierGroupsForItem(item).find(group => {
        if (!group.required) return false;
        const selected = selectedByGroup[group.name];
        return Array.isArray(selected) ? selected.length === 0 : !selected;
      });
      if (missingGroup) return `Please choose ${missingGroup.name} for ${item.itemName}.`;
    }
    if (!form.authorizationAccepted) {
      return isGuestPayment
        ? 'Please acknowledge that a physical credit card must be provided at pickup.'
        : 'Please authorize the charge to the member account.';
    }
    if (isGuestPayment && !form.guestCardType) return 'Please choose the card type you will provide at pickup.';
    if (truckHasAlcohol && !form.alcoholVerificationAccepted) return 'Please accept the alcohol verification notice.';
    return '';
  }

  async function submitTruckOrder() {
    const validation = validateTruckOrder();
    if (validation) {
      setErr(validation);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSubmitting(true);
    setErr('');
    try {
      const res = await apiPost('createTruckOrder', {
        order: {
          timestamp: todayISO(),
          paymentType: form.paymentType,
          paymentStatus: isGuestPayment ? 'Due at Pickup' : 'Member Account',
          guestCardType: isGuestPayment ? form.guestCardType : '',
          tipAmount: showTipSection ? checkoutTip.amount : 0,
          tipLabel: showTipSection ? checkoutTip.label : '',
          estimatedTotal: showTipSection ? checkoutTotal : subtotal,
          memberName: form.memberName.trim(),
          memberNumber: isGuestPayment ? '' : form.memberNumber.trim(),
          phone: form.phone.trim(),
          items: selectedItems.map(item => ({
            itemId: item.itemId,
            category: item.category,
            itemName: item.itemName,
            price: Number(item.price || 0),
            quantity: Number(item.quantity || 0),
            selectedModifiers: item.selectedModifiers || []
          })),
          subtotalKnownItems: subtotal,
          specialInstructions: form.specialInstructions.trim(),
          authorizationAccepted: form.authorizationAccepted,
          alcoholVerificationAccepted: form.alcoholVerificationAccepted
        }
      });
      const chit = {
        orderId: res.orderId,
        timestamp: todayISO(),
        fulfillmentType: 'Pickup',
        paymentType: form.paymentType,
        paymentStatus: isGuestPayment ? 'Due at Pickup' : 'Member Account',
        guestCardType: isGuestPayment ? form.guestCardType : '',
        tipAmount: showTipSection ? checkoutTip.amount : 0,
        tipLabel: showTipSection ? checkoutTip.label : '',
        estimatedTotal: showTipSection ? checkoutTotal : subtotal,
        memberName: form.memberName.trim(),
        memberNumber: isGuestPayment ? '' : form.memberNumber.trim(),
        items: selectedItems.map(item => ({
          itemId: item.itemId,
          category: item.category,
          itemName: item.itemName,
          price: Number(item.price || 0),
          quantity: Number(item.quantity || 0),
          selectedModifiers: item.selectedModifiers || []
        })),
        specialInstructions: form.specialInstructions.trim(),
        subtotalKnownItems: subtotal
      };
      const saved = {
        orderId: res.orderId,
        status: 'New',
        memberName: form.memberName.trim(),
        memberNumber: isGuestPayment ? '' : form.memberNumber.trim(),
        paymentType: form.paymentType,
        guestCardType: isGuestPayment ? form.guestCardType : '',
        tipChoice: showTipSection ? form.tipChoice : '0',
        chit
      };
      setConfirmation({ orderId: res.orderId, chit });
      setLiveStatus('New');
      sessionStorage.setItem(TRUCK_CONFIRMATION_KEY, JSON.stringify(saved));
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function lookupTruckOrder() {
    const orderId = String(lookup.orderId || '').trim();
    const memberNumber = String(lookup.memberNumber || '').trim();
    if (!/^\d{4,6}$/.test(memberNumber)) {
      setErr('Enter your 4–6 digit member number.');
      return;
    }
    setLookingUp(true);
    setErr('');
    try {
      const res = orderId
        ? await apiGet('truckOrderStatus', { orderId, memberNumber })
        : await apiGet('latestTruckOrderStatus', { memberNumber });
      const resolvedOrderId = res.orderId || orderId;
      const nextReadyAt = res.status === 'Ready for Pickup' || res.status === 'Completed'
        ? (res.updatedAt || res.completedAt || '')
        : '';
      const saved = {
        orderId: resolvedOrderId,
        status: res.status || 'New',
        memberNumber,
        memberName: res.memberName || '',
        paymentType: res.paymentType || 'Member Account',
        readyAt: nextReadyAt,
        chit: res.items || res.itemsSummary || res.subtotalKnownItems ? {
          orderId: resolvedOrderId,
          timestamp: res.timestamp || res.updatedAt || todayISO(),
          fulfillmentType: 'Pickup',
          memberName: res.memberName || '',
          paymentType: res.paymentType || 'Member Account',
          memberNumber,
          items: res.items || [],
          itemsSummary: res.itemsSummary || '',
          specialInstructions: res.specialInstructions || res.staffNotes || '',
          subtotalKnownItems: res.subtotalKnownItems || 0
        } : null
      };
      setForm(prev => ({ ...prev, memberName: saved.memberName || prev.memberName, memberNumber, paymentType: saved.paymentType }));
      setConfirmation({ orderId: resolvedOrderId, chit: saved.chit });
      setLiveStatus(saved.status);
      setReadyAt(nextReadyAt);
      sessionStorage.setItem(TRUCK_CONFIRMATION_KEY, JSON.stringify(saved));
    } catch (e) {
      setErr(e.message || 'Food truck order not found.');
    } finally {
      setLookingUp(false);
    }
  }

  useEffect(() => {
    if (!confirmation?.orderId || !form.memberNumber) return;
    async function pollStatus() {
      try {
        const res = await apiGet('truckOrderStatus', {
          orderId: confirmation.orderId,
          memberNumber: form.memberNumber.trim()
        });
        const nextStatus = res.status || '';
        const nextReadyAt = nextStatus === 'Ready for Pickup' || nextStatus === 'Completed'
          ? (res.updatedAt || res.completedAt || '')
          : '';
        setLiveStatus(nextStatus);
        setReadyAt(nextReadyAt);
        setStatusError('');
        const saved = readSavedTruckConfirmation();
        if (saved) sessionStorage.setItem(TRUCK_CONFIRMATION_KEY, JSON.stringify({ ...saved, status: nextStatus, readyAt: nextReadyAt }));
      } catch {
        setStatusError('Status is reconnecting. Keep this page open.');
      }
    }
    pollStatus();
    const id = setInterval(pollStatus, 8000);
    return () => clearInterval(id);
  }, [confirmation?.orderId, form.memberNumber]);

  if (loading) return <LoadingCard message="Loading truck menu..." />;

  if (confirmation) {
    const ready = ['Ready for Pickup', 'Completed'].includes(liveStatus);
    const memberStatus = memberTruckStatus(liveStatus || 'New');
    const chit = confirmation.chit || readSavedTruckConfirmation()?.chit;
    const confirmationIsGuest = form.paymentType === 'Guest Pay at Pickup' || chit?.paymentType === 'Guest Pay at Pickup';
    return (
      <div className="stack memberStack truckMember">
        {err && <div className="alert"><AlertTriangle size={18} />{err}</div>}
        <div className={ready ? 'card success statusCard readyCard' : 'card success statusCard'}>
          <div className="orderNumHeader truckOrderHeader">
            <span>Truck order confirmed</span>
            <strong>#{confirmation.orderId}</strong>
            <small>The Turn Truck</small>
          </div>
          <CheckCircle size={34} />
          <h2>{memberStatus}</h2>
          <p>{confirmationIsGuest ? 'Your guest order has been received. Staff will collect payment at pickup.' : 'Your order has been received. Please pick up your order at The Turn Truck when this screen shows Ready for Pickup.'}</p>
          {confirmationIsGuest && <div className="paymentDueNotice"><strong>Guest payment required at pickup.</strong> Staff will collect payment before handing off the order.</div>}
          <div className="statusPanel">
            <span>Current Status</span>
            <strong>{memberStatus}</strong>
            {readyAt && <em>Ready at {timeLabel(readyAt) || readyAt}</em>}
            {statusError && <small>{statusError}</small>}
          </div>
          <div className="memberStatusTrail" aria-label="Truck order status progress">
            {truckStatusSteps(liveStatus || 'New').map(step => (
              <div className={`memberStatusStep ${step.state}`} key={step.label}>
                <div className="memberStatusDot">{step.state === 'done' ? '✓' : ''}</div>
                <span>{step.label}</span>
              </div>
            ))}
          </div>
          <div className="notice pickupNotice">
            <strong>Pickup:</strong> The Turn Truck<br />
            Please keep this screen open. We will update this screen when your order is ready.
          </div>
        </div>
        <div className="confirmationActions">
          {chit && (
            <button className="secondaryButton" onClick={() => printCustomerChit(chit, setErr)} type="button">
              <Printer size={16} /> Print Customer Chit
            </button>
          )}
          <button className="primaryButton" onClick={() => { clearSavedTruckConfirmation(); window.location.reload(); }} type="button">
            <Home size={16} /> Home / New Truck Order
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack memberStack truckMember">
      {err && <div className="alert"><AlertTriangle size={18} />{err}</div>}
      {!truckOrderingOpen && <div className="serviceBanner closed"><AlertTriangle size={18} /> The Turn Truck ordering is currently closed.</div>}

      <section className="card hero memberHero truckHero truckHeroWithCart">
        <div>
          <p className="eyebrow">{settings.ClubName || 'Eastpointe Country Club'}</p>
          <h2>The Turn Truck</h2>
          <p>Order from the golf course. Members can charge their account, and guests can pay at pickup.</p>
        </div>
        <div className="truckHeroCartWrap" aria-hidden="true">
          <img src="/turn-truck-golf-cart.png" alt="" className="truckHeroCart" />
        </div>
      </section>

      <section className="card">
        <div className="sectionKicker"><ShieldCheck size={15} /> Payment</div>
        <h2>How will this be paid?</h2>
        <div className="choiceGrid">
          <button
            className={form.paymentType === 'Member Account' ? 'choiceCard activeChoice' : 'choiceCard'}
            onClick={() => setField('paymentType', 'Member Account')}
            type="button"
          >
            <strong>Member Account</strong>
            <span>Charge this order to a verified member account.</span>
          </button>
          <button
            className={form.paymentType === 'Guest Pay at Pickup' ? 'choiceCard activeChoice guestChoice' : 'choiceCard guestChoice'}
            onClick={() => setField('paymentType', 'Guest Pay at Pickup')}
            type="button"
          >
            <strong>Guest - Pay at Pickup</strong>
            <span>A credit card must be provided at pickup before the order is released.</span>
          </button>
        </div>
      </section>

      <section className="card">
        <div className="sectionKicker"><UserRound size={15} /> {isGuestPayment ? 'Guest details' : 'Member details'}</div>
        <h2>{isGuestPayment ? 'Guest Information' : 'Member Information'}</h2>
        <label>{isGuestPayment ? 'Guest Name' : 'Member Name'}
          <input value={form.memberName} onChange={event => setField('memberName', event.target.value)} placeholder="First and last name" />
        </label>
        {!isGuestPayment && (
          <label>Member Number
            <input inputMode="numeric" maxLength="6" value={form.memberNumber} onChange={event => setField('memberNumber', event.target.value.replace(/\D/g, ''))} placeholder="4–6 digits" />
          </label>
        )}
        <label>Mobile Number
          <input inputMode="tel" value={form.phone} onChange={event => setField('phone', event.target.value)} placeholder="Example: 917-207-6562" />
          <span className="fieldHint">Required so truck staff can contact you if there is a question.</span>
        </label>
        <div className="notice dietaryNotice">
          <strong>Dietary & Allergy Note</strong>
          Please include any allergies or dietary restrictions in the special instructions field at checkout. While our team will do its best to accommodate requests, The Turn Truck may handle common allergens and cannot guarantee an allergen-free preparation environment.
        </div>
      </section>

      <section className="card">
        <div className="sectionTitle">
          <div>
            <div className="sectionKicker"><Utensils size={15} /> The turn menu</div>
            <h2>Food Truck Menu</h2>
            <p className="hint">Use the + button to add items to your order.</p>
          </div>
          <span className="pill">Pickup only</span>
        </div>
        {categories.length ? (
          <>
            <CategorySelect categories={categories} active={activeCat} setActive={setActiveCat} />
            <CategoryTabs categories={categories} active={activeCat} setActive={setActiveCat} />
            <div className="menuList">
              {visibleItems.map(item => (
                <TruckMenuItem
                  key={item.itemId}
                  item={item}
                  quantity={Number(quantities[item.itemId] || 0)}
                  onQuickAdd={() => setTruckItemQuantity(item.itemId, Number(quantities[item.itemId] || 0) + 1)}
                  onQuantityChange={(quantity) => setTruckItemQuantity(item.itemId, quantity)}
                  onCustomize={() => setCustomizingItemId(item.itemId)}
                  modifierSelections={modifierSelections[item.itemId] || {}}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState title="No truck menu available" body="Please add items to the TruckMenuItems Google Sheet." />
        )}
      </section>

      {customizingItem && (
        <TruckItemCustomizer
          item={customizingItem}
          quantity={Number(quantities[customizingItem.itemId] || 0)}
          modifierSelections={modifierSelections[customizingItem.itemId] || {}}
          setModifierSelection={(groupName, value) => setItemModifier(customizingItem.itemId, groupName, value)}
          setQuantity={(quantity) => setTruckItemQuantity(customizingItem.itemId, quantity)}
          onClose={() => setCustomizingItemId('')}
        />
      )}

      <section className="card">
        <div className="sectionTitle">
          <div>
            <div className="sectionKicker"><ShieldCheck size={15} /> Review & submit</div>
            <h2>Your Truck Order</h2>
          </div>
          <span className="orderTotalPill">{selectedItems.length} item{selectedItems.length === 1 ? '' : 's'} · {currency(subtotal)}</span>
        </div>
        {selectedItems.length === 0 ? (
          <p className="hint">No items selected yet.</p>
        ) : (
          <div className="cartList">
            {selectedItems.map(item => (
              <div className="cartRow" key={item.itemId}>
                <span>
                  {item.itemName} × {item.quantity}
                  {modifierSummaryLines(item).map(line => <small key={line}>{line}</small>)}
                </span>
                <strong>{currency(orderItemLineTotal(item))}</strong>
              </div>
            ))}
            <div className="cartTotal">
              <span>Known subtotal</span>
              <strong>{currency(subtotal)}</strong>
            </div>
          </div>
        )}

        {showTipSection && (
          <div className="guestPaymentCheckout">
            <div className="sectionKicker"><ShieldCheck size={15} /> {isGuestPayment ? 'Guest payment' : 'Tip'}</div>
            <h3>{isGuestPayment ? 'Card at Pickup' : 'Add a Tip'}</h3>
            {isGuestPayment
              ? <p className="hint">No card number is collected online. Staff will collect the physical credit card at pickup.</p>
              : <p className="hint">Optional tip to add to the member account charge.</p>}
            {isGuestPayment && (
              <label>Card Type
                <div className="segmentedOptions">
                  {['Visa', 'Mastercard', 'Amex'].map(type => (
                    <button
                      key={type}
                      className={form.guestCardType === type ? 'segment active' : 'segment'}
                      onClick={() => setField('guestCardType', type)}
                      type="button"
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </label>
            )}
            <label>Tip <span className="optionalText">Optional</span>
              <div className="segmentedOptions">
                {[
                  { label: '18%', value: '18' },
                  { label: '20%', value: '20' },
                  { label: '22%', value: '22' },
                  { label: 'Custom', value: 'custom' },
                  { label: 'No Tip', value: '0' }
                ].map(option => (
                  <button
                    key={option.value}
                    className={form.tipChoice === option.value ? 'segment active' : 'segment'}
                    onClick={() => setField('tipChoice', option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </label>
            {form.tipChoice === 'custom' && (
              <label>Custom Tip
                <input inputMode="decimal" value={form.customTip} onChange={event => setField('customTip', event.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
              </label>
            )}
            <div className="guestTotalBox">
              <span>Known subtotal</span><strong>{currency(subtotal)}</strong>
              <span>Tip</span><strong>{currency(checkoutTip.amount)}</strong>
              <span>{isGuestPayment ? 'Estimated total' : 'Total with tip'}</span><strong>{currency(checkoutTotal)}</strong>
            </div>
            {isGuestPayment && <div className="paymentDueNotice"><strong>Credit card required at pickup.</strong> Orders will not be released without the guest presenting a valid card to staff.</div>}
          </div>
        )}

        <label>Special Instructions <span className="optionalText">Optional</span>
          <textarea
            value={form.specialInstructions}
            onChange={event => setField('specialInstructions', event.target.value)}
            placeholder="Allergies, dietary restrictions, or preparation notes"
            rows="3"
          />
        </label>

        <label className="check">
          <input type="checkbox" checked={form.authorizationAccepted} onChange={event => setField('authorizationAccepted', event.target.checked)} />
          <span>{isGuestPayment
            ? 'I understand a valid credit card must be provided to staff at pickup before this guest order is released.'
            : 'I authorize this food truck order to be charged to the member account listed above.'}</span>
        </label>

        {truckHasAlcohol && (
          <label className="check alcoholCheck">
            <input type="checkbox" checked={form.alcoholVerificationAccepted} onChange={event => setField('alcoholVerificationAccepted', event.target.checked)} />
            <span>I confirm alcoholic items will be picked up by a member or guest of legal drinking age, and ID/member verification may be required.</span>
          </label>
        )}

        <button className="primaryButton" onClick={submitTruckOrder} disabled={submitting}>
          {submitting ? 'Sending Order...' : truckOrderingOpen ? 'Submit Truck Order' : 'Ordering Closed'}
        </button>
      </section>

      <section className="card statusLookupCard">
        <div className="sectionKicker"><ClipboardList size={15} /> Already ordered?</div>
        <h2>Check Truck Order</h2>
        <p className="hint">Enter your member number. Order number is optional if you have it.</p>
        <div className="lookupGrid">
          <label>Order Number <span className="optionalText">Optional</span>
            <input inputMode="numeric" value={lookup.orderId} onChange={event => setLookupField('orderId', event.target.value.replace(/\D/g, ''))} placeholder="Example: 5001" />
          </label>
          <label>Member Number
            <input inputMode="numeric" maxLength="6" value={lookup.memberNumber} onChange={event => setLookupField('memberNumber', event.target.value.replace(/\D/g, ''))} placeholder="4–6 digits" />
          </label>
        </div>
        <button className="ghostLookupButton" onClick={lookupTruckOrder} disabled={lookingUp}>{lookingUp ? 'Checking...' : 'Check Status'}</button>
      </section>
    </div>
  );
}

function Login({ onLogin, onBack, title = 'Staff Dashboard', body = 'Enter the staff password to view orders.', backLabel = 'Back to Order', loginFunction = 'admin-login' }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function handle() {
    if (!pw.trim()) {
      setErr('Please enter the staff password.');
      return;
    }
    setSubmitting(true);
    setErr('');
    try {
      const res = await adminFunction(loginFunction, {
        method: 'POST',
        body: JSON.stringify({ password: pw })
      });
      onLogin(res.token);
    } catch (e) {
      setErr(e.message || 'Incorrect password.');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="card login">
      <Lock size={28} />
      <h2>{title}</h2>
      <p>{body}</p>
      {err && <div className="alert">{err}</div>}
      <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Staff password" onKeyDown={e => e.key === 'Enter' && handle()} />
      <button className="primaryButton" onClick={handle} disabled={submitting}>{submitting ? 'Opening...' : 'Open Dashboard'}</button>
      <button className="backToOrderButton" onClick={onBack} type="button">{backLabel}</button>
    </div>
  );
}

function AdminPage({ onBackToOrder }) {
  const [loggedIn, setLoggedIn] = useState(Boolean(getAdminToken()));
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [settings, setSettings] = useState({});
  const [menuItems, setMenuItems] = useState([]);
  const [updatingSetting, setUpdatingSetting] = useState('');
  const [updatingMenuItem, setUpdatingMenuItem] = useState('');
  const [newOrderAlert, setNewOrderAlert] = useState(false);
  const [activeStationId, setActiveStationId] = useState('all');
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundError, setSoundError] = useState('');

  async function handleEnableSound() {
    try {
      await enableNotificationSound();
      setSoundEnabled(true);
      setSoundError('');
    } catch (e) {
      setSoundError(e.message || 'Unable to enable sound on this device.');
    }
  }

  async function loadOrders() {
    setLoading(true);
    try {
      const [ordersRes, settingsRes, menuRes] = await Promise.all([
        adminFunction('admin-orders', {
          headers: { Authorization: `Bearer ${getAdminToken()}` }
        }),
        apiGet('settings'),
        apiGet('menu')
      ]);
      const res = ordersRes;
      const nextOrders = res.orders || [];
      setOrders(prevOrders => {
        const previousIds = new Set(prevOrders.map(order => String(order.orderId)));
        const hasNewOrder = prevOrders.length > 0 && nextOrders.some(order =>
          order.status === 'New' && !previousIds.has(String(order.orderId))
        );
        if (hasNewOrder) {
          setNewOrderAlert(true);
          playNewOrderSound();
          setTimeout(() => setNewOrderAlert(false), 5000);
        }
        return nextOrders;
      });
      setSettings(settingsRes.settings || {});
      setMenuItems(menuRes.items || []);
      setLastUpdated(new Date().toLocaleTimeString());
      setErr('');
    } catch (e) {
      setErr(e.message);
      if (String(e.message || '').toLowerCase().includes('session')) {
        clearAdminToken();
        setLoggedIn(false);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!loggedIn) return;
    loadOrders();
    const id = setInterval(loadOrders, 8000);
    return () => clearInterval(id);
  }, [loggedIn]);

  async function updateStatus(orderId, status) {
    if (status === 'Cancelled' && !window.confirm(`Cancel order #${orderId}?`)) return;
    setUpdatingStatus({ orderId, status });
    try {
      await adminFunction('admin-update-status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ orderId, status })
      });
      await loadOrders();
    } catch (e) {
      setErr(e.message);
      if (String(e.message || '').toLowerCase().includes('session')) {
        clearAdminToken();
        setLoggedIn(false);
      }
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function updateStationStatus(orderId, station, status) {
    setUpdatingStatus({ orderId, station, status });
    try {
      await adminFunction('admin-update-station-status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ orderId, station, status })
      });
      await loadOrders();
    } catch (e) {
      setErr(e.message);
      if (String(e.message || '').toLowerCase().includes('session')) {
        clearAdminToken();
        setLoggedIn(false);
      }
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function updatePosPosted(orderId, posted) {
    setUpdatingStatus({ orderId, posPosted: posted });
    try {
      await adminFunction('admin-update-pos-posted', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ orderId, posted, postedBy: 'Pool Staff' })
      });
      await loadOrders();
    } catch (e) {
      setErr(e.message);
      if (String(e.message || '').toLowerCase().includes('session')) {
        clearAdminToken();
        setLoggedIn(false);
      }
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function updateSetting(key, value) {
    setUpdatingSetting(key);
    setErr('');
    const previousSettings = settings;
    setSettings(prev => ({ ...prev, [key]: value }));
    try {
      const res = await adminFunction('admin-update-setting', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({
          key,
          value
        })
      });
      if (res.settings) setSettings(res.settings);
    } catch (e) {
      setSettings(previousSettings);
      setErr(e.message);
      if (String(e.message || '').toLowerCase().includes('session')) {
        clearAdminToken();
        setLoggedIn(false);
      }
    } finally {
      setUpdatingSetting('');
    }
  }

  async function updateMenuAvailability(itemId, available) {
    setUpdatingMenuItem(itemId);
    setErr('');
    const previousMenuItems = menuItems;
    setMenuItems(prev => prev.map(item => item.itemId === itemId ? { ...item, available } : item));
    try {
      const res = await adminFunction('admin-update-menu-availability', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ itemId, available })
      });
      if (res.items) setMenuItems(res.items);
    } catch (e) {
      setMenuItems(previousMenuItems);
      setErr(e.message);
      if (String(e.message || '').toLowerCase().includes('session')) {
        clearAdminToken();
        setLoggedIn(false);
      }
    } finally {
      setUpdatingMenuItem('');
    }
  }

  function updateOrderingOpen(nextOpen) {
    updateSetting('OrderingOpen', nextOpen ? 'TRUE' : 'FALSE');
  }

  function updateDeliveryAvailability(nextAvailable) {
    updateSetting('DeliveryAvailable', nextAvailable ? 'TRUE' : 'FALSE');
  }

  function printOrder(order) {
    const w = window.open('', '_blank');
    if (!w) {
      setErr('Pop-up blocked. Please allow pop-ups to print tickets.');
      return;
    }
    w.document.write(`
      <html><head><title>Order ${order.orderId}</title>
      <style>body{font-family:Arial,sans-serif;padding:20px} h1{font-size:22px} pre{white-space:pre-wrap;font-size:16px}</style>
      </head><body>
      <h1>Order #${order.orderId}</h1>
      <pre>${formatOrder(order)}</pre>
      </body></html>
    `);
    w.document.close();
    w.print();
  }

  function formatOrder(order) {
    const guestPayment = isGuestOrder(order);
    return [
      `Status: ${order.status}`,
      `Time: ${order.timestamp}`,
      `Service: ${order.fulfillmentType || 'Pickup'}`,
      `Table: ${order.tableNumber || '—'}`,
      `${guestPayment ? 'Guest' : 'Member'}: ${order.memberName}`,
      guestPayment ? `Payment: GUEST PAYMENT REQUIRED AT PICKUP` : `Member #: ${order.memberNumber}`,
      `Phone: ${order.phone}`,
      ``,
      `Items:`,
      `${order.itemsSummary || ''}`,
      order.barRequest ? `\nBar / Cocktail Request:\n${order.barRequest}` : '',
      ``,
      `Known Subtotal: ${currency(order.subtotalKnownItems)}`,
      guestPayment ? `Payment Status: ${order.paymentStatus || 'Due at Pickup'}` : '',
      guestPayment ? `Card Type: ${order.guestCardType || 'Not selected'}` : '',
      Number(order.tipAmount || 0) > 0 ? `Tip: ${order.tipLabel || 'Custom'} (${currency(order.tipAmount)})` : '',
      Number(order.tipAmount || 0) > 0 || guestPayment ? `${guestPayment ? 'Estimated Total' : 'Total with Tip'}: ${currency(order.estimatedTotal || Number(order.subtotalKnownItems || 0) + Number(order.tipAmount || 0))}` : '',
      `Alcohol: ${order.alcoholIncluded ? 'YES' : 'No'}`,
      `POS Posted: ${order.posPosted ? 'YES' : 'No'}`
    ].join('\n');
  }

  if (!loggedIn) {
    return <Login onLogin={(token) => { setAdminToken(token); setLoggedIn(true); }} onBack={onBackToOrder} />;
  }

  const activeCount = orders.filter(o => !['Completed', 'Cancelled'].includes(o.status)).length;
  const cancelledCount = orders.filter(o => o.status === 'Cancelled' && isOrderToday(o)).length;
  const needsPosCount = orders.filter(o => o.status === 'Completed' && !o.posPosted && isOrderToday(o)).length;
  const needsPosTotal = orders
    .filter(o => o.status === 'Completed' && !o.posPosted && isOrderToday(o))
    .reduce((sum, order) => sum + Number(order.subtotalKnownItems || 0), 0);
  const todaysCompletedOrders = orders.filter(o => o.status === 'Completed' && isOrderToday(o));
  const todaysPostedCount = todaysCompletedOrders.filter(o => o.posPosted).length;
  const todaysAlcoholCount = orders.filter(o => o.alcoholIncluded && isOrderToday(o) && o.status !== 'Cancelled').length;
  const todaysDeliveryCount = orders.filter(o => o.fulfillmentType === 'Delivery' && isOrderToday(o) && o.status !== 'Cancelled').length;
  const todaysTipOrders = tipOrdersToday(orders);
  const todaysTipTotal = sumTips(todaysTipOrders);
  const todaysTipPostedTotal = sumTips(todaysTipOrders.filter(order => order.posPosted));
  const todaysTipOpenTotal = sumTips(todaysTipOrders.filter(order => !order.posPosted));
  const menuItemsByCategory = menuItems.reduce((groups, item) => {
    const category = item.category || 'Other';
    if (!groups[category]) groups[category] = [];
    groups[category].push(item);
    return groups;
  }, {});
  const subtotalToday = orders
    .filter(o => o.status !== 'Cancelled' && isOrderToday(o))
    .reduce((sum, order) => sum + Number(order.subtotalKnownItems || 0), 0);
  const orderingOpen = effectiveOrderingOpen(settings, 'OrderingOpen', '');
  const deliveryAvailable = settingEnabled(settings, 'DeliveryAvailable', true);
  const memberTipsEnabled = settingEnabled(settings, 'MemberTipsEnabled', true);
  const orderingScheduleEnabled = settingEnabled(settings, 'OrderingScheduleEnabled', true);
  const orderingOpenTime = timeInputValue(settings, 'OrderingOpenTime', '08:30');
  const orderingCloseTime = timeInputValue(settings, 'OrderingCloseTime', '16:30');
  const activeStation = STATION_TABS.find(tab => tab.id === activeStationId) || STATION_TABS[0];
  const boardColumns = activeStation.id === 'all' ? ALL_ORDER_COLUMNS : STATION_COLUMNS;
  const statOrders = activeStation.id === 'all'
    ? orders
    : orders.filter(order => hasStationRoute(order, activeStation.route) && order.status !== 'Cancelled');
  const statStatus = order => activeStation.id === 'all' ? order.status : stationStatus(order, activeStation);
  const newCount = statOrders.filter(order => statStatus(order) === 'New' && !['Completed', 'Cancelled'].includes(order.status)).length;
  const preparingCount = statOrders.filter(order => ['Accepted', 'Preparing'].includes(statStatus(order)) && !['Completed', 'Cancelled'].includes(order.status)).length;
  const readyCount = statOrders.filter(order => (activeStation.id === 'all' ? order.status === 'Ready for Pickup' : statStatus(order) === 'Ready') && !['Completed', 'Cancelled'].includes(order.status)).length;
  const completedCount = statOrders.filter(order => {
    if (!isOrderToday(order)) return false;
    return activeStation.id === 'all' ? order.status === 'Completed' : statStatus(order) === 'Completed' && order.status !== 'Cancelled';
  }).length;
  const stationTabCounts = STATION_TABS.reduce((counts, tab) => {
    if (tab.id === 'all') {
      counts[tab.id] = activeCount;
    } else {
      counts[tab.id] = orders.filter(order =>
        hasStationRoute(order, tab.route) &&
        !['Completed', 'Cancelled'].includes(order.status) &&
        stationStatus(order, tab) !== 'Completed'
      ).length;
    }
    return counts;
  }, {});

  function ordersForColumn(column) {
    return orders.filter(order => {
      const visibleStatus = activeStation.id === 'all' ? order.status : stationStatus(order, activeStation);
      if (activeStation.id !== 'all' && !hasStationRoute(order, activeStation.route)) return false;
      if (activeStation.id !== 'all' && column.id !== 'Completed' && ['Completed', 'Cancelled'].includes(order.status)) return false;
      if (activeStation.id !== 'all' && column.id === 'Completed' && order.status === 'Cancelled') return false;
      if (!column.statuses.includes(visibleStatus)) return false;
      return !column.todayOnly || isOrderToday(order);
    });
  }

  function emptyColumnLabel(column) {
    if (column.id === 'Active') return 'No active orders';
    return `No ${column.title.toLowerCase()} orders`;
  }

  function stationPrimaryAction(status) {
    const stationName = activeStation.title;
    if (status === 'New') return { label: activeStation.id === 'wait' ? 'Start Handoff' : `Start ${stationName}`, status: 'Preparing' };
    if (status === 'Preparing') return { label: activeStation.id === 'wait' ? 'Mark Handoff Ready' : `Mark ${stationName} Ready`, status: 'Ready' };
    if (status === 'Ready') return { label: activeStation.id === 'wait' ? 'Complete Handoff' : `Complete ${stationName}`, status: 'Completed' };
    return null;
  }

  function renderStationBadges(order) {
    const routes = stationRoutes(order);
    if (!routes.length) return null;
    return (
      <div className="stationBadges">
        {routes.map(route => {
          const tab = STATION_TABS.find(item => item.route === route);
          const status = stationStatus(order, tab);
          return <span key={`${order.orderId}-${route}`}>{route}: {status}</span>;
        })}
      </div>
    );
  }

  function renderOrderCard(order, tone) {
    const action = activeStation.id === 'all' ? null : stationPrimaryAction(stationStatus(order, activeStation));
    const isUpdating = updatingStatus?.orderId === order.orderId;
    const stationTime = activeStation.id === 'all' ? '' : order[activeStation.updatedKey];
    const serviceLabel = order.fulfillmentType === 'Delivery' && order.tableNumber
      ? `Delivery · Table ${order.tableNumber}`
      : order.fulfillmentType === 'Delivery'
        ? 'Delivery'
        : order.tableNumber
          ? `Pickup · Table ${order.tableNumber}`
          : 'Pickup at Bar';
    const lines = itemLines(order);
    const guestPayment = isGuestOrder(order);

    return (
      <article className={`staffOrderCard ${tone}${order.alcoholIncluded ? ' alcoholOrder' : ''}`} key={order.orderId}>
        <div className="staffOrderHead">
          <strong>#{order.orderId}</strong>
          <span>{ageLabel(order.timestamp || order.updatedAt)}</span>
        </div>
        <div className="staffOrderMember">
          <h3>{order.memberName || 'Member'}</h3>
          <div className="staffMemberLine">
            <span>{guestPayment ? 'Guest payment due' : `Member #${order.memberNumber}`}{order.phone ? ` · ${displayPhone(order.phone)}` : ''}</span>
            {order.phone && <a href={`tel:${String(order.phone).replace(/\D/g, '')}`} aria-label={`Call ${order.memberName || 'member'}`}><Phone size={16} /></a>}
          </div>
          <div className={order.fulfillmentType === 'Delivery' ? 'serviceBadge delivery' : 'serviceBadge'}>{serviceLabel}</div>
          {guestPayment && <div className="paymentDueBadge">Collect {order.guestCardType || 'card'} at pickup · Tip {order.tipLabel || 'No tip'}</div>}
          {!guestPayment && Number(order.tipAmount || 0) > 0 && <div className="paymentDueBadge tipBadge">Tip {order.tipLabel || 'Custom'} · {currency(order.tipAmount)}</div>}
        </div>

        <div className="staffItems">
          {lines.length ? lines.map((line, index) => <p key={`${order.orderId}-${index}`}>{line}</p>) : <p>No standard items.</p>}
        </div>

        {order.barRequest && (
          <div className="barRequestBox">
            <span>Bar Request</span>
            <p>{order.barRequest}</p>
          </div>
        )}

        {order.alcoholIncluded && (
          <div className="alcoholStaffBanner">
            <AlertTriangle size={15} />
            Alcohol order: verify member age/ID at pickup or handoff.
          </div>
        )}

        {renderStationBadges(order)}

        <div className="staffOrderFoot">
          <strong>{currency(order.subtotalKnownItems)}{order.hasCustomBarRequest ? ' + bar' : ''}</strong>
          <span className={order.alcoholIncluded ? 'alcoholPill' : ''}>{order.alcoholIncluded ? 'Alcohol' : 'No alcohol'}</span>
        </div>
        <div className="staffTimeLine">
          <span>{order.updatedAt ? `Updated ${timeLabel(order.updatedAt) || order.updatedAt}` : `Placed ${timeLabel(order.timestamp) || order.timestamp}`}</span>
          {stationTime && <span>{activeStation.title} {timeLabel(stationTime) || stationTime}</span>}
          {order.completedAt && <span>Completed {timeLabel(order.completedAt) || order.completedAt}</span>}
        </div>

        <div className="staffActions">
          {action && activeStation.id === 'all' && (
            <button className="staffPrimaryAction" onClick={() => updateStatus(order.orderId, action.status)} disabled={isUpdating}>
              {isUpdating && updatingStatus?.status === action.status ? 'Updating...' : action.label}
            </button>
          )}
          {action && activeStation.id !== 'all' && (
            <button className="staffPrimaryAction" onClick={() => updateStationStatus(order.orderId, activeStation.station, action.status)} disabled={isUpdating}>
              {isUpdating && updatingStatus?.station === activeStation.station && updatingStatus?.status === action.status ? 'Updating...' : action.label}
            </button>
          )}
          {order.status !== 'Completed' && order.status !== 'Cancelled' && (
            <button className="staffSecondaryAction" onClick={() => updateStatus(order.orderId, 'Cancelled')} disabled={isUpdating}>Cancel</button>
          )}
          {order.status === 'Completed' && (
            <div className={order.posPosted ? 'postedBadge posted' : 'postedBadge needsPosting'}>
              {order.posPosted ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
              <span>
                {order.posPosted ? 'Posted to POS' : 'Needs POS Posting'} · {currency(order.subtotalKnownItems)}
                {order.posPostedAt ? ` · ${timeLabel(order.posPostedAt) || order.posPostedAt}` : ''}
              </span>
            </div>
          )}
          {order.status === 'Completed' && (
            <button className="staffSecondaryAction" onClick={() => updatePosPosted(order.orderId, !order.posPosted)} disabled={isUpdating}>
              {isUpdating && updatingStatus?.posPosted !== undefined
                ? 'Saving...'
                : order.posPosted ? 'Undo POS Posted' : 'Mark POS Posted'}
            </button>
          )}
          {order.status === 'Completed' && (
            <button className="staffSecondaryAction" onClick={() => updateStatus(order.orderId, 'Ready for Pickup')} disabled={isUpdating}>
              <Undo2 size={15} /> Reopen
            </button>
          )}
          {order.status === 'Cancelled' && (
            <button className="staffSecondaryAction" onClick={() => updateStatus(order.orderId, 'New')} disabled={isUpdating}>
              <Undo2 size={15} /> Restore
            </button>
          )}
          <button className="staffPrintButton" onClick={() => printOrder(order)}><Printer size={16} /> Ticket</button>
          <button className="staffPrintButton" onClick={() => printCustomerChit(order, setErr)}><Printer size={16} /> Customer Chit</button>
        </div>
      </article>
    );
  }

  return (
    <div className="staffDashboard">
      <section className="staffDashboardHero">
        <div className="staffHeroBrand">
          <img src="/eastpointe-logo-tight.png" alt="Eastpointe Country Club" className="staffHeroLogo" />
          <div>
            <h2>Eastpointe Pool Bar — Staff Dashboard</h2>
            <p>{shortDate()} · Logged in as Pool Staff</p>
          </div>
        </div>
        <div className="staffHeroControls">
          <span className="refreshStatus"><span></span> Auto-refreshing</span>
          <button
            className={soundEnabled ? 'staffSoundButton on' : 'staffSoundButton'}
            onClick={handleEnableSound}
            type="button"
            title="Tap once on this device so new orders can make a sound"
          >
            <Volume2 size={18} /> {soundEnabled ? 'Sound On' : 'Enable Sound'}
          </button>
          <button
            className={orderingOpen ? 'staffToggleButton on' : 'staffToggleButton off'}
            onClick={() => updateOrderingOpen(!orderingOpen)}
            disabled={Boolean(updatingSetting)}
            title="Turn member ordering on or off"
          >
            {updatingSetting === 'OrderingOpen' ? 'Saving...' : orderingOpen ? 'Ordering Open' : 'Ordering Closed'}
          </button>
          <button
            className={deliveryAvailable ? 'staffToggleButton on' : 'staffToggleButton off'}
            onClick={() => updateDeliveryAvailability(!deliveryAvailable)}
            disabled={Boolean(updatingSetting)}
            title="Turn member delivery ordering on or off"
          >
            <Truck size={18} /> {updatingSetting === 'DeliveryAvailable' ? 'Saving...' : deliveryAvailable ? 'Delivery On' : 'Pickup Only'}
          </button>
          <button
            className={memberTipsEnabled ? 'staffToggleButton on' : 'staffToggleButton off'}
            onClick={() => updateSetting('MemberTipsEnabled', memberTipsEnabled ? 'FALSE' : 'TRUE')}
            disabled={Boolean(updatingSetting)}
            title="Show or hide member tip options"
          >
            {updatingSetting === 'MemberTipsEnabled' ? 'Saving...' : memberTipsEnabled ? 'Tips On' : 'Tips Off'}
          </button>
          <button
            className={orderingScheduleEnabled ? 'staffToggleButton on' : 'staffToggleButton off'}
            onClick={() => updateSetting('OrderingScheduleEnabled', orderingScheduleEnabled ? 'FALSE' : 'TRUE')}
            disabled={Boolean(updatingSetting)}
            title="Use automatic ordering hours"
          >
            {updatingSetting === 'OrderingScheduleEnabled' ? 'Saving...' : orderingScheduleEnabled ? 'Schedule On' : 'Schedule Off'}
          </button>
          <label className="scheduleField">Open
            <input type="time" value={orderingOpenTime} onChange={event => updateSetting('OrderingOpenTime', event.target.value)} disabled={Boolean(updatingSetting)} />
          </label>
          <label className="scheduleField">Close
            <input type="time" value={orderingCloseTime} onChange={event => updateSetting('OrderingCloseTime', event.target.value)} disabled={Boolean(updatingSetting)} />
          </label>
          <button className="staffRefreshButton" onClick={loadOrders} disabled={loading}><RefreshCcw className={loading ? 'spin' : ''} size={18} /> Refresh</button>
          <button className="staffOrderPageButton" onClick={() => { clearAdminToken(); setLoggedIn(false); }}>Sign out</button>
          <strong>{activeCount} active orders</strong>
        </div>
      </section>

      {err && <div className="alert staffAlert"><AlertTriangle size={18} />{err}</div>}
      {soundError && <div className="alert staffAlert"><AlertTriangle size={18} />{soundError}</div>}
      {newOrderAlert && <div className="staffNewOrderAlert"><AlertTriangle size={18} /> New order received</div>}

      <section className="stationTabs" aria-label="Staff station views">
        {STATION_TABS.map(tab => {
          const Icon = tab.Icon;
          return (
            <button
              key={tab.id}
              className={activeStation.id === tab.id ? `stationTab ${tab.id} active` : `stationTab ${tab.id}`}
              onClick={() => setActiveStationId(tab.id)}
            >
              <Icon size={18} />
              <span>{tab.title}</span>
              <strong>{stationTabCounts[tab.id] || 0}</strong>
            </button>
          );
        })}
      </section>

      <section className="staffStats">
        <div className="staffStat new"><strong>{newCount}</strong><span>New orders waiting</span></div>
        <div className="staffStat preparing"><strong>{preparingCount}</strong><span>Being prepared</span></div>
        <div className="staffStat ready"><strong>{readyCount}</strong><span>Ready / delivering</span></div>
        <div className="staffStat completed"><strong>{completedCount}</strong><span>Completed today</span></div>
        <div className="staffStat pos"><strong>{needsPosCount}</strong><span>Need POS posting · {currency(needsPosTotal)}</span></div>
        <div className="staffStat cancelled"><strong>{cancelledCount}</strong><span>Cancelled today</span></div>
        <div className="staffStat revenue"><strong>{currency(subtotalToday)}</strong><span>Today's menu subtotal</span></div>
      </section>

      <section className={activeStation.id === 'all' ? 'staffBoard' : 'staffBoard stationBoard'}>
        {boardColumns.map(column => {
          const columnOrders = ordersForColumn(column);
          return (
            <div className={`staffColumn ${column.tone}`} key={column.id}>
              <div className="staffColumnHead">
                <h3>{column.title}</h3>
                <span>{columnOrders.length}</span>
              </div>
              <div className="staffColumnBody">
                {columnOrders.length
                  ? columnOrders.map(order => renderOrderCard(order, column.tone))
                  : <div className="staffEmpty">{emptyColumnLabel(column)}</div>}
              </div>
            </div>
          );
        })}
      </section>

      <section className="managerPanels">
        <div className="managerPanel">
          <div className="managerPanelHead">
            <h3>End-of-Day Reconciliation</h3>
            <span>{shortDate()}</span>
          </div>
          <div className="closingGrid">
            <div><strong>{todaysCompletedOrders.length}</strong><span>Completed</span></div>
            <div><strong>{todaysPostedCount}</strong><span>POS posted</span></div>
            <div className={needsPosCount ? 'attention' : ''}><strong>{needsPosCount}</strong><span>Need POS posting</span></div>
            <div><strong>{currency(subtotalToday)}</strong><span>Subtotal</span></div>
            <div><strong>{todaysAlcoholCount}</strong><span>Alcohol orders</span></div>
            <div><strong>{todaysDeliveryCount}</strong><span>Deliveries</span></div>
          </div>
          <div className="tipReconciliation">
            <div className="tipReconciliationHead">
              <h4>Tip Reconciliation</h4>
              <strong>{currency(todaysTipTotal)}</strong>
            </div>
            <div className="tipSummaryGrid">
              <div><strong>{todaysTipOrders.length}</strong><span>Tip orders</span></div>
              <div><strong>{currency(todaysTipPostedTotal)}</strong><span>POS posted tips</span></div>
              <div className={todaysTipOpenTotal ? 'attention' : ''}><strong>{currency(todaysTipOpenTotal)}</strong><span>Open tips</span></div>
            </div>
            <div className="tipOrderList">
              {todaysTipOrders.length
                ? todaysTipOrders.map(order => (
                  <div className="tipOrderRow" key={`tip-${order.orderId}`}>
                    <span>#{order.orderId} · {order.memberName || 'Guest'} · {order.guestCardType || 'Card'}</span>
                    <strong>{currency(order.tipAmount)}</strong>
                    <small>{order.posPosted ? 'POS posted' : 'Needs posting'}</small>
                  </div>
                ))
                : <p>No tips recorded today.</p>}
            </div>
          </div>
          {needsPosCount > 0
            ? <p className="closingNote">Closing check: mark all completed orders as POS posted before end of shift.</p>
            : <p className="closingNote good">POS reconciliation is clear for completed orders.</p>}
        </div>

        <div className="managerPanel">
          <div className="managerPanelHead">
            <h3>Menu Availability</h3>
            <span>{menuItems.filter(item => !item.available).length} unavailable</span>
          </div>
          <div className="menuAvailabilityList">
            {Object.entries(menuItemsByCategory).map(([category, items]) => (
              <div className="menuAvailabilityGroup" key={category}>
                <div className="menuAvailabilityGroupHead">
                  <strong>{category}</strong>
                  <span>{items.filter(item => !item.available).length} sold out</span>
                </div>
                {items.map(item => (
                  <div className={item.available ? 'menuAvailabilityItem' : 'menuAvailabilityItem unavailable'} key={item.itemId}>
                    <div>
                      <strong>{item.itemName}</strong>
                      <span>{currency(item.price)}</span>
                    </div>
                    <button
                      className={item.available ? 'availabilityButton available' : 'availabilityButton unavailable'}
                      onClick={() => updateMenuAvailability(item.itemId, !item.available)}
                      disabled={updatingMenuItem === item.itemId}
                    >
                      {updatingMenuItem === item.itemId ? 'Saving...' : item.available ? 'Available' : 'Sold Out'}
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function TruckAdminPage({ onBackToOrder }) {
  const [loggedIn, setLoggedIn] = useState(Boolean(getTruckToken()));
  const [orders, setOrders] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [settings, setSettings] = useState({});
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [updatingSetting, setUpdatingSetting] = useState('');
  const [updatingMenuItem, setUpdatingMenuItem] = useState('');
  const [newOrderAlert, setNewOrderAlert] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundError, setSoundError] = useState('');

  async function handleEnableSound() {
    try {
      await enableNotificationSound();
      setSoundEnabled(true);
      setSoundError('');
    } catch (e) {
      setSoundError(e.message || 'Unable to enable sound on this device.');
    }
  }

  async function loadTruckOrders() {
    setLoading(true);
    try {
      const [ordersRes, settingsRes, menuRes] = await Promise.all([
        adminFunction('truck-orders', {
          headers: { Authorization: `Bearer ${getTruckToken()}` }
        }),
        apiGet('settings'),
        apiGet('truckMenu')
      ]);
      const nextOrders = ordersRes.orders || [];
      setOrders(prevOrders => {
        const previousIds = new Set(prevOrders.map(order => String(order.orderId)));
        const hasNewOrder = prevOrders.length > 0 && nextOrders.some(order =>
          order.status === 'New' && !previousIds.has(String(order.orderId))
        );
        if (hasNewOrder) {
          setNewOrderAlert(true);
          playNewOrderSound();
          setTimeout(() => setNewOrderAlert(false), 5000);
        }
        return nextOrders;
      });
      setSettings(settingsRes.settings || {});
      setMenuItems(menuRes.items || []);
      setErr('');
    } catch (e) {
      setErr(e.message);
      if (String(e.message || '').toLowerCase().includes('session')) {
        clearTruckToken();
        setLoggedIn(false);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!loggedIn) return;
    loadTruckOrders();
    const id = setInterval(loadTruckOrders, 8000);
    return () => clearInterval(id);
  }, [loggedIn]);

  async function updateTruckStatus(orderId, status) {
    if (status === 'Cancelled' && !window.confirm(`Cancel truck order #${orderId}?`)) return;
    setUpdatingStatus({ orderId, status });
    try {
      await adminFunction('truck-update-status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getTruckToken()}` },
        body: JSON.stringify({ orderId, status })
      });
      await loadTruckOrders();
    } catch (e) {
      setErr(e.message);
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function updateTruckPosPosted(orderId, posted) {
    setUpdatingStatus({ orderId, posPosted: posted });
    try {
      await adminFunction('truck-update-pos-posted', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getTruckToken()}` },
        body: JSON.stringify({ orderId, posted, postedBy: 'Truck Staff' })
      });
      await loadTruckOrders();
    } catch (e) {
      setErr(e.message);
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function updateTruckSetting(key, value) {
    setUpdatingSetting(key);
    const previousSettings = settings;
    setSettings(prev => ({ ...prev, [key]: value }));
    try {
      const res = await adminFunction('truck-update-setting', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getTruckToken()}` },
        body: JSON.stringify({ key, value })
      });
      if (res.settings) setSettings(res.settings);
    } catch (e) {
      setSettings(previousSettings);
      setErr(e.message);
    } finally {
      setUpdatingSetting('');
    }
  }

  function updateTruckOrderingOpen(nextOpen) {
    updateTruckSetting('TruckOrderingOpen', nextOpen ? 'TRUE' : 'FALSE');
  }

  async function updateTruckMenuAvailability(itemId, available) {
    setUpdatingMenuItem(itemId);
    const previousMenuItems = menuItems;
    setMenuItems(prev => prev.map(item => item.itemId === itemId ? { ...item, available } : item));
    try {
      const res = await adminFunction('truck-update-menu-availability', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getTruckToken()}` },
        body: JSON.stringify({ itemId, available })
      });
      if (res.items) setMenuItems(res.items);
    } catch (e) {
      setMenuItems(previousMenuItems);
      setErr(e.message);
    } finally {
      setUpdatingMenuItem('');
    }
  }

  function truckOrdersForColumn(column) {
    return orders.filter(order => {
      if (!column.statuses.includes(order.status)) return false;
      return !column.todayOnly || isOrderToday(order);
    });
  }

  function truckAction(order) {
    if (order.status === 'New') return { label: 'Acknowledge Order', status: 'Acknowledged' };
    if (order.status === 'Acknowledged') return { label: 'Ready for Pick Up', status: 'Ready for Pickup' };
    if (order.status === 'Ready for Pickup') return { label: 'Complete', status: 'Completed' };
    return null;
  }

  function renderTruckOrderCard(order, tone) {
    const action = truckAction(order);
    const isUpdating = updatingStatus?.orderId === order.orderId;
    const guestPayment = isGuestOrder(order);
    return (
      <article className={`staffOrderCard truckOrderCard ${tone}${order.alcoholIncluded ? ' alcoholOrder' : ''}`} key={order.orderId}>
        <div className="staffOrderHead">
          <strong>#{order.orderId}</strong>
          <span>{ageLabel(order.timestamp || order.updatedAt)}</span>
        </div>
        <div className="staffOrderMember">
          <h3>{order.memberName || 'Member'}</h3>
          <div className="staffMemberLine">
            <span>{guestPayment ? 'Guest payment due' : `Member #${order.memberNumber}`}{order.phone ? ` · ${displayPhone(order.phone)}` : ''}</span>
            {order.phone && <a href={`tel:${String(order.phone).replace(/\D/g, '')}`} aria-label={`Call ${order.memberName || 'member'}`}><Phone size={16} /></a>}
          </div>
          {guestPayment && <div className="paymentDueBadge">Collect {order.guestCardType || 'card'} at pickup · Tip {order.tipLabel || 'No tip'}</div>}
          {!guestPayment && Number(order.tipAmount || 0) > 0 && <div className="paymentDueBadge tipBadge">Tip {order.tipLabel || 'Custom'} · {currency(order.tipAmount)}</div>}
        </div>
        <div className="staffItems">
          {itemLines(order).map((line, index) => <p key={`${order.orderId}-${index}`}>{line}</p>)}
        </div>
        {order.staffNotes && (
          <div className="barRequestBox">
            <span>Special Instructions</span>
            <p>{order.staffNotes}</p>
          </div>
        )}
        {order.alcoholIncluded && (
          <div className="alcoholStaffBanner">
            <AlertTriangle size={15} />
            Alcohol order: verify member age/ID at pickup.
          </div>
        )}
        <div className="staffOrderFoot">
          <strong>{currency(order.subtotalKnownItems)}</strong>
          <span className={order.alcoholIncluded ? 'alcoholPill' : ''}>{order.alcoholIncluded ? 'Alcohol' : 'Truck order'}</span>
        </div>
        <div className="staffTimeLine">
          <span>{order.updatedAt ? `Updated ${timeLabel(order.updatedAt) || order.updatedAt}` : `Placed ${timeLabel(order.timestamp) || order.timestamp}`}</span>
          {order.completedAt && <span>Completed {timeLabel(order.completedAt) || order.completedAt}</span>}
        </div>
        <div className="staffActions">
          {action && (
            <button className="staffPrimaryAction" onClick={() => updateTruckStatus(order.orderId, action.status)} disabled={isUpdating}>
              {isUpdating && updatingStatus?.status === action.status ? 'Updating...' : action.label}
            </button>
          )}
          {order.status !== 'Completed' && order.status !== 'Cancelled' && (
            <button className="staffSecondaryAction" onClick={() => updateTruckStatus(order.orderId, 'Cancelled')} disabled={isUpdating}>Cancel</button>
          )}
          {order.status === 'Completed' && (
            <div className={order.posPosted ? 'postedBadge posted' : 'postedBadge needsPosting'}>
              {order.posPosted ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
              <span>{order.posPosted ? 'Posted to POS' : 'Needs POS Posting'} · {currency(order.subtotalKnownItems)}</span>
            </div>
          )}
          {order.status === 'Completed' && (
            <button className="staffSecondaryAction" onClick={() => updateTruckPosPosted(order.orderId, !order.posPosted)} disabled={isUpdating}>
              {isUpdating && updatingStatus?.posPosted !== undefined ? 'Saving...' : order.posPosted ? 'Undo POS Posted' : 'Mark POS Posted'}
            </button>
          )}
          {order.status === 'Completed' && (
            <button className="staffSecondaryAction" onClick={() => updateTruckStatus(order.orderId, 'Ready for Pickup')} disabled={isUpdating}>
              <Undo2 size={15} /> Reopen
            </button>
          )}
          {order.status === 'Cancelled' && (
            <button className="staffSecondaryAction" onClick={() => updateTruckStatus(order.orderId, 'New')} disabled={isUpdating}>
              <Undo2 size={15} /> Restore
            </button>
          )}
          <button className="staffPrintButton" onClick={() => printCustomerChit(order, setErr)}><Printer size={16} /> Customer Chit</button>
        </div>
      </article>
    );
  }

  if (!loggedIn) {
    return (
      <Login
        title="Truck Staff"
        body="Enter the truck staff password to view orders."
        backLabel="Back to Truck Ordering"
        loginFunction="truck-login"
        onLogin={(token) => { setTruckToken(token); setLoggedIn(true); }}
        onBack={onBackToOrder}
      />
    );
  }

  const truckOrderingOpen = effectiveOrderingOpen(settings, 'TruckOrderingOpen', 'Truck');
  const truckMemberTipsEnabled = settingEnabled(settings, 'TruckMemberTipsEnabled', true);
  const truckScheduleEnabled = settingEnabled(settings, 'TruckOrderingScheduleEnabled', true);
  const truckOpenTime = timeInputValue(settings, 'TruckOrderingOpenTime', '08:30');
  const truckCloseTime = timeInputValue(settings, 'TruckOrderingCloseTime', '16:30');
  const activeCount = orders.filter(order => !['Completed', 'Cancelled'].includes(order.status)).length;
  const readyCount = orders.filter(order => order.status === 'Ready for Pickup').length;
  const completedToday = orders.filter(order => order.status === 'Completed' && isOrderToday(order)).length;
  const postedToday = orders.filter(order => order.status === 'Completed' && order.posPosted && isOrderToday(order)).length;
  const needsPosCount = orders.filter(order => order.status === 'Completed' && !order.posPosted && isOrderToday(order)).length;
  const needsPosTotal = orders
    .filter(order => order.status === 'Completed' && !order.posPosted && isOrderToday(order))
    .reduce((sum, order) => sum + Number(order.subtotalKnownItems || 0), 0);
  const todaysTipOrders = tipOrdersToday(orders);
  const todaysTipTotal = sumTips(todaysTipOrders);
  const todaysTipPostedTotal = sumTips(todaysTipOrders.filter(order => order.posPosted));
  const todaysTipOpenTotal = sumTips(todaysTipOrders.filter(order => !order.posPosted));
  const subtotalToday = orders
    .filter(order => order.status !== 'Cancelled' && isOrderToday(order))
    .reduce((sum, order) => sum + Number(order.subtotalKnownItems || 0), 0);
  const menuItemsByCategory = menuItems.reduce((groups, item) => {
    const category = item.category || 'Other';
    if (!groups[category]) groups[category] = [];
    groups[category].push(item);
    return groups;
  }, {});

  return (
    <div className="staffDashboard truckDashboard">
      <section className="staffDashboardHero truckStaffHero">
        <div className="staffHeroBrand">
          <img src="/eastpointe-logo-tight.png" alt="Eastpointe Country Club" className="staffHeroLogo" />
          <div>
            <h2>The Turn Truck — Staff Dashboard</h2>
            <p>{shortDate()} · Logged in as Truck Staff</p>
          </div>
        </div>
        <div className="staffHeroControls">
          <span className="refreshStatus"><span></span> Auto-refreshing</span>
          <button
            className={soundEnabled ? 'staffSoundButton on' : 'staffSoundButton'}
            onClick={handleEnableSound}
            type="button"
            title="Tap once on this device so new truck orders can make a sound"
          >
            <Volume2 size={18} /> {soundEnabled ? 'Sound On' : 'Enable Sound'}
          </button>
          <button
            className={truckOrderingOpen ? 'staffToggleButton on' : 'staffToggleButton off'}
            onClick={() => updateTruckOrderingOpen(!truckOrderingOpen)}
            disabled={Boolean(updatingSetting)}
          >
            {updatingSetting === 'TruckOrderingOpen' ? 'Saving...' : truckOrderingOpen ? 'Truck Ordering Open' : 'Truck Ordering Closed'}
          </button>
          <button
            className={truckMemberTipsEnabled ? 'staffToggleButton on' : 'staffToggleButton off'}
            onClick={() => updateTruckSetting('TruckMemberTipsEnabled', truckMemberTipsEnabled ? 'FALSE' : 'TRUE')}
            disabled={Boolean(updatingSetting)}
            title="Show or hide member tip options"
          >
            {updatingSetting === 'TruckMemberTipsEnabled' ? 'Saving...' : truckMemberTipsEnabled ? 'Tips On' : 'Tips Off'}
          </button>
          <button
            className={truckScheduleEnabled ? 'staffToggleButton on' : 'staffToggleButton off'}
            onClick={() => updateTruckSetting('TruckOrderingScheduleEnabled', truckScheduleEnabled ? 'FALSE' : 'TRUE')}
            disabled={Boolean(updatingSetting)}
            title="Use automatic truck ordering hours"
          >
            {updatingSetting === 'TruckOrderingScheduleEnabled' ? 'Saving...' : truckScheduleEnabled ? 'Schedule On' : 'Schedule Off'}
          </button>
          <label className="scheduleField">Open
            <input type="time" value={truckOpenTime} onChange={event => updateTruckSetting('TruckOrderingOpenTime', event.target.value)} disabled={Boolean(updatingSetting)} />
          </label>
          <label className="scheduleField">Close
            <input type="time" value={truckCloseTime} onChange={event => updateTruckSetting('TruckOrderingCloseTime', event.target.value)} disabled={Boolean(updatingSetting)} />
          </label>
          <button className="staffRefreshButton" onClick={loadTruckOrders} disabled={loading}><RefreshCcw className={loading ? 'spin' : ''} size={18} /> Refresh</button>
          <button className="staffOrderPageButton" onClick={() => { clearTruckToken(); setLoggedIn(false); }}>Sign out</button>
          <strong>{activeCount} active orders</strong>
        </div>
      </section>

      {err && <div className="alert staffAlert"><AlertTriangle size={18} />{err}</div>}
      {soundError && <div className="alert staffAlert"><AlertTriangle size={18} />{soundError}</div>}
      {newOrderAlert && <div className="staffNewOrderAlert"><AlertTriangle size={18} /> New truck order received</div>}

      <section className="staffStats truckStats">
        <div className="staffStat new"><strong>{activeCount}</strong><span>Active truck orders</span></div>
        <div className="staffStat ready"><strong>{readyCount}</strong><span>Ready for pickup</span></div>
        <div className="staffStat completed"><strong>{completedToday}</strong><span>Completed today</span></div>
        <div className="staffStat pos"><strong>{needsPosCount}</strong><span>Need POS posting · {currency(needsPosTotal)}</span></div>
        <div className="staffStat revenue"><strong>{currency(subtotalToday)}</strong><span>Truck subtotal</span></div>
      </section>

      <section className="staffBoard truckBoard">
        {TRUCK_COLUMNS.map(column => {
          const columnOrders = truckOrdersForColumn(column);
          return (
            <div className={`staffColumn ${column.tone}`} key={column.id}>
              <div className="staffColumnHead">
                <h3>{column.title}</h3>
                <span>{columnOrders.length}</span>
              </div>
              <div className="staffColumnBody">
                {columnOrders.length
                  ? columnOrders.map(order => renderTruckOrderCard(order, column.tone))
                  : <div className="staffEmpty">No {column.title.toLowerCase()} orders</div>}
              </div>
            </div>
          );
        })}
      </section>

      <section className="managerPanels">
        <div className="managerPanel">
          <div className="managerPanelHead">
            <h3>Truck POS Reconciliation</h3>
            <span>{shortDate()}</span>
          </div>
          <p className="managerHint">At pickup, collect card payment, complete the order, then mark POS posted after it is entered in the register.</p>
          <div className="closingGrid">
            <div><strong>{completedToday}</strong><span>Completed</span></div>
            <div><strong>{postedToday}</strong><span>POS posted</span></div>
            <div className={needsPosCount ? 'attention' : ''}><strong>{needsPosCount}</strong><span>Need POS posting</span></div>
            <div><strong>{currency(subtotalToday)}</strong><span>Subtotal</span></div>
          </div>
          <div className="tipReconciliation">
            <div className="tipReconciliationHead">
              <h4>Tip Reconciliation</h4>
              <strong>{currency(todaysTipTotal)}</strong>
            </div>
            <div className="tipSummaryGrid">
              <div><strong>{todaysTipOrders.length}</strong><span>Tip orders</span></div>
              <div><strong>{currency(todaysTipPostedTotal)}</strong><span>POS posted tips</span></div>
              <div className={todaysTipOpenTotal ? 'attention' : ''}><strong>{currency(todaysTipOpenTotal)}</strong><span>Open tips</span></div>
            </div>
            <div className="tipOrderList">
              {todaysTipOrders.length
                ? todaysTipOrders.map(order => (
                  <div className="tipOrderRow" key={`truck-tip-${order.orderId}`}>
                    <span>#{order.orderId} · {order.memberName || 'Guest'} · {order.guestCardType || 'Card'}</span>
                    <strong>{currency(order.tipAmount)}</strong>
                    <small>{order.posPosted ? 'POS posted' : 'Needs posting'}</small>
                  </div>
                ))
                : <p>No tips recorded today.</p>}
            </div>
          </div>
          {needsPosCount > 0
            ? <p className="closingNote">Closing check: mark all completed truck orders as POS posted.</p>
            : <p className="closingNote good">Truck POS reconciliation is clear.</p>}
        </div>

        <div className="managerPanel">
          <div className="managerPanelHead">
            <h3>Truck Menu Availability</h3>
            <span>{menuItems.filter(item => !item.available).length} unavailable</span>
          </div>
          <p className="managerHint">Tap an item button to mark it sold out or available again.</p>
          <div className="menuAvailabilityList">
            {Object.entries(menuItemsByCategory).map(([category, items]) => (
              <div className="menuAvailabilityGroup" key={category}>
                <div className="menuAvailabilityGroupHead">
                  <strong>{category}</strong>
                  <span>{items.filter(item => !item.available).length} sold out</span>
                </div>
                {items.map(item => (
                  <div className={item.available ? 'menuAvailabilityItem' : 'menuAvailabilityItem unavailable'} key={item.itemId}>
                    <div>
                      <strong>{item.itemName}</strong>
                      <span>{currency(item.price)}</span>
                    </div>
                    <button
                      className={item.available ? 'availabilityButton available' : 'availabilityButton unavailable'}
                      onClick={() => updateTruckMenuAvailability(item.itemId, !item.available)}
                      disabled={updatingMenuItem === item.itemId}
                    >
                      {updatingMenuItem === item.itemId ? 'Saving...' : item.available ? 'Available' : 'Sold Out'}
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function OperationsGuide() {
  const links = [
    {
      title: 'Pool Member Ordering',
      body: 'Member-facing pool bar ordering page.',
      href: `${PUBLIC_BASE_URL}/order`,
      Icon: ShoppingCart,
      type: 'member'
    },
    {
      title: 'Pool Staff Dashboard',
      body: 'Bar, kitchen, wait station, availability, and POS reconciliation.',
      href: `${PUBLIC_BASE_URL}/admin`,
      Icon: ClipboardList,
      type: 'staff'
    },
    {
      title: 'Turn Truck Ordering',
      body: 'Member-facing pickup-only ordering for golfers at the turn.',
      href: `${PUBLIC_BASE_URL}/truck`,
      Icon: Truck,
      type: 'member'
    },
    {
      title: 'Truck Staff Dashboard',
      body: 'Truck order flow, sold-out controls, and POS reconciliation.',
      href: `${PUBLIC_BASE_URL}/truck-admin`,
      Icon: ChefHat,
      type: 'staff'
    }
  ];

  const backendLinks = [
    { title: 'Menu & Member Update Sheet', href: GOOGLE_SHEET_URL, detail: 'Menus, member numbers, settings, and order logs' },
    { title: 'Netlify Deploys', href: NETLIFY_DEPLOYS_URL, detail: 'Live site publishing status' }
  ];

  return (
    <div className="opsGuide">
      <section className="opsHero">
        <div className="opsHeroBrand">
          <img src="/eastpointe-logo-tight.png" alt="Eastpointe Country Club" />
          <div>
            <p className="eyebrow">Eastpointe Country Club</p>
            <h1>Ordering Operations Guide</h1>
            <p>A simple staff-friendly guide for running pool and Turn Truck ordering.</p>
          </div>
        </div>
        <div className="opsMotifs" aria-label="Ordering highlights">
          <span><Flag size={15} /> Golf course ready</span>
          <span><QrCode size={15} /> QR ordering</span>
          <span><TableProperties size={15} /> Sheet-managed</span>
        </div>
      </section>

      <section className="opsSection">
        <div className="opsSectionHead">
          <div>
            <p className="sectionKicker"><QrCode size={15} /> QR-ready links</p>
            <h2>Front-End & Staff Links</h2>
          </div>
          <p>Use these for QR codes, training, iPads, and manager bookmarks.</p>
        </div>
        <div className="opsLinkGrid">
          {links.map(({ title, body, href, Icon, type }) => (
            <article className={`opsLinkCard ${type === 'staff' ? 'staffArea' : ''}`} key={title}>
              <div className="opsLinkIcon"><Icon size={22} /></div>
              <div>
                {type === 'staff' && <span className="opsStaffBadge">Staff area</span>}
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
              <img className="opsQr" src={qrUrl(href)} alt={`${title} QR code`} />
              <a href={href} target="_blank" rel="noreferrer">Open link <ExternalLink size={14} /></a>
            </article>
          ))}
        </div>
      </section>

      <section className="opsSection opsTwoCol">
        <div className="opsPanel">
          <p className="sectionKicker"><BookOpen size={15} /> Simple backend</p>
          <h2>Best Staff Workflow</h2>
          <div className="opsSteps">
            <div><strong>1</strong><span>Use the staff dashboards during service to open or close ordering and mark items sold out.</span></div>
            <div><strong>2</strong><span>Use the Google Sheet for bigger menu edits: item names, prices, categories, sort order, and member numbers.</span></div>
            <div><strong>3</strong><span>Use Orders and TruckOrders as the permanent log for reviewing completed orders and POS reconciliation.</span></div>
          </div>
        </div>

        <div className="opsPanel opsRolesPanel">
          <p className="sectionKicker"><Users size={15} /> Staff roles</p>
          <h2>Who Does What</h2>
          <div className="opsRolesGrid">
            <div>
              <h3>Managers / Admin</h3>
              <ul>
                <li>Update menu items and prices</li>
                <li>Add or deactivate member numbers</li>
                <li>Review order logs</li>
                <li>Handle POS reconciliation</li>
              </ul>
            </div>
            <div className="serviceRole">
              <h3>Service Staff</h3>
              <ul>
                <li>Open or close ordering</li>
                <li>Mark sold-out items</li>
                <li>Complete orders</li>
                <li>Mark POS posted</li>
              </ul>
            </div>
            <div className="doNotEditRole">
              <h3>Do Not Edit During Service</h3>
              <ul>
                <li>Menu rows</li>
                <li>Member list</li>
                <li>Pricing</li>
                <li>Sort order</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="opsSection">
        <div className="opsPanel ownerToolsPanel">
          <p className="sectionKicker"><ExternalLink size={15} /> Backend links</p>
          <h2>Owner Tools</h2>
          <div className="opsBackendLinks">
            {backendLinks.map(link => (
              <a href={link.href} target="_blank" rel="noreferrer" key={link.title}>
                <strong>{link.title}</strong>
                <span>{link.detail}</span>
                <ExternalLink size={16} />
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="opsSection">
        <div className="opsSectionHead">
          <div>
            <p className="sectionKicker"><PencilLine size={15} /> Updating data</p>
            <h2>Menu & Member Updates</h2>
          </div>
        </div>
        <div className="opsInfoGrid">
          <article>
            <h3>Menu Items</h3>
            <p>For pool menu edits, use the <strong>MenuItems</strong> tab. For Turn Truck menu edits, use <strong>TruckMenuItems</strong>.</p>
            <ul>
              <li><strong>Bulk upload</strong>: paste new rows into the Sheet from a CSV or spreadsheet export.</li>
              <li><strong>Available</strong>: TRUE shows the item; FALSE hides it.</li>
              <li><strong>Alcoholic</strong>: TRUE triggers the age/ID warning.</li>
              <li><strong>SortOrder</strong>: controls the order members see.</li>
            </ul>
          </article>
          <article>
            <h3>Member Numbers</h3>
            <p>Use the <strong>Members</strong> tab as the allowed-member list.</p>
            <ul>
              <li>Add one member number per row.</li>
              <li>Use <strong>Active</strong> for allowed accounts.</li>
              <li>Use <strong>Inactive</strong> to block ordering without deleting history.</li>
            </ul>
          </article>
          <article>
            <h3>Daily Service</h3>
            <p>Use dashboards instead of the Sheet while service is live.</p>
            <ul>
              <li>Toggle ordering open or closed.</li>
              <li>Mark sold-out items without touching rows.</li>
              <li>Complete orders and mark POS posted at closing.</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="opsFooterCard">
        <img src="/eastpointe-logo-tight.png" alt="" />
        <div>
          <h2>Recommended setup</h2>
          <p>Print QR codes for member ordering, bookmark staff dashboards on iPads, and keep menu/member edits inside the Google Sheet. This keeps the system simple, low-cost, and easy for club staff to maintain.</p>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const initialMode = window.location.pathname.includes('/truck-admin')
    ? 'truck-admin'
    : window.location.pathname.includes('/operations-guide')
      ? 'operations-guide'
      : window.location.pathname.includes('/truck')
        ? 'truck'
        : window.location.pathname.includes('/admin')
          ? 'admin'
          : 'order';
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    const path = mode === 'admin'
      ? '/admin'
      : mode === 'truck-admin'
        ? '/truck-admin'
        : mode === 'operations-guide'
          ? '/operations-guide'
          : mode === 'truck'
            ? '/truck' + window.location.search
            : '/order' + window.location.search;
    window.history.replaceState(null, '', path);
  }, [mode]);

  const isTruckMode = mode === 'truck' || mode === 'truck-admin';
  const mainClass = mode === 'admin' || mode === 'truck-admin'
    ? 'app adminApp'
    : mode === 'operations-guide'
      ? 'app opsApp'
      : 'app';
  return (
    <main className={mainClass}>
      <AppErrorBoundary key={mode}>
        {mode === 'operations-guide' && <OperationsGuide />}
        {mode === 'order' && <Header mode={mode} setMode={setMode} />}
        {isTruckMode && mode !== 'truck-admin' && <TruckHeader mode={mode} setMode={setMode} />}
        {mode === 'admin' && <AdminPage onBackToOrder={() => setMode('order')} />}
        {mode === 'truck-admin' && <TruckAdminPage onBackToOrder={() => setMode('truck')} />}
        {mode === 'truck' && <TruckOrderPage />}
        {mode === 'order' && <OrderPage />}
        {mode !== 'admin' && mode !== 'truck-admin' && <footer>Members charge account. Guests pay staff at pickup. No online payment processing.</footer>}
      </AppErrorBoundary>
    </main>
  );
}
