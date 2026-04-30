
import React, { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, ClipboardList, RefreshCcw, Printer, Lock, CheckCircle, AlertTriangle, Phone, MapPin, Utensils, UserRound, ShieldCheck, Undo2, Truck, Wine, ChefHat, Users } from 'lucide-react';

const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL || '';
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || '';
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'poolstaff';
const API_TIMEOUT_MS = 12000;
const API_RETRIES = 2;
const CONFIRMATION_KEY = 'eastpointeLastConfirmation';
const ADMIN_TOKEN_KEY = 'eastpointeAdminToken';

const STAFF_COLUMNS = [
  { id: 'New', title: 'New', statuses: ['New'], tone: 'new' },
  { id: 'Preparing', title: 'Preparing', statuses: ['Accepted', 'Preparing'], tone: 'preparing' },
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

function currency(value) {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
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
    return order.items.map(item => `${item.quantity || 1}x ${item.itemName}`).slice(0, 5);
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
  if (name === 'admin-login') {
    const body = JSON.parse(options.body || '{}');
    if (String(body.password || '') !== ADMIN_PASSWORD) {
      throw new Error('Incorrect password.');
    }
    return { ok: true, token: `local-dev.${Date.now() + 4 * 60 * 60 * 1000}` };
  }

  if (!getAdminToken()) {
    throw new Error('Staff session expired. Please sign in again.');
  }

  if (!ADMIN_KEY) {
    throw new Error('Missing VITE_ADMIN_KEY. Add your Apps Script admin key to local environment variables.');
  }

  if (name === 'admin-orders') {
    return apiGet('orders', { adminKey: ADMIN_KEY });
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

function setAdminToken(token) {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

function clearAdminToken() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

function readSavedConfirmation() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CONFIRMATION_KEY) || 'null');
    if (!saved?.orderId || !saved?.memberNumber) return null;
    return saved;
  } catch {
    return null;
  }
}

function clearSavedConfirmation() {
  sessionStorage.removeItem(CONFIRMATION_KEY);
}

function playNewOrderSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.24);
    setTimeout(() => ctx.close(), 300);
  } catch {
    // Some browsers block notification sounds until user interaction.
  }
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

function MenuItem({ item, quantity, setQuantity }) {
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
      </div>
      <div className="qty">
        <button disabled={!item.available || quantity <= 0} onClick={() => setQuantity(Math.max(0, quantity - 1))}>−</button>
        <span>{quantity}</span>
        <button disabled={!item.available} onClick={() => setQuantity(quantity + 1)}>+</button>
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
    pickupLocation: savedConfirmation.pickupLocation || 'Pool Bar'
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
  const orderingOpen = settingEnabled(settings, 'OrderingOpen', true);
  const deliveryAvailable = settingEnabled(settings, 'DeliveryAvailable', true);

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
    if (!form.memberName.trim()) return 'Please enter member name.';
    if (!/^\d{4,6}$/.test(form.memberNumber.trim())) return 'Member number must be 4–6 digits.';
    if (!form.phone.trim()) return 'Please enter mobile number.';
    const t = Number(form.tableNumber);
    if (form.fulfillmentType === 'Delivery' && (!Number.isInteger(t) || t < 1 || t > 100)) {
      return 'For delivery, table number must be between 1 and 100.';
    }
    if (form.tableNumber && (!Number.isInteger(t) || t < 1 || t > 100)) {
      return 'Table number must be between 1 and 100.';
    }
    if (selectedItems.length === 0 && !form.barRequest.trim()) return 'Please select at least one item or enter a bar/cocktail request.';
    if (!form.authorizationAccepted) return 'Please authorize the charge to the member account.';
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
          memberName: form.memberName.trim(),
          memberNumber: form.memberNumber.trim(),
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
      const nextConfirmation = { orderId: res.orderId, pickupLocation: settings.PickupLocation || 'Pool Bar' };
      setConfirmation(nextConfirmation);
      setLiveStatus('New');
      sessionStorage.setItem(CONFIRMATION_KEY, JSON.stringify({
        ...nextConfirmation,
        status: 'New',
        memberName: form.memberName.trim(),
        memberNumber: form.memberNumber.trim(),
        fulfillmentType: form.fulfillmentType,
        tableNumber: form.tableNumber.trim()
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
        fulfillmentType: res.fulfillmentType || 'Pickup',
        tableNumber: res.tableNumber || '',
        readyAt: nextReadyAt
      };
      setForm(prev => ({ ...prev, memberNumber, fulfillmentType: restored.fulfillmentType, tableNumber: restored.tableNumber }));
      setConfirmation({ orderId: resolvedOrderId, pickupLocation: restored.pickupLocation });
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
    return (
      <div className="stack memberStack">
        <div className={ready ? 'card success statusCard readyCard' : 'card success statusCard'}>
          <div className="orderNumHeader">
            <span>Order confirmed</span>
            <strong>#{confirmation.orderId}</strong>
            <small>{form.fulfillmentType}{form.tableNumber ? ` · Table ${form.tableNumber}` : ''}</small>
          </div>
          <CheckCircle size={34} />
          <h2>{ready ? (form.fulfillmentType === 'Delivery' ? 'Order Ready for Delivery' : 'Ready for Pickup') : 'Order Sent'}</h2>
          <p>Thank you, {form.memberName}. Your order status updates automatically.</p>
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
                Please keep this screen open. The order status will update automatically.
              </>
            ) : (
              <>
                <strong>Pickup:</strong> {confirmation.pickupLocation}<br />
                Please keep this screen open. We will update this screen when your order is ready for pickup.
              </>
            )}
          </div>
          {ready && (
            <div className="readyNotice">
              {form.fulfillmentType === 'Delivery'
                ? `Your order was ready at ${timeLabel(readyAt) || 'the time shown above'} and will be delivered to your table.`
                : `Your order was ready at ${timeLabel(readyAt) || 'the time shown above'}. Please pick it up at the Pool Bar and provide your name/member number.`}
            </div>
          )}
        </div>
        <button className="primaryButton" onClick={() => { clearSavedConfirmation(); window.location.reload(); }}>Start New Order</button>
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
          <p>Order from your table and charge it to your member account. No app download needed.</p>
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
        <div className="sectionKicker"><UserRound size={15} /> Member details</div>
        <h2>Member Information</h2>
        <label>Member Name
          <input value={form.memberName} onChange={e => setField('memberName', e.target.value)} placeholder="First and last name" />
        </label>
        <label>Member Number
          <input inputMode="numeric" maxLength="6" value={form.memberNumber} onChange={e => setField('memberNumber', e.target.value.replace(/\D/g, ''))} placeholder="4–6 digits" />
        </label>
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
        <p className="finePrint">Custom bar requests will be priced according to standard club bar pricing and charged to your member account.</p>
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

        <label className="check">
          <input type="checkbox" checked={form.authorizationAccepted} onChange={e => setField('authorizationAccepted', e.target.checked)} />
          <span>I authorize this order to be charged to the member account listed above. I understand the club will verify the member number against its member list and may confirm my name at pickup or delivery.</span>
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

function Login({ onLogin, onBack }) {
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
      const res = await adminFunction('admin-login', {
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
      <h2>Staff Dashboard</h2>
      <p>Enter the staff password to view orders.</p>
      {err && <div className="alert">{err}</div>}
      <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Staff password" onKeyDown={e => e.key === 'Enter' && handle()} />
      <button className="primaryButton" onClick={handle} disabled={submitting}>{submitting ? 'Opening...' : 'Open Dashboard'}</button>
      <button className="backToOrderButton" onClick={onBack} type="button">Back to Order</button>
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
    return [
      `Status: ${order.status}`,
      `Time: ${order.timestamp}`,
      `Service: ${order.fulfillmentType || 'Pickup'}`,
      `Table: ${order.tableNumber || '—'}`,
      `Member: ${order.memberName}`,
      `Member #: ${order.memberNumber}`,
      `Phone: ${order.phone}`,
      ``,
      `Items:`,
      `${order.itemsSummary || ''}`,
      order.barRequest ? `\nBar / Cocktail Request:\n${order.barRequest}` : '',
      ``,
      `Known Subtotal: ${currency(order.subtotalKnownItems)}`,
      `Alcohol: ${order.alcoholIncluded ? 'YES' : 'No'}`,
      `POS Posted: ${order.posPosted ? 'YES' : 'No'}`
    ].join('\n');
  }

  if (!loggedIn) {
    return <Login onLogin={(token) => { setAdminToken(token); setLoggedIn(true); }} onBack={onBackToOrder} />;
  }

  const activeCount = orders.filter(o => !['Completed', 'Cancelled'].includes(o.status)).length;
  const newCount = orders.filter(o => o.status === 'New').length;
  const preparingCount = orders.filter(o => ['Accepted', 'Preparing'].includes(o.status)).length;
  const readyCount = orders.filter(o => o.status === 'Ready for Pickup').length;
  const completedCount = orders.filter(o => o.status === 'Completed' && isOrderToday(o)).length;
  const cancelledCount = orders.filter(o => o.status === 'Cancelled' && isOrderToday(o)).length;
  const needsPosCount = orders.filter(o => o.status === 'Completed' && !o.posPosted && isOrderToday(o)).length;
  const needsPosTotal = orders
    .filter(o => o.status === 'Completed' && !o.posPosted && isOrderToday(o))
    .reduce((sum, order) => sum + Number(order.subtotalKnownItems || 0), 0);
  const todaysCompletedOrders = orders.filter(o => o.status === 'Completed' && isOrderToday(o));
  const todaysPostedCount = todaysCompletedOrders.filter(o => o.posPosted).length;
  const todaysAlcoholCount = orders.filter(o => o.alcoholIncluded && isOrderToday(o) && o.status !== 'Cancelled').length;
  const todaysDeliveryCount = orders.filter(o => o.fulfillmentType === 'Delivery' && isOrderToday(o) && o.status !== 'Cancelled').length;
  const menuItemsByCategory = menuItems.reduce((groups, item) => {
    const category = item.category || 'Other';
    if (!groups[category]) groups[category] = [];
    groups[category].push(item);
    return groups;
  }, {});
  const subtotalToday = orders
    .filter(o => o.status !== 'Cancelled' && isOrderToday(o))
    .reduce((sum, order) => sum + Number(order.subtotalKnownItems || 0), 0);
  const orderingOpen = settingEnabled(settings, 'OrderingOpen', true);
  const deliveryAvailable = settingEnabled(settings, 'DeliveryAvailable', true);
  const activeStation = STATION_TABS.find(tab => tab.id === activeStationId) || STATION_TABS[0];
  const boardColumns = activeStation.id === 'all' ? STAFF_COLUMNS : STATION_COLUMNS;
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
      if (!column.statuses.includes(visibleStatus)) return false;
      return !column.todayOnly || isOrderToday(order);
    });
  }

  function stationPrimaryAction(status) {
    if (status === 'New') return { label: 'Start', status: 'Preparing' };
    if (status === 'Preparing') return { label: 'Mark Ready', status: 'Ready' };
    if (status === 'Ready') return { label: 'Complete', status: 'Completed' };
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

    return (
      <article className={`staffOrderCard ${tone}${order.alcoholIncluded ? ' alcoholOrder' : ''}`} key={order.orderId}>
        <div className="staffOrderHead">
          <strong>#{order.orderId}</strong>
          <span>{ageLabel(order.timestamp || order.updatedAt)}</span>
        </div>
        <div className="staffOrderMember">
          <h3>{order.memberName || 'Member'}</h3>
          <div className="staffMemberLine">
            <span>Member #{order.memberNumber}{order.phone ? ` · ${displayPhone(order.phone)}` : ''}</span>
            {order.phone && <a href={`tel:${String(order.phone).replace(/\D/g, '')}`} aria-label={`Call ${order.memberName || 'member'}`}><Phone size={16} /></a>}
          </div>
          <div className={order.fulfillmentType === 'Delivery' ? 'serviceBadge delivery' : 'serviceBadge'}>{serviceLabel}</div>
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
          <button className="staffRefreshButton" onClick={loadOrders} disabled={loading}><RefreshCcw className={loading ? 'spin' : ''} size={18} /> Refresh</button>
          <button className="staffOrderPageButton" onClick={() => { clearAdminToken(); setLoggedIn(false); }}>Sign out</button>
          <strong>{activeCount} active orders</strong>
        </div>
      </section>

      {err && <div className="alert staffAlert"><AlertTriangle size={18} />{err}</div>}
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
                  : <div className="staffEmpty">No {column.title.toLowerCase()} orders</div>}
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

export default function App() {
  const initialMode = window.location.pathname.includes('/admin') ? 'admin' : 'order';
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    const path = mode === 'admin' ? '/admin' : '/order' + window.location.search;
    window.history.replaceState(null, '', path);
  }, [mode]);

  return (
    <main className={mode === 'admin' ? 'app adminApp' : 'app'}>
      {mode !== 'admin' && <Header mode={mode} setMode={setMode} />}
      {mode === 'admin' ? <AdminPage onBackToOrder={() => setMode('order')} /> : <OrderPage />}
      {mode !== 'admin' && <footer>Member-account ordering only. No online payment processing.</footer>}
    </main>
  );
}
