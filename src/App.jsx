
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart, ClipboardList, RefreshCcw, Printer, Lock, CheckCircle, AlertTriangle, Phone, MapPin, Utensils, UserRound, ShieldCheck, Undo2, Truck, Wine, ChefHat, Users, QrCode, ExternalLink, TableProperties, BookOpen, Flag, PencilLine, Volume2, Home, Download, MessageCircle, Eye, Clock } from 'lucide-react';

const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL || '';
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || '';
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'poolstaff';
const TRUCK_PASSWORD = import.meta.env.VITE_TRUCK_STAFF_PASSWORD || 'truckstaff';
const API_TIMEOUT_MS = 30000;
const API_RETRIES = 2;
const CONFIRMATION_KEY = 'eastpointeLastConfirmation';
const TRUCK_CONFIRMATION_KEY = 'eastpointeLastTruckConfirmation';
const ADMIN_TOKEN_KEY = 'eastpointeAdminToken';
const TRUCK_TOKEN_KEY = 'eastpointeTruckToken';
const TRUCK_SOUND_OFF_KEY = 'eastpointeTruckSoundOff';
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
  { id: 'New', title: 'New Order Waiting', statuses: ['New'], tone: 'new' },
  { id: 'Acknowledged', title: 'Preparing', statuses: ['Acknowledged'], tone: 'preparing' },
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
  if (typeof option === 'string') return { name: readableModifierName(option), priceDelta: 0 };
  return {
    name: readableModifierName(option?.name),
    priceDelta: Number(option?.priceDelta || 0)
  };
}

function readableModifierName(value) {
  return String(value || '').trim().replace(/\bO[/-]S\b/g, 'on the side');
}

function normalizeModifierGroup(group) {
  const name = String(group?.name || '').trim();
  const type = group?.type === 'multi' ? 'multi' : 'single';
  const required = Boolean(group?.required);
  const options = Array.isArray(group?.options)
    ? group.options.map(normalizeModifierOption).filter(option => option.name)
    : [];

  if (name.toLowerCase() !== 'cheese') {
    return [{ name, type, required, options }];
  }

  const extraCheeseOptions = options.filter(option => option.name.toLowerCase() === 'extra cheese');
  if (!extraCheeseOptions.length) {
    return [{ name, type, required, options }];
  }

  const cheeseTypeOptions = options.filter(option => option.name.toLowerCase() !== 'extra cheese');
  const groups = [];
  if (cheeseTypeOptions.length) {
    groups.push({
      name: 'Cheese Type',
      type: 'single',
      required,
      options: cheeseTypeOptions
    });
  }
  groups.push({
    name: 'Cheese Add-ons',
    type: 'multi',
    required: false,
    options: extraCheeseOptions
  });
  return groups;
}

function mergeModifierOptions(existingOptions = [], optionNames = []) {
  const seen = new Set(existingOptions.map(option => option.name.toLowerCase()));
  const additions = optionNames
    .map(name => ({ name, priceDelta: 0 }))
    .filter(option => {
      const key = option.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return [...existingOptions, ...additions];
}

function defaultSaladOptionNames(item) {
  if (item?.menuType !== 'truck') return [];
  const category = String(item?.category || '').toLowerCase();
  const itemName = String(item?.itemName || '').toLowerCase();
  if (!category.includes('salad')) return [];

  const options = ['Chopped', 'Dressing on the side'];
  if (itemName.includes('caesar')) {
    options.push('No Romaine', 'No Cheese', 'No Croutons', 'Extra Cheese', 'Extra Croutons');
  } else if (itemName.includes('garden')) {
    options.push('No Tomatoes', 'No Onions', 'No Cucumber', 'No Carrots', 'No Cheese', 'Extra Cheese');
  }
  return options;
}

const TRUCK_SALAD_DRESSINGS = [
  'Louie Dressing',
  'Balsamic Vinaigrette',
  'Raspberry Vinaigrette',
  'Ranch Honey Dressing',
  'Ponzu Chili Dressing',
  'Greek Vinaigrette',
  'Caesar Dressing',
  'Blue Cheese Dressing',
  'Champagne Vinaigrette',
  'Ranch Dressing',
  'Honey Mustard'
];

function defaultModifierGroupForItem(item) {
  if (item?.menuType !== 'truck') return [];
  const category = String(item?.category || '').toLowerCase();
  const itemName = String(item?.itemName || '').toLowerCase();
  const groups = [];
  const isSalad = category.includes('salad');
  if (isSalad) {
    groups.push({
      name: 'Salad Dressing',
      type: 'single',
      required: true,
      options: TRUCK_SALAD_DRESSINGS.map(name => ({ name, priceDelta: 0 }))
    });
  }
  if (['chicken salad', 'tuna salad', 'egg salad'].includes(itemName)) {
    groups.push({ name: 'Serving Style', type: 'single', required: true, options: [{ name: 'Cup', priceDelta: 0 }] });
  }
  if (itemName.includes('hot chili') || itemName.includes('soup of the day')) {
    groups.push({ name: 'Choose One', type: 'single', required: true, options: [
      { name: 'House-Made Hot Chili', priceDelta: 0 },
      { name: 'Soup of the Day', priceDelta: 0 }
    ] });
  }
  if (itemName.includes('peanut butter') && itemName.includes('jelly')) {
    groups.push({ name: 'Jelly Choice', type: 'single', required: true, options: [
      { name: 'Grape Jelly', priceDelta: 0 },
      { name: 'Strawberry Jelly', priceDelta: 0 }
    ] });
  }
  if (itemName === 'ham & cheese' || itemName === 'turkey & cheese') {
    groups.push({ name: 'Bread Choice', type: 'single', required: true, options: [
      { name: 'White Bread', priceDelta: 0 },
      { name: 'Wheat Bread', priceDelta: 0 }
    ] });
    groups.push({ name: 'Preparation', type: 'single', required: true, options: [
      { name: 'Plain', priceDelta: 0 },
      { name: 'Mayonnaise', priceDelta: 0 },
      { name: 'Mustard', priceDelta: 0 },
      { name: 'Mayonnaise & Mustard', priceDelta: 0 }
    ] });
  }
  if (itemName.includes('chicken tenders') || itemName.includes('french fries')) {
    groups.push({ name: 'Dipping Sauces', type: 'multi', required: false, options: [
      { name: 'Ketchup', priceDelta: 0 },
      { name: 'Honey Mustard', priceDelta: 0 },
      { name: 'BBQ Sauce', priceDelta: 0 },
      { name: 'Ranch', priceDelta: 0 }
    ] });
  }
  if (category.includes('grab') && itemName.includes('whole fruit')) {
    groups.push({ name: 'Fruit Choice', type: 'single', required: true, options: [
      { name: 'Banana', priceDelta: 0 },
      { name: 'Orange', priceDelta: 0 },
      { name: 'Apple', priceDelta: 0 }
    ] });
  }
  if (itemName.includes('cookie')) {
    groups.push({ name: 'Cookie Choice', type: 'single', required: true, options: [
      { name: 'Chocolate Chip', priceDelta: 0 },
      { name: 'Oatmeal Raisin', priceDelta: 0 },
      { name: 'Sugar Cookie', priceDelta: 0 }
    ] });
  }
  if (itemName.includes('potato chip')) {
    groups.push({ name: 'Chip Choice', type: 'single', required: true, options: [
      { name: 'Original', priceDelta: 0 },
      { name: 'BBQ', priceDelta: 0 },
      { name: 'Sour Cream & Onion', priceDelta: 0 },
      { name: 'Salt & Vinegar', priceDelta: 0 }
    ] });
  }
  if (itemName.includes('candy') || itemName.includes('health bar')) {
    groups.push({ name: 'Bar Choice', type: 'single', required: true, options: [
      { name: 'Snickers', priceDelta: 0 },
      { name: "M&M's", priceDelta: 0 },
      { name: "Hershey's", priceDelta: 0 },
      { name: 'KIND Bar', priceDelta: 0 }
    ] });
  }
  if (itemName === 'gatorade') {
    groups.push({ name: 'Flavor', type: 'single', required: true, options: [
      { name: 'Lemon-Lime', priceDelta: 0 },
      { name: 'Fruit Punch', priceDelta: 0 },
      { name: 'Orange', priceDelta: 0 },
      { name: 'Glacier Freeze', priceDelta: 0 }
    ] });
  }
  const cannedDrinkFlavors = {
    'white claw': ['Black Cherry', 'Mango', 'Lime', 'Raspberry'],
    'high noon': ['Pineapple', 'Peach', 'Watermelon', 'Grapefruit'],
    'surfside': ['Iced Tea + Vodka', 'Lemonade + Vodka', 'Half & Half'],
    'long drink': ['Traditional Citrus', 'Zero', 'Cranberry'],
    'nutrl': ['Pineapple', 'Watermelon', 'Orange', 'Lime']
  };
  if (cannedDrinkFlavors[itemName]) {
    groups.push({
      name: 'Flavor',
      type: 'single',
      required: true,
      options: cannedDrinkFlavors[itemName].map(name => ({ name, priceDelta: 0 }))
    });
  }
  return groups;
}

function withDefaultModifierGroups(item, groups) {
  const saladOptions = defaultSaladOptionNames(item);
  const defaultGroups = defaultModifierGroupForItem(item);
  if (!saladOptions.length && !defaultGroups.length) return groups;

  let merged = false;
  const nextGroups = groups.map(group => {
    if (group.name.toLowerCase() !== 'salad options') return group;
    merged = true;
    return {
      ...group,
      type: 'multi',
      required: false,
      options: mergeModifierOptions(group.options, saladOptions)
    };
  });

  if (saladOptions.length && !merged) {
    nextGroups.push({
      name: 'Salad Options',
      type: 'multi',
      required: false,
      options: mergeModifierOptions([], saladOptions)
    });
  }

  defaultGroups.forEach(defaultGroup => {
    const existingIndex = nextGroups.findIndex(group => group.name.toLowerCase() === defaultGroup.name.toLowerCase());
    if (existingIndex >= 0) {
      nextGroups[existingIndex] = {
        ...nextGroups[existingIndex],
        options: mergeModifierOptions(nextGroups[existingIndex].options, defaultGroup.options.map(option => option.name))
      };
    } else {
      nextGroups.push(defaultGroup);
    }
  });
  return nextGroups;
}

function truckMenuDescription(item) {
  if (item?.menuType !== 'truck') return String(item?.description || '').trim();
  const itemName = String(item?.itemName || '').toLowerCase();
  const existing = String(item?.description || '').trim();
  if (existing) return existing;
  if (itemName === 'chicken salad') return 'Prepared chicken salad served in a cup.';
  if (itemName === 'tuna salad') return 'Prepared tuna salad served in a cup.';
  if (itemName === 'egg salad') return 'Prepared egg salad served in a cup.';
  if (itemName === 'ham & cheese') return 'Kids ham and cheese sandwich with your choice of bread and preparation.';
  if (itemName === 'turkey & cheese') return 'Kids turkey and cheese sandwich with your choice of bread and preparation.';
  if (itemName.includes('peanut butter') && itemName.includes('jelly')) return 'Kids peanut butter and jelly sandwich with grape or strawberry jelly.';
  if (itemName.includes('chicken tenders')) return 'Kids menu chicken tenders with optional dipping sauce.';
  if (itemName.includes('french fries')) return 'Kids menu fries with optional dipping sauce.';
  if (itemName.includes('hot chili') || itemName.includes('soup of the day')) return "Choose a cup of house-made hot chili or today's soup.";
  return '';
}

function modifierGroupsForItem(item) {
  const raw = item?.modifierGroups;
  const groups = Array.isArray(raw) ? raw : [];
  const normalizedGroups = groups.flatMap(normalizeModifierGroup).filter(group => group.name && group.options.length);
  return withDefaultModifierGroups(item, normalizedGroups);
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

function itemNoteWithFallbackModifiers(item, selectionsByGroup = {}, itemNote = '') {
  const backendGroupNames = new Set(
    (Array.isArray(item?.modifierGroups) ? item.modifierGroups : [])
      .map(group => String(group?.name || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const fallbackSelections = selectedModifierGroups(item, selectionsByGroup)
    .filter(group => !backendGroupNames.has(group.group.toLowerCase()))
    .map(group => `${group.group}: ${group.selections.map(option => option.name).join(', ')}`);
  return [...fallbackSelections, String(itemNote || '').trim()].filter(Boolean).join(' | ');
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
  const lines = (item.selectedModifiers || []).reduce((acc, group) => {
    (group.selections || []).forEach(option => {
      const price = Number(option.priceDelta || 0);
      acc.push(`${group.group}: ${option.name}${price ? ` ${currency(price)}` : ''}`);
    });
    return acc;
  }, []);
  const note = String(item.itemNote || '').trim();
  if (note) lines.push(`Note: ${note}`);
  return lines;
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
  const serviceFeeAmount = Number(order.serviceFeeAmount || 0);
  const creditCardFeeAmount = Number(order.creditCardFeeAmount || 0);
  const serviceFeeVisible = order.serviceFeeVisible === true || String(order.serviceFeeVisible).toUpperCase() === 'TRUE';
  const creditCardFeeVisible = order.creditCardFeeVisible === true || String(order.creditCardFeeVisible).toUpperCase() === 'TRUE';
  const totalWithFees = Number(order.finalTotal || order.estimatedTotal || Number(order.subtotalKnownItems || 0) + tipAmount + serviceFeeAmount + creditCardFeeAmount);
  const hasTip = tipAmount > 0;
  const showFinalChargeNote = !isGuestPayment;
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
        <p class="total">Subtotal: ${escapeHtml(currency(order.subtotalKnownItems))}</p>
        <h2>Payment</h2>
        ${isGuestPayment ? `<p><strong>Guest payment required at pickup.</strong></p><p>Card type: ${escapeHtml(order.guestCardType || 'Not selected')}</p>` : ''}
        ${serviceFeeVisible && serviceFeeAmount > 0 ? `<p>${escapeHtml(order.serviceFeeLabel || 'Service Fee')}: ${escapeHtml(currency(serviceFeeAmount))}</p>` : ''}
        ${creditCardFeeVisible && creditCardFeeAmount > 0 ? `<p>${escapeHtml(order.creditCardFeeLabel || 'Credit Card Transaction Fee')}: ${escapeHtml(currency(creditCardFeeAmount))}</p>` : ''}
        ${hasTip || isGuestPayment ? `<p>Tip: ${escapeHtml(displayTipLabel(order.tipLabel || 'No tip'))} ${tipAmount > 0 ? `(${escapeHtml(currency(tipAmount))})` : ''}</p>` : ''}
        <p><strong>Total: ${escapeHtml(currency(totalWithFees))}</strong></p>
        ${showFinalChargeNote ? '<p class="muted">Final club account charge may include staff-priced custom items, tax, service charge, or adjustments.</p>' : ''}
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
  if (digits.length === 11 && digits.startsWith('1')) return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  return '';
}

function phoneHref(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `tel:${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `tel:${digits}`;
  return '';
}

function isGuestOrder(order) {
  return order?.paymentType === 'Guest Pay at Pickup' || order?.customerType === 'Guest';
}

function isApprovedNonMemberOrder(order) {
  return order?.customerType === 'RSM';
}

function normalizeMemberCustomerType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if ([
    'rsm',
    'approved non-member',
    'approved non member',
    'non-member',
    'non member',
    'nonmember',
    'house/social',
    'rsm: house/social',
    'sports',
    'rsm: sports',
    'summer',
    'rsm: summer',
    'tennis',
    'rsm: tennis',
    'young executive',
    'rsm: young executive'
  ].includes(raw)) {
    return 'RSM';
  }
  return 'Golf Member';
}

function customerTypeForPayment(paymentType, memberCustomerType = '') {
  if (paymentType === 'Guest Pay at Pickup') return 'Guest';
  return normalizeMemberCustomerType(memberCustomerType);
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function numericSetting(settings, key, fallback) {
  const value = settings?.[key];
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percentSetting(settings, key, fallback) {
  const value = numericSetting(settings, key, fallback);
  return value > 1 ? value / 100 : value;
}

function paymentFeeSettingsPrefix(paymentType, customerType = '') {
  if (paymentType === 'Guest Pay at Pickup' || customerType === 'Guest') return 'TruckGuest';
  if (customerType === 'RSM') return 'TruckNonMember';
  return 'TruckMember';
}

function calculateTruckFees({ subtotal, tipAmount, paymentType, settings, memberCustomerType = '' }) {
  const customerType = customerTypeForPayment(paymentType, memberCustomerType);
  const prefix = paymentFeeSettingsPrefix(paymentType, customerType);
  const isGolfMember = customerType === 'Golf Member';
  const defaultServiceFeeRate = isGolfMember
    ? 0
    : prefix === 'TruckGuest'
    ? 0.20
    : percentSetting(settings, 'TruckServiceFeeRate', 0.22);
  const serviceFeeRate = percentSetting(settings, `${prefix}ServiceFeeRate`, defaultServiceFeeRate);
  const creditCardFeeRate = percentSetting(settings, 'TruckCreditCardFeeRate', 0.03);
  const serviceFeeEnabled = !isGolfMember && settingEnabled(settings, `${prefix}ServiceFeeEnabled`, true);
  const serviceFeeVisible = !isGolfMember && settingEnabled(settings, `${prefix}ServiceFeeVisible`, true);
  const creditCardFeeEnabled = settingEnabled(settings, `${prefix}CreditCardFeeEnabled`, paymentType === 'Guest Pay at Pickup');
  const creditCardFeeVisible = settingEnabled(settings, `${prefix}CreditCardFeeVisible`, creditCardFeeEnabled);
  const serviceFeeAmount = serviceFeeEnabled ? roundMoney(Number(subtotal || 0) * serviceFeeRate) : 0;
  const creditCardBase = String(settings?.TruckCreditCardFeeBase || 'SubtotalPlusServiceFee') === 'SubtotalOnly'
    ? Number(subtotal || 0)
    : Number(subtotal || 0) + serviceFeeAmount;
  const creditCardFeeAmount = creditCardFeeEnabled ? roundMoney(creditCardBase * creditCardFeeRate) : 0;
  const safeTip = roundMoney(tipAmount);
  return {
    customerType,
    serviceFeeLabel: `${prefix === 'TruckGuest' ? 'Service Charge' : 'Service Fee'} (${Math.round(serviceFeeRate * 100)}%)`,
    serviceFeeRate,
    serviceFeeAmount,
    serviceFeeVisible,
    creditCardFeeLabel: `Credit Card Service Charge (${Math.round(creditCardFeeRate * 100)}%)`,
    creditCardFeeRate,
    creditCardFeeAmount,
    creditCardFeeVisible,
    tipAmount: safeTip,
    estimatedTotal: roundMoney(Number(subtotal || 0) + serviceFeeAmount + creditCardFeeAmount + safeTip),
    finalTotal: roundMoney(Number(subtotal || 0) + serviceFeeAmount + creditCardFeeAmount + safeTip)
  };
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

function orderFinalTotal(order) {
  return Number(order.finalTotal || order.estimatedTotal || (
    Number(order.subtotalKnownItems || 0) +
    Number(order.serviceFeeAmount || 0) +
    Number(order.creditCardFeeAmount || 0) +
    Number(order.tipAmount || 0)
  ));
}

function staffFeeLines(order) {
  const lines = [];
  if (Number(order.serviceFeeAmount || 0) > 0) {
    lines.push({
      label: order.serviceFeeVisible === true || String(order.serviceFeeVisible).toUpperCase() === 'TRUE'
        ? (order.serviceFeeLabel || 'Service Fee')
        : `${order.serviceFeeLabel || 'Service Fee'} (hidden)`,
      amount: Number(order.serviceFeeAmount || 0)
    });
  }
  if (Number(order.creditCardFeeAmount || 0) > 0) {
    lines.push({
      label: order.creditCardFeeLabel || 'Credit Card Transaction Fee',
      amount: Number(order.creditCardFeeAmount || 0)
    });
  }
  if (Number(order.tipAmount || 0) > 0) {
    lines.push({ label: `Tip ${displayTipLabel(order.tipLabel)}`.trim(), amount: Number(order.tipAmount || 0) });
  }
  return lines;
}

function displayTipLabel(label) {
  const raw = String(label || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (raw.includes('%') || lower === 'custom' || lower === 'no tip') return raw;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0 && numeric < 1) return `${Math.round(numeric * 100)}%`;
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 100) return `${numeric}%`;
  return raw;
}

function tipDetails(subtotal, tipChoice, customTip) {
  if (String(tipChoice || '') === '') {
    return { amount: 0, label: '' };
  }
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

function dateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!date.getTime()) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sameDateInput(value, targetDate) {
  if (!targetDate) return false;
  return dateInputValue(value) === targetDate;
}

function isOrderToday(order) {
  return isToday(order.timestamp) || isToday(order.updatedAt) || isToday(order.completedAt);
}

function isCloseoutToday(order) {
  return isOrderToday(order) || isToday(order.posPostedAt);
}

function orderMatchesDate(order, targetDate) {
  return sameDateInput(order.completedAt, targetDate) ||
    sameDateInput(order.timestamp, targetDate) ||
    sameDateInput(order.updatedAt, targetDate) ||
    sameDateInput(order.posPostedAt, targetDate);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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

function defaultOrderingTime(prefix, kind) {
  if (prefix === 'Truck') return kind === 'open' ? '09:00' : '16:00';
  return kind === 'open' ? '08:30' : '16:30';
}

function timeRangeLabel(openTime, closeTime) {
  function label(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return '';
    let hour = Number(match[1]);
    const minute = match[2];
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return `${hour}:${minute} ${suffix}`;
  }
  const open = label(openTime);
  const close = label(closeTime);
  return open && close ? `${open} - ${close}` : '';
}

function scheduleIsOpen(settings, prefix = '') {
  const enabled = settingEnabled(settings, `${prefix}OrderingScheduleEnabled`, false);
  if (!enabled) return null;
  const open = timeInputValue(settings, `${prefix}OrderingOpenTime`, defaultOrderingTime(prefix, 'open'));
  const close = timeInputValue(settings, `${prefix}OrderingCloseTime`, defaultOrderingTime(prefix, 'close'));
  const now = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
  return now >= open && now < close;
}

function effectiveOrderingOpen(settings, key = 'OrderingOpen', prefix = '') {
  const scheduledOpen = scheduleIsOpen(settings, prefix);
  if (scheduledOpen !== null) return scheduledOpen;
  const manualValue = settings?.[key];
  if (manualValue !== undefined && manualValue !== null && manualValue !== '') {
    return settingEnabled(settings, key, true);
  }
  return settingEnabled(settings, key, true);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function apiErrorMessage(error, action) {
  if (error.name === 'AbortError') {
    if (action === 'createTruckOrder' || action === 'createOrder') {
      return 'The order submission paused before we received confirmation. Please try again once.';
    }
    return 'The connection paused for a moment. Please try again.';
  }
  if (String(error.message || '').includes('Failed to fetch')) return 'Unable to reach the ordering system. Please check the connection and try again.';
  return error.message || `Unable to complete ${action}.`;
}

function truckErrorMessage(message) {
  return String(message || 'Unable to complete truck order.')
    .replace(/contact The Turn Truck/g, 'contact the club')
    .replace(/contact the Pool Bar/g, 'contact the club')
    .replace(/Pool ordering/g, 'Truck ordering')
    .replace(/Pool Bar/g, 'The Turn Truck');
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

function TruckHeader() {
  return (
    <header className="header truckHeader">
      <div className="brandLockup">
        <img src="/eastpointe-logo-tight.png" alt="Eastpointe Country Club" className="brandLogo" />
        <div>
          <p className="eyebrow">Eastpointe Country Club</p>
          <h1>The Turn Truck</h1>
        </div>
      </div>
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
    <div className="tabsWrap">
      <div className="tabs" aria-label="Menu categories">
        {categories.map(cat => (
          <button key={cat} className={cat === active ? 'tab active' : 'tab'} onClick={() => setActive(cat)}>
            {cat}
          </button>
        ))}
      </div>
      {categories.length > 2 && <span className="swipeCue">Swipe categories</span>}
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

function TruckMenuItem({ item, quantity, modifierSelections = {}, onQuickAdd, onQuantityChange, onCustomize, showCategory = false }) {
  const modifierGroups = modifierGroupsForItem(item);
  const hasModifiers = modifierGroups.length > 0;
  const description = truckMenuDescription(item);

  return (
    <div className={!item.available ? 'menuItem truckMenuItem unavailable' : 'menuItem truckMenuItem'}>
      <div className="menuText">
        <div className="menuTitleLine">
          <h3>{item.itemName}</h3>
          <strong>{currency(item.price)}</strong>
        </div>
        {showCategory && <span className={item.category === 'Kids Menu' ? 'categoryBadge kidsCategoryBadge' : 'categoryBadge'}>{item.category || 'Menu'}</span>}
        {description && <p>{description}</p>}
        <div className="menuPillRow">
          {item.alcoholic && <span className="pill warning">Alcohol</span>}
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

function TruckItemCustomizer({ item, quantity, modifierSelections = {}, setModifierSelection, itemNote = '', setItemNote, setQuantity, onClose }) {
  const [localError, setLocalError] = useState('');
  const [draftQuantity, setDraftQuantity] = useState(Math.max(1, Number(quantity || 0) || 1));
  const [draftNote, setDraftNote] = useState(itemNote || '');
  const modifierGroups = modifierGroupsForItem(item);
  const showItemNote = String(item.category || '').toLowerCase().includes('liquor');

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
    if (setItemNote) setItemNote(draftNote.trim());
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
        {showItemNote && (
          <label className="itemNoteField">Liquor Notes <span className="optionalText">Optional</span>
            <textarea
              value={draftNote}
              onChange={event => setDraftNote(event.target.value)}
              placeholder="Example: light ice, lime, splash of cranberry"
              rows="2"
            />
          </label>
        )}
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
    tipChoice: savedConfirmation?.tipChoice || '',
    customTip: '',
    memberName: savedConfirmation?.memberName || '',
    memberNumber: savedConfirmation?.memberNumber || '',
    phone: savedConfirmation?.phone || '',
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
    if (!isPickupPayment && !/^\d{4,6}$/.test(form.memberNumber.trim())) return 'Member number must be 4–6 digits.';
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
        : isApprovedNonMemberPayment
          ? 'Please acknowledge that payment must be provided at pickup.'
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  }

  async function lookupOrder() {
    const orderId = String(lookup.orderId || '').trim();
    const memberNumber = String(lookup.memberNumber || '').trim();
    if (!/^\d{4,6}$/.test(memberNumber)) {
      setErr('Enter your 4–6 digit member number.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
    if (!confirmation?.orderId || (!form.memberNumber && !form.phone)) return;
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
          <input inputMode="tel" value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="Example: 561-555-0100" />
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
              <span>Subtotal</span>
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
              <span>Subtotal</span><strong>{currency(subtotal)}</strong>
              {checkoutTip.amount > 0 && (
                <>
                  <span>{checkoutTip.label ? `Tip (${checkoutTip.label})` : 'Tip'}</span><strong>{currency(checkoutTip.amount)}</strong>
                </>
              )}
              <span>Total</span><strong>{currency(checkoutTotal)}</strong>
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
  const errorRef = useRef(null);
  const [menu, setMenu] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statusError, setStatusError] = useState('');
  const [activeCat, setActiveCat] = useState('');
  const [quantities, setQuantities] = useState({});
  const [modifierSelections, setModifierSelections] = useState({});
  const [itemNotes, setItemNotes] = useState({});
  const [customizingItemId, setCustomizingItemId] = useState('');
  const [lookup, setLookup] = useState({
    orderId: getQueryParam('order') || '',
    memberNumber: savedConfirmation?.memberNumber || ''
  });
  const [form, setForm] = useState({
    paymentType: savedConfirmation?.paymentType || 'Member Account',
    guestCardType: savedConfirmation?.guestCardType || '',
    tipChoice: savedConfirmation?.tipChoice || '',
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
  const [memberCustomerType, setMemberCustomerType] = useState(savedConfirmation?.customerType || '');

  useEffect(() => {
    async function load() {
      try {
        const [menuData, settingsData] = await Promise.all([
          apiGet('truckMenu'),
          apiGet('settings')
        ]);
        setMenu((menuData.items || []).map(item => ({ ...item, menuType: 'truck' })));
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
    let cancelled = false;
    async function loadMemberProfile() {
      const memberNumber = form.memberNumber.trim();
      if (form.paymentType !== 'Member Account' || !/^\d{4,6}$/.test(memberNumber)) {
        setMemberCustomerType('');
        return;
      }

      try {
        const res = await apiGet('memberProfile', { memberNumber });
        if (!cancelled) setMemberCustomerType(res.customerType || 'Golf Member');
      } catch {
        if (!cancelled) setMemberCustomerType('');
      }
    }
    loadMemberProfile();
    return () => { cancelled = true; };
  }, [form.paymentType, form.memberNumber]);

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
      selectedModifiers: selectedModifierGroups(item, modifierSelections[item.itemId]),
      itemNote: itemNoteWithFallbackModifiers(item, modifierSelections[item.itemId], itemNotes[item.itemId])
    })), [orderedTruckMenu, quantities, modifierSelections, itemNotes]);
  const subtotal = selectedItems.reduce((sum, item) => sum + orderItemLineTotal(item), 0);
  const truckHasAlcohol = selectedItems.some(item => item.alcoholic);
  const truckOrderingOpen = effectiveOrderingOpen(settings, 'TruckOrderingOpen', 'Truck');
  const truckOrderingHours = timeRangeLabel(
    timeInputValue(settings, 'TruckOrderingOpenTime', defaultOrderingTime('Truck', 'open')),
    timeInputValue(settings, 'TruckOrderingCloseTime', defaultOrderingTime('Truck', 'close'))
  );
  const isGuestPayment = form.paymentType === 'Guest Pay at Pickup';
  const isApprovedNonMemberPayment = form.paymentType === 'Member Account' && memberCustomerType === 'RSM';
  const isPickupPayment = isGuestPayment;
  const memberTipsEnabled = settingEnabled(settings, 'TruckMemberTipsEnabled', true);
  const showTipSection = isPickupPayment || memberTipsEnabled;
  const checkoutTip = tipDetails(subtotal, form.tipChoice, form.customTip);
  const checkoutFees = calculateTruckFees({
    subtotal,
    tipAmount: showTipSection ? checkoutTip.amount : 0,
    paymentType: form.paymentType,
    settings,
    memberCustomerType
  });
  const checkoutTotal = checkoutFees.finalTotal;
  const customizingItem = useMemo(() =>
    orderedTruckMenu.find(item => item.itemId === customizingItemId) || null,
    [orderedTruckMenu, customizingItemId]
  );

  function showTruckError(message) {
    setErr(truckErrorMessage(message));
    setTimeout(() => {
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

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

  function setTruckItemNote(itemId, value) {
    setItemNotes(prev => ({
      ...prev,
      [itemId]: value
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
      setItemNotes(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }
  }

  function validateTruckOrder() {
    if (!truckOrderingOpen) return `The Turn Truck ordering is currently closed. Online ordering hours are ${truckOrderingHours}.`;
    if (!form.memberName.trim()) return isGuestPayment ? 'Please enter guest name.' : 'Please enter name.';
    if (!isGuestPayment && !/^\d{4,6}$/.test(form.memberNumber.trim())) return 'Member number must be 4–6 digits.';
    if (!form.phone.trim()) return 'Please enter mobile number.';
    if (!displayPhone(form.phone)) return 'Please enter a 10-digit mobile number.';
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
        : 'Please authorize this food truck order to be charged or reconciled to the account listed above.';
    }
    if (isGuestPayment && !form.guestCardType) return 'Please choose the card type you will provide at pickup.';
    if (truckHasAlcohol && !form.alcoholVerificationAccepted) return 'Please accept the alcohol verification notice.';
    return '';
  }

  async function submitTruckOrder() {
    const validation = validateTruckOrder();
    if (validation) {
      showTruckError(validation);
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
          customerType: checkoutFees.customerType,
          guestCardType: isGuestPayment ? form.guestCardType : '',
          tipAmount: showTipSection ? checkoutTip.amount : 0,
          tipLabel: showTipSection ? checkoutTip.label : '',
          serviceFeeLabel: checkoutFees.serviceFeeLabel,
          serviceFeeRate: checkoutFees.serviceFeeRate,
          serviceFeeAmount: checkoutFees.serviceFeeAmount,
          serviceFeeVisible: checkoutFees.serviceFeeVisible,
          creditCardFeeLabel: checkoutFees.creditCardFeeLabel,
          creditCardFeeRate: checkoutFees.creditCardFeeRate,
          creditCardFeeAmount: checkoutFees.creditCardFeeAmount,
          creditCardFeeVisible: checkoutFees.creditCardFeeVisible,
          estimatedTotal: checkoutFees.estimatedTotal,
          finalTotal: checkoutFees.finalTotal,
          memberName: form.memberName.trim(),
          memberNumber: isGuestPayment ? '' : form.memberNumber.trim(),
          phone: form.phone.trim(),
          items: selectedItems.map(item => ({
            itemId: item.itemId,
            category: item.category,
            itemName: item.itemName,
            price: Number(item.price || 0),
            quantity: Number(item.quantity || 0),
            selectedModifiers: item.selectedModifiers || [],
            itemNote: item.itemNote || ''
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
        customerType: checkoutFees.customerType,
        guestCardType: isGuestPayment ? form.guestCardType : '',
        tipAmount: showTipSection ? checkoutTip.amount : 0,
        tipLabel: showTipSection ? checkoutTip.label : '',
        serviceFeeLabel: checkoutFees.serviceFeeLabel,
        serviceFeeRate: checkoutFees.serviceFeeRate,
        serviceFeeAmount: checkoutFees.serviceFeeAmount,
        serviceFeeVisible: checkoutFees.serviceFeeVisible,
        creditCardFeeLabel: checkoutFees.creditCardFeeLabel,
        creditCardFeeRate: checkoutFees.creditCardFeeRate,
        creditCardFeeAmount: checkoutFees.creditCardFeeAmount,
        creditCardFeeVisible: checkoutFees.creditCardFeeVisible,
        estimatedTotal: checkoutFees.estimatedTotal,
        finalTotal: checkoutFees.finalTotal,
        memberName: form.memberName.trim(),
        memberNumber: isGuestPayment ? '' : form.memberNumber.trim(),
        items: selectedItems.map(item => ({
          itemId: item.itemId,
          category: item.category,
          itemName: item.itemName,
          price: Number(item.price || 0),
          quantity: Number(item.quantity || 0),
          selectedModifiers: item.selectedModifiers || [],
          itemNote: item.itemNote || ''
        })),
        specialInstructions: form.specialInstructions.trim(),
        subtotalKnownItems: subtotal
      };
      const saved = {
        orderId: res.orderId,
        status: 'New',
        memberName: form.memberName.trim(),
        memberNumber: isGuestPayment ? '' : form.memberNumber.trim(),
        phone: form.phone.trim(),
        paymentType: form.paymentType,
        customerType: checkoutFees.customerType,
        guestCardType: isGuestPayment ? form.guestCardType : '',
        tipChoice: showTipSection ? form.tipChoice : '0',
        chit
      };
      setConfirmation({ orderId: res.orderId, chit });
      setLiveStatus('New');
      sessionStorage.setItem(TRUCK_CONFIRMATION_KEY, JSON.stringify(saved));
    } catch (e) {
      showTruckError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function lookupTruckOrder() {
    const orderId = String(lookup.orderId || '').trim();
    const memberNumber = String(lookup.memberNumber || '').trim();
    if (!/^\d{4,6}$/.test(memberNumber)) {
      showTruckError('Enter your 4–6 digit member number.');
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
        customerType: res.customerType || customerTypeForPayment(res.paymentType || 'Member Account'),
        readyAt: nextReadyAt,
        chit: res.items || res.itemsSummary || res.subtotalKnownItems ? {
          orderId: resolvedOrderId,
          timestamp: res.timestamp || res.updatedAt || todayISO(),
          fulfillmentType: 'Pickup',
          memberName: res.memberName || '',
          paymentType: res.paymentType || 'Member Account',
          paymentStatus: res.paymentStatus || '',
          customerType: res.customerType || customerTypeForPayment(res.paymentType || 'Member Account'),
          guestCardType: res.guestCardType || '',
          tipLabel: res.tipLabel || '',
          tipAmount: Number(res.tipAmount || 0),
          serviceFeeLabel: res.serviceFeeLabel || '',
          serviceFeeRate: Number(res.serviceFeeRate || 0),
          serviceFeeAmount: Number(res.serviceFeeAmount || 0),
          serviceFeeVisible: res.serviceFeeVisible,
          creditCardFeeLabel: res.creditCardFeeLabel || '',
          creditCardFeeRate: Number(res.creditCardFeeRate || 0),
          creditCardFeeAmount: Number(res.creditCardFeeAmount || 0),
          creditCardFeeVisible: res.creditCardFeeVisible,
          estimatedTotal: Number(res.estimatedTotal || 0),
          finalTotal: Number(res.finalTotal || res.estimatedTotal || 0),
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
      setMemberCustomerType(saved.customerType || '');
      sessionStorage.setItem(TRUCK_CONFIRMATION_KEY, JSON.stringify(saved));
    } catch (e) {
      showTruckError(e.message || 'Food truck order not found.');
    } finally {
      setLookingUp(false);
    }
  }

  useEffect(() => {
    if (!confirmation?.orderId || (!form.memberNumber && !form.phone)) return;
    async function pollStatus() {
      try {
        const res = await apiGet('truckOrderStatus', {
          orderId: confirmation.orderId,
          memberNumber: form.memberNumber.trim(),
          phone: form.phone.trim()
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
  }, [confirmation?.orderId, form.memberNumber, form.phone]);

  if (loading) return <LoadingCard message="Loading truck menu..." />;

  if (confirmation) {
    const ready = ['Ready for Pickup', 'Completed'].includes(liveStatus);
    const memberStatus = memberTruckStatus(liveStatus || 'New');
    const chit = confirmation.chit || readSavedTruckConfirmation()?.chit;
    const confirmationIsGuest = form.paymentType === 'Guest Pay at Pickup' || chit?.paymentType === 'Guest Pay at Pickup';
    return (
      <div className="stack memberStack truckMember">
        {err && <div ref={errorRef} className="alert truckErrorPanel"><AlertTriangle size={30} />{err}</div>}
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

  if (!truckOrderingOpen) {
    return (
      <div className="stack memberStack truckMember">
        {err && <div ref={errorRef} className="alert truckErrorPanel"><AlertTriangle size={30} />{err}</div>}

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

        <section className="card truckClosedPanel">
          <AlertTriangle size={42} />
          <div>
            <p className="eyebrow">Ordering paused</p>
            <h2>The Turn Truck is currently closed</h2>
            <p>Online ordering is not available right now. Truck ordering hours are {truckOrderingHours || '9:00 AM - 4:00 PM'}.</p>
          </div>
          <div className="closedTruckDetails">
            <strong>No online orders can be placed while ordering is closed.</strong>
            {truckOrderingHours && <span>Online ordering hours: {truckOrderingHours}</span>}
            <span>Staff can reopen ordering from the Truck Staff Dashboard.</span>
          </div>
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

  return (
    <div className="stack memberStack truckMember">
      {err && <div ref={errorRef} className="alert truckErrorPanel"><AlertTriangle size={30} />{err}</div>}

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
        <div className="sectionKicker"><UserRound size={15} /> {isGuestPayment ? 'Guest details' : 'Account details'}</div>
        <h2>{isGuestPayment ? 'Guest Information' : 'Account Information'}</h2>
        <label>{isGuestPayment ? 'Guest Name' : 'Name'}
          <input value={form.memberName} onChange={event => setField('memberName', event.target.value)} placeholder="First and last name" />
        </label>
        {!isGuestPayment && (
          <label>Member Number
            <input inputMode="numeric" maxLength="6" value={form.memberNumber} onChange={event => setField('memberNumber', event.target.value.replace(/\D/g, ''))} placeholder="4–6 digits" />
          </label>
        )}
        <label>Mobile Number
          <input inputMode="tel" value={form.phone} onChange={event => setField('phone', event.target.value)} placeholder="Example: 561-555-0100" />
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
            <p className="hint">Choose a category from the dropdown or swipe the category row. Use + to add items.</p>
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
                  showCategory={activeCat === 'All Items'}
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
          itemNote={itemNotes[customizingItem.itemId] || ''}
          setItemNote={(value) => setTruckItemNote(customizingItem.itemId, value)}
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
                  <button
                    className="cartRemoveButton"
                    type="button"
                    onClick={() => setTruckItemQuantity(item.itemId, 0)}
                  >
                    Remove
                  </button>
                </span>
                <strong>{currency(orderItemLineTotal(item))}</strong>
              </div>
            ))}
            <div className="cartTotal">
              <span>Subtotal</span>
              <strong>{currency(subtotal)}</strong>
            </div>
          </div>
        )}

        {showTipSection && (
          <div className="guestPaymentCheckout">
            <div className="sectionKicker"><ShieldCheck size={15} /> {isGuestPayment ? 'Payment at pickup' : 'Tip'}</div>
            <h3>{isGuestPayment ? 'Card at Pickup' : 'Add a Tip'}</h3>
            {isGuestPayment
              ? <p className="hint">No card number is collected online. Staff will collect the physical credit card at pickup.</p>
              : <p className="hint">Optional tip to add to the account charge.</p>}
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
              <span>Subtotal</span><strong>{currency(subtotal)}</strong>
              {checkoutFees.serviceFeeVisible && checkoutFees.serviceFeeAmount > 0 && (
                <>
                  <span>{checkoutFees.serviceFeeLabel || 'Service fee'}</span><strong>{currency(checkoutFees.serviceFeeAmount)}</strong>
                </>
              )}
              {checkoutFees.creditCardFeeVisible && checkoutFees.creditCardFeeAmount > 0 && (
                <>
                  <span>{checkoutFees.creditCardFeeLabel || 'Credit card transaction fee'}</span><strong>{currency(checkoutFees.creditCardFeeAmount)}</strong>
                </>
              )}
              {checkoutTip.amount > 0 && (
                <>
                  <span>{checkoutTip.label ? `Tip (${checkoutTip.label})` : 'Tip'}</span><strong>{currency(checkoutTip.amount)}</strong>
                </>
              )}
              <span>Total</span><strong>{currency(checkoutTotal)}</strong>
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
            : 'I authorize this food truck order to be charged or reconciled to the account listed above.'}</span>
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
  const [soundEnabled, setSoundEnabled] = useState(true);
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
      `Subtotal: ${currency(order.subtotalKnownItems)}`,
      guestPayment ? `Payment Status: ${order.paymentStatus || 'Due at Pickup'}` : '',
      guestPayment ? `Card Type: ${order.guestCardType || 'Not selected'}` : '',
      Number(order.tipAmount || 0) > 0 ? `Tip: ${displayTipLabel(order.tipLabel || 'Custom')} (${currency(order.tipAmount)})` : '',
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
    const formattedPhone = displayPhone(order.phone);
    const callHref = phoneHref(order.phone);

    return (
      <article className={`staffOrderCard ${tone}${order.alcoholIncluded ? ' alcoholOrder' : ''}`} key={order.orderId}>
        <div className="staffOrderHead">
          <strong>#{order.orderId}</strong>
          <span>{ageLabel(order.timestamp || order.updatedAt)}</span>
        </div>
        <div className="staffOrderMember">
          <h3>{order.memberName || 'Member'}</h3>
          <div className="staffMemberLine">
            <span>{guestPayment ? 'Guest payment due' : `Member #${order.memberNumber}`}{formattedPhone ? ` · ${formattedPhone}` : ''}</span>
            {callHref && <a href={callHref} aria-label={`Call ${order.memberName || 'member'}`}><Phone size={16} /></a>}
          </div>
          <div className={order.fulfillmentType === 'Delivery' ? 'serviceBadge delivery' : 'serviceBadge'}>{serviceLabel}</div>
          {guestPayment && <div className="paymentDueBadge">Collect {order.guestCardType || 'card'} at pickup · Tip {displayTipLabel(order.tipLabel || 'No tip')}</div>}
          {!guestPayment && Number(order.tipAmount || 0) > 0 && <div className="paymentDueBadge tipBadge">Tip {displayTipLabel(order.tipLabel || 'Custom')} · {currency(order.tipAmount)}</div>}
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
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem(TRUCK_SOUND_OFF_KEY) !== 'true');
  const [soundError, setSoundError] = useState('');
  const [reportDate, setReportDate] = useState(dateInputValue());

  async function handleTestSound() {
    try {
      await enableNotificationSound();
      setSoundEnabled(true);
      localStorage.removeItem(TRUCK_SOUND_OFF_KEY);
      setSoundError('');
    } catch (e) {
      setSoundError(e.message || 'Unable to enable sound on this device.');
    }
  }

  function handleTurnSoundOff() {
    localStorage.setItem(TRUCK_SOUND_OFF_KEY, 'true');
    setSoundEnabled(false);
    setSoundError('');
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
          if (soundEnabled) playNewOrderSound();
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
  }, [loggedIn, soundEnabled]);

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
    const previousOrders = orders;
    const nowLabel = new Date().toLocaleString();
    setOrders(prev => prev.map(order => String(order.orderId) === String(orderId)
      ? {
        ...order,
        posPosted: posted,
        posPostedAt: posted ? nowLabel : '',
        posPostedBy: posted ? 'Truck Staff' : '',
        updatedAt: nowLabel
      }
      : order));
    try {
      await adminFunction('truck-update-pos-posted', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getTruckToken()}` },
        body: JSON.stringify({ orderId, posted, postedBy: 'Truck Staff' })
      });
      await loadTruckOrders();
    } catch (e) {
      setOrders(previousOrders);
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
      if (res.settings) setSettings({ ...res.settings, [key]: value });
      return res;
    } catch (e) {
      setSettings(previousSettings);
      setErr(e.message);
    } finally {
      setUpdatingSetting('');
    }
  }

  async function updateTruckOrderingOpen(nextOpen) {
    if (truckScheduleEnabled) {
      await updateTruckSetting('TruckOrderingScheduleEnabled', 'FALSE');
    }
    await updateTruckSetting('TruckOrderingOpen', nextOpen ? 'TRUE' : 'FALSE');
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

  function truckEmptyLabel(column) {
    const labels = {
      New: 'No new orders',
      Acknowledged: 'No preparing orders',
      Ready: 'No ready orders',
      Completed: 'No completed orders',
      Cancelled: 'No cancelled orders'
    };
    return labels[column.id] || 'No orders';
  }

  function exportTruckDailyReport() {
    const header = [
      'Date',
      'Order ID',
      'Status',
      'POS Posted',
      'Customer Name',
      'Customer Type',
      'Payment Type',
      'Card Type',
      'Phone',
      'Subtotal',
      'Service Fee',
      'Service Fee Visible',
      'Credit Card Fee',
      'Credit Card Fee Visible',
      'Tip',
      'Total',
      'Placed',
      'Completed',
      'Items',
      'Special Instructions'
    ];
    const rows = reportOrdersForDate.map(order => [
      reportDate,
      order.orderId,
      order.status,
      order.posPosted ? 'YES' : 'No',
      order.memberName || (isGuestOrder(order) ? 'Guest' : ''),
      order.customerType || (isGuestOrder(order) ? 'Guest' : 'Golf Member'),
      order.paymentType || '',
      order.guestCardType || '',
      order.phone || '',
      Number(order.subtotalKnownItems || 0).toFixed(2),
      Number(order.serviceFeeAmount || 0).toFixed(2),
      order.serviceFeeVisible === true || String(order.serviceFeeVisible).toUpperCase() === 'TRUE' ? 'YES' : 'No',
      Number(order.creditCardFeeAmount || 0).toFixed(2),
      order.creditCardFeeVisible === true || String(order.creditCardFeeVisible).toUpperCase() === 'TRUE' ? 'YES' : 'No',
      Number(order.tipAmount || 0).toFixed(2),
      orderFinalTotal(order).toFixed(2),
      order.timestamp || '',
      order.completedAt || '',
      itemLines(order).join(' | '),
      order.staffNotes || ''
    ]);
    downloadCsv(`turn-truck-closeout-${reportDate}.csv`, [header, ...rows]);
  }

  function renderTruckOrderCard(order, tone) {
    const action = truckAction(order);
    const isUpdating = updatingStatus?.orderId === order.orderId;
    const guestPayment = isGuestOrder(order);
    const nonMemberPayment = isApprovedNonMemberOrder(order);
    const feeLines = staffFeeLines(order);
    const formattedPhone = displayPhone(order.phone);
    const callHref = phoneHref(order.phone);
    return (
      <article className={`staffOrderCard truckOrderCard ${tone}${guestPayment ? ' guestOrderCard' : ''}${nonMemberPayment ? ' nonMemberOrderCard' : ''}${order.alcoholIncluded ? ' alcoholOrder' : ''}`} key={order.orderId}>
        <div className="staffOrderHead">
          <strong>#{order.orderId}</strong>
          <span>{ageLabel(order.timestamp || order.updatedAt)}</span>
        </div>
        <div className="staffOrderMember">
          <h3>{order.memberName || (guestPayment ? 'Guest' : 'Member')}</h3>
          <div className="staffMemberLine">
            <span>{guestPayment ? 'Guest payment due' : nonMemberPayment ? `RSM #${order.memberNumber}` : `Member #${order.memberNumber}`}{formattedPhone ? ` · ${formattedPhone}` : ''}</span>
            {callHref && <a href={callHref} aria-label={`Call ${order.memberName || 'member'}`}><Phone size={16} /></a>}
          </div>
          {guestPayment && <div className="paymentDueBadge">Collect {order.guestCardType || 'card'} at pickup</div>}
          {nonMemberPayment && <div className="paymentDueBadge nonMemberBadge">RSM account · 22% service fee visible</div>}
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
          <strong>{currency(orderFinalTotal(order))}</strong>
          <span className={guestPayment ? 'guestPill' : order.alcoholIncluded ? 'alcoholPill' : ''}>{guestPayment ? 'Guest' : order.alcoholIncluded ? 'Alcohol' : 'Truck order'}</span>
        </div>
        {feeLines.length > 0 && (
          <div className="staffFeeBreakdown">
            <div><span>Subtotal</span><strong>{currency(order.subtotalKnownItems)}</strong></div>
            {feeLines.map(line => <div key={`${order.orderId}-${line.label}`}><span>{line.label}</span><strong>{currency(line.amount)}</strong></div>)}
            <div className="feeTotal"><span>Staff total</span><strong>{currency(orderFinalTotal(order))}</strong></div>
          </div>
        )}
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
              <span>{order.posPosted ? 'Posted to POS' : 'Needs POS Posting'} · {currency(orderFinalTotal(order))}</span>
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
  const truckOpenTime = timeInputValue(settings, 'TruckOrderingOpenTime', defaultOrderingTime('Truck', 'open'));
  const truckCloseTime = timeInputValue(settings, 'TruckOrderingCloseTime', defaultOrderingTime('Truck', 'close'));
  const activeCount = orders.filter(order => !['Completed', 'Cancelled'].includes(order.status)).length;
  const readyCount = orders.filter(order => order.status === 'Ready for Pickup').length;
  const closeoutOrdersToday = orders.filter(order => order.status !== 'Cancelled' && isCloseoutToday(order));
  const completedOrdersToday = closeoutOrdersToday.filter(order => order.status === 'Completed');
  const completedToday = completedOrdersToday.length;
  const postedToday = completedOrdersToday.filter(order => order.posPosted).length;
  const needsPosCount = completedOrdersToday.filter(order => !order.posPosted).length;
  const needsPosTotal = completedOrdersToday
    .filter(order => !order.posPosted)
    .reduce((sum, order) => sum + orderFinalTotal(order), 0);
  const todaysTipOrders = closeoutOrdersToday.filter(order => Number(order.tipAmount || 0) > 0);
  const todaysTipTotal = sumTips(todaysTipOrders);
  const todaysTipPostedTotal = sumTips(todaysTipOrders.filter(order => order.posPosted));
  const todaysTipOpenTotal = sumTips(todaysTipOrders.filter(order => !order.posPosted));
  const subtotalToday = closeoutOrdersToday
    .reduce((sum, order) => sum + Number(order.subtotalKnownItems || 0), 0);
  const totalToday = closeoutOrdersToday
    .reduce((sum, order) => sum + orderFinalTotal(order), 0);
  const reportOrdersForDate = orders.filter(order => orderMatchesDate(order, reportDate));
  const reportCompletedOrders = reportOrdersForDate.filter(order => order.status === 'Completed');
  const reportBillableOrders = reportCompletedOrders.filter(order => order.status !== 'Cancelled');
  const reportPosPostedCount = reportCompletedOrders.filter(order => order.posPosted).length;
  const reportNeedsPosCount = reportCompletedOrders.filter(order => !order.posPosted).length;
  const reportSubtotal = reportBillableOrders.reduce((sum, order) => sum + Number(order.subtotalKnownItems || 0), 0);
  const reportServiceFees = reportBillableOrders.reduce((sum, order) => sum + Number(order.serviceFeeAmount || 0), 0);
  const reportCardFees = reportBillableOrders.reduce((sum, order) => sum + Number(order.creditCardFeeAmount || 0), 0);
  const reportTips = reportBillableOrders.reduce((sum, order) => sum + Number(order.tipAmount || 0), 0);
  const reportTotal = reportBillableOrders.reduce((sum, order) => sum + orderFinalTotal(order), 0);
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
            onClick={handleTestSound}
            type="button"
            title="Tap to test or allow sound on this device"
          >
            <Volume2 size={18} /> {soundEnabled ? 'Sound On / Test' : 'Turn Sound On'}
          </button>
          {soundEnabled && (
            <button className="staffSoundButton" onClick={handleTurnSoundOff} type="button" title="Turn off new-order sound on this device">
              Sound Off
            </button>
          )}
          <button
            className={truckOrderingOpen ? 'staffToggleButton truckOrderingToggle open' : 'staffToggleButton truckOrderingToggle closed'}
            onClick={() => updateTruckOrderingOpen(!truckOrderingOpen)}
            disabled={Boolean(updatingSetting)}
          >
            {updatingSetting === 'TruckOrderingOpen' ? 'Saving...' : truckOrderingOpen ? 'Truck Ordering Is Open' : 'Truck Ordering Is Closed'}
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

      <div className="staffLeadTimeNotice">
        <Clock size={18} />
        <strong>20 minutes lead time for turn orders.</strong>
        <span>Please set expectations with members and guests during busy periods.</span>
      </div>

      {err && <div className="alert staffAlert"><AlertTriangle size={18} />{err}</div>}
      {soundError && <div className="alert staffAlert"><AlertTriangle size={18} />{soundError}</div>}
      {newOrderAlert && <div className="staffNewOrderAlert"><AlertTriangle size={18} /> New truck order received</div>}

      <section className="staffStats truckStats">
        <div className="staffStat new"><strong>{activeCount}</strong><span>Active truck orders</span></div>
        <div className="staffStat ready"><strong>{readyCount}</strong><span>Ready for pickup</span></div>
        <div className="staffStat completed"><strong>{completedToday}</strong><span>Completed today</span></div>
        <div className="staffStat pos"><strong>{needsPosCount}</strong><span>Need POS posting · {currency(needsPosTotal)}</span></div>
        <div className="staffStat revenue"><strong>{currency(totalToday)}</strong><span>Truck total</span></div>
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
                  : <div className="staffEmpty">{truckEmptyLabel(column)}</div>}
              </div>
            </div>
          );
        })}
      </section>

      <section className="managerPanels truckManagerPanels">
        <div className="managerPanel posPanel">
          <div className="managerPanelHead">
            <h3>Truck POS Reconciliation</h3>
            <span>{shortDate()}</span>
          </div>
          <p className="managerHint">At pickup, collect card payment, complete the order, then mark POS posted after it is entered in the register.</p>
          <div className="closingGrid">
            <div><strong>{completedToday}</strong><span>Completed</span></div>
            <div><strong>{postedToday}</strong><span>POS posted</span></div>
            <div className={needsPosCount ? 'attention' : ''}><strong>{needsPosCount}</strong><span>Need POS posting</span></div>
            <div><strong>{currency(totalToday)}</strong><span>Total incl. fees</span></div>
          </div>
          <div className="dailyReportBox">
            <div className="dailyReportHead">
              <div>
                <h4>Daily Closeout Report</h4>
                <span>{reportCompletedOrders.length} completed orders</span>
              </div>
              <label>Date
                <input type="date" value={reportDate} onChange={event => setReportDate(event.target.value)} />
              </label>
            </div>
            <div className="dailyReportGrid">
              <div><strong>{currency(reportSubtotal)}</strong><span>Subtotal</span></div>
              <div><strong>{currency(reportServiceFees)}</strong><span>Service fees</span></div>
              <div><strong>{currency(reportCardFees)}</strong><span>Card fees</span></div>
              <div><strong>{currency(reportTips)}</strong><span>Tips</span></div>
              <div><strong>{reportPosPostedCount}/{reportCompletedOrders.length}</strong><span>POS posted</span></div>
              <div className={reportNeedsPosCount ? 'attention' : ''}><strong>{currency(reportTotal)}</strong><span>Closeout total</span></div>
            </div>
            <button className="exportReportButton" type="button" onClick={exportTruckDailyReport} disabled={!reportOrdersForDate.length}>
              <Download size={16} /> Export CSV
            </button>
          </div>
          {needsPosCount > 0
            ? <p className="closingNote">Closing check: mark all completed truck orders as POS posted.</p>
            : <p className="closingNote good">Truck POS reconciliation is clear.</p>}
        </div>

        <div className="managerPanel tipPanel">
          <div className="managerPanelHead">
            <h3>Tip Reconciliation</h3>
            <span>{currency(todaysTipTotal)}</span>
          </div>
          <p className="managerHint">Use this as the daily tip check before closing out truck orders in the POS.</p>
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

        <div className="managerPanel availabilityPanel">
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
          <div className="availabilityScrollCue">Scroll for more menu items</div>
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
    { title: 'Menu & Member Update Sheet', href: GOOGLE_SHEET_URL, detail: 'Menus, member numbers, settings, and order logs' }
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
          <div className="opsBackendNote">
            <strong>Need website/app changes?</strong>
            <span>Notify the developer to push updates.</span>
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
              <li>Use <strong>CustomerType</strong> for truck fee rules: Golf Member or RSM.</li>
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

function TruckOperationsGuide() {
  const links = [
    {
      title: 'Turn Truck Ordering',
      body: 'Customer-Side ordering for golfers at the turn.',
      href: `${PUBLIC_BASE_URL}/truck`,
      Icon: Truck,
      type: 'member',
      showQr: true,
      guideHref: `${PUBLIC_BASE_URL}/truck-user-guide.html`
    },
    {
      title: 'Truck Staff Dashboard',
      body: 'New orders, preparing, ready for pickup, sold-out controls, and closeout.',
      href: `${PUBLIC_BASE_URL}/truck-admin`,
      Icon: ChefHat,
      type: 'staff',
      showQr: false,
      password: TRUCK_PASSWORD
    }
  ];

  return (
    <div className="opsGuide truckOnlyGuide">
      <section className="opsHero truckOpsHero">
        <div className="opsHeroBrand">
          <img src="/eastpointe-logo-tight.png" alt="Eastpointe Country Club" />
          <div>
            <p className="eyebrow">Eastpointe Country Club</p>
            <h1>The Turn Truck Staff Dashboard Tutorial</h1>
            <p>A truck-specific quick guide for QR ordering, iPad staff use, menu availability, and daily closeout.</p>
          </div>
        </div>
        <div className="opsMotifs" aria-label="Turn Truck highlights">
          <span><Flag size={15} /> Golf course pickup</span>
          <span><QrCode size={15} /> QR-ready</span>
          <span><Truck size={15} /> Truck staff iPad</span>
        </div>
      </section>

      <section className="opsSection truckStartSection">
        <div className="opsSectionHead">
          <div>
            <p className="sectionKicker"><Flag size={15} /> Start here</p>
            <h2>Truck Shift Work Flow</h2>
          </div>
          <p>A quick path for staff working the truck today.</p>
        </div>
        <div className="truckFlow">
          {[
            ['1', 'Shift Start: Open Dashboard', 'Open the Truck Staff Dashboard on the iPad.', Home],
            ['2', 'Check Truck Open Status', 'Confirm Truck Ordering Is Open or Closed.', Eye],
            ['3', 'Review Inventory', 'Mark sold-out items before orders start.', ClipboardList],
            ['4', 'Wait for Orders', 'Move orders through Preparing and Ready for Pickup.', Truck],
            ['5', 'End Shift Closeout', 'Complete orders, mark POS posted, and export the report.', Download]
          ].map(([number, title, body, Icon]) => (
            <div className="truckFlowStep" key={number}>
              <strong>{number}</strong>
              <Icon size={22} />
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="opsSection">
        <div className="opsSectionHead">
          <div>
            <p className="sectionKicker"><QrCode size={15} /> Truck-only links</p>
            <h2>Turn Truck QR & Staff Links</h2>
          </div>
          <p>Use these for the truck QR code, staff iPad bookmark, and manager training.</p>
        </div>
        <div className="opsLinkGrid truckOpsLinkGrid">
          {links.map(({ title, body, href, guideHref, Icon, type, showQr, password }) => (
            <article className={`opsLinkCard ${type === 'staff' ? 'staffArea' : ''}`} key={title}>
              <div className="opsLinkIcon"><Icon size={22} /></div>
              <div>
                {type === 'staff' && <span className="opsStaffBadge">Staff area</span>}
                <h3>{title}</h3>
                <p>{body}</p>
                {password && <p className="opsPasswordHint"><Lock size={14} /> Password: <strong>{password}</strong></p>}
              </div>
              {showQr
                ? <img className="opsQr" src={qrUrl(href)} alt={`${title} QR code`} />
                : null}
              <div className="opsLinkActions">
                <a href={href} target="_blank" rel="noreferrer">Open link <ExternalLink size={14} /></a>
                {guideHref && <a className="secondary" href={guideHref} target="_blank" rel="noreferrer">User guide on how to order <ExternalLink size={14} /></a>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="opsSection opsTwoCol">
        <div className="opsPanel">
          <p className="sectionKicker"><BookOpen size={15} /> During service</p>
          <h2>Truck Staff Workflow</h2>
          <div className="opsSteps">
            <div><strong>1</strong><span>Open the Truck Staff Dashboard on the iPad. Sound is on by default; tap Sound On / Test if you want to confirm audio.</span></div>
            <div><strong>2</strong><span>Use Truck Ordering Is Open or Closed to control whether customers can place orders.</span></div>
            <div><strong>3</strong><span>Move orders from New Order Waiting to Preparing, then Ready for Pickup, then Completed.</span></div>
            <div><strong>4</strong><span>Use Truck Menu Availability to mark sold-out items without editing the Google Sheet during service.</span></div>
          </div>
        </div>

        <div className="opsPanel opsRolesPanel">
          <p className="sectionKicker"><Users size={15} /> Who does what</p>
          <h2>Truck Roles</h2>
          <div className="opsRolesGrid">
            <div className="serviceRole">
              <h3>Truck Staff</h3>
              <ul>
                <li>Acknowledge and prepare orders</li>
                <li>Mark orders ready for pickup</li>
                <li>Mark items sold out or available</li>
                <li>Collect guest card payment at pickup</li>
              </ul>
            </div>
            <div>
              <h3>Managers / Admin</h3>
              <ul>
                <li>Update truck menu items and pricing</li>
                <li>Maintain member numbers and CustomerType</li>
                <li>Review TruckOrders</li>
                <li>Export closeout reports</li>
              </ul>
            </div>
            <div className="doNotEditRole">
              <h3>Do Not Edit During Service</h3>
              <ul>
                <li>TruckMenuItems rows</li>
                <li>Members rows</li>
                <li>Pricing</li>
                <li>Sort order</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="opsSection">
        <div className="opsSectionHead">
          <div>
            <p className="sectionKicker"><TableProperties size={15} /> Visual walkthrough</p>
            <h2>What Staff Should Click</h2>
          </div>
          <p>Use these as quick screen references during training or a shift handoff.</p>
        </div>
        <div className="screenWalkthroughGrid">
          <article className="screenWalkthroughCard">
            <h3>Truck dashboard</h3>
            <div className="miniDashboard" aria-label="Truck dashboard visual guide">
              <div className="miniTopBar">
                <span className="calloutDot">1</span>
                <strong>Truck Ordering Is Open</strong>
              </div>
              <div className="miniStats">
                <span>6 Active</span>
                <span>5 Ready</span>
                <span>3 Completed</span>
              </div>
              <div className="miniColumns">
                <div><span className="calloutDot">2</span><strong>New Order Waiting</strong></div>
                <div><span className="calloutDot">3</span><strong>Preparing</strong></div>
                <div><span className="calloutDot">4</span><strong>Ready for Pickup</strong></div>
              </div>
            </div>
            <ol className="calloutList">
              <li>Open or close ordering.</li>
              <li>Start new orders here.</li>
              <li>Use Preparing after staff acknowledges the order.</li>
              <li>Move here only when the order is ready.</li>
            </ol>
          </article>

          <article className="screenWalkthroughCard">
            <h3>Order ticket</h3>
            <div className="miniTicket" aria-label="Truck order ticket visual guide">
              <div className="miniTicketHead"><strong>#5012</strong><span>Just now</span></div>
              <div className="miniTicketBody">
                <span>1x Hot Dog</span>
                <span>1x Arnold Palmer</span>
              </div>
              <div className="miniTicketFees">
                <span>Subtotal</span><strong>$14.00</strong>
                <span>Tip</span><strong>$2.80</strong>
              </div>
              <button type="button"><span className="calloutDot">1</span> Start Preparing</button>
              <button type="button" className="secondary"><span className="calloutDot">2</span> Ticket</button>
            </div>
            <ol className="calloutList">
              <li>Use the main button to move the order forward.</li>
              <li>Print or view the ticket when staff needs a physical chit.</li>
            </ol>
          </article>

          <article className="screenWalkthroughCard">
            <h3>Menu availability</h3>
            <div className="miniAvailability" aria-label="Truck menu availability visual guide">
              <div className="miniAvailabilityHead"><strong>Truck Menu Availability</strong><span>0 unavailable</span></div>
              <div className="miniAvailabilityRow">
                <span>Hot Dog</span>
                <button type="button"><span className="calloutDot">1</span> Available</button>
              </div>
              <div className="miniAvailabilityRow sold">
                <span>The Smashed Burger</span>
                <button type="button"><span className="calloutDot">2</span> Sold Out</button>
              </div>
              <small>Scroll for more menu items</small>
            </div>
            <ol className="calloutList">
              <li>Tap Available to mark an item sold out.</li>
              <li>Tap Sold Out to make the item available again.</li>
            </ol>
          </article>
        </div>
      </section>

      <section className="opsSection">
        <div className="opsSectionHead">
          <div>
            <p className="sectionKicker"><ClipboardList size={15} /> Shift cheat sheet</p>
            <h2>One-Page Truck Checklist</h2>
          </div>
          <p>Use this as the fast pre-shift, live-shift, and closeout reference.</p>
        </div>
        <div className="opsInfoGrid cheatSheetGrid">
          <article>
            <h3>Before Service</h3>
            <ul>
              <li>Open the Truck Staff Dashboard.</li>
              <li>Tap Sound On / Test if you want to confirm iPad audio.</li>
              <li>Confirm ordering is open or intentionally closed.</li>
              <li>Review sold-out items and prices.</li>
              <li>Place one test order only if needed.</li>
            </ul>
          </article>
          <article>
            <h3>During Service</h3>
            <ul>
              <li>Watch New Order Waiting.</li>
              <li>Move orders to Preparing when acknowledged.</li>
              <li>Mark Ready for Pickup only when ready.</li>
              <li>Mark sold-out items immediately.</li>
              <li>Watch for duplicate member questions.</li>
            </ul>
          </article>
          <article>
            <h3>After Service</h3>
            <ul>
              <li>Complete picked-up orders.</li>
              <li>Mark POS posted after entry in the register.</li>
              <li>Export the daily closeout report.</li>
              <li>Report any app or order issues.</li>
              <li>Close ordering if the truck is finished.</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="opsSection">
        <div className="opsSectionHead">
          <div>
            <p className="sectionKicker"><ClipboardList size={15} /> Order status</p>
            <h2>What Each Status Means</h2>
          </div>
          <p>Use these meanings consistently so members and staff see the same flow.</p>
        </div>
        <div className="statusGuideTable">
          {[
            ['New Order Waiting', 'Order received by the dashboard.', 'Review the ticket and start preparing.', 'new'],
            ['Preparing', 'Truck staff acknowledged the order.', 'Make the food or drinks.', 'preparing'],
            ['Ready for Pickup', 'The order is ready at the truck.', 'Serve the member or guest at pickup.', 'ready'],
            ['Completed', 'The order was picked up or finished.', 'Mark POS posted after register entry.', 'completed'],
            ['Cancelled', 'The order should not be made.', 'Confirm reason if needed.', 'cancelled']
          ].map(([status, meaning, action, tone]) => (
            <div className={`statusGuideRow ${tone}`} key={status}>
              <strong>{status}</strong>
              <span>{meaning}</span>
              <span>{action}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="opsSection">
        <div className="opsSectionHead">
          <div>
            <p className="sectionKicker"><AlertTriangle size={15} /> What to do if</p>
            <h2>Truck Troubleshooting Help</h2>
          </div>
        </div>
        <div className="decisionTree">
          <div className="decisionNode start"><strong>Order or issue comes in</strong></div>
          <div className="decisionBranches">
            <div>
              <strong>Item unavailable?</strong>
              <span>Mark sold out, tell the lead, and offer another item.</span>
            </div>
            <div>
              <strong>Order not showing?</strong>
              <span>Refresh, check name or order number, then escalate.</span>
            </div>
            <div>
              <strong>Order ready?</strong>
              <span>Mark Ready for Pickup, then Complete after pickup.</span>
            </div>
          </div>
        </div>
        <div className="opsInfoGrid troubleGrid">
          <article>
            <h3>An item is sold out</h3>
            <p>Mark it unavailable in Truck Menu Availability right away, then tell the truck lead.</p>
          </article>
          <article>
            <h3>A member says they ordered</h3>
            <p>Refresh the dashboard, check the member name or order number, then escalate if it still does not appear.</p>
          </article>
          <article>
            <h3>An order is wrong</h3>
            <p>Do not duplicate the order. Correct it operationally if possible, or notify the manager/admin.</p>
          </article>
          <article>
            <h3>The app freezes</h3>
            <p>Refresh once. If needed, close and reopen the browser tab, then contact the lead.</p>
          </article>
          <article>
            <h3>Guest payment is due</h3>
            <p>Collect card payment at pickup before releasing the order.</p>
          </article>
          <article>
            <h3>New-order sound is quiet</h3>
            <p>Tap Enable Sound on the dashboard, turn up iPad volume, and keep the page open.</p>
          </article>
        </div>
      </section>

      <section className="opsSection">
        <div className="opsSectionHead">
          <div>
            <p className="sectionKicker"><MessageCircle size={15} /> Staff scripts</p>
            <h2>What To Say</h2>
          </div>
          <p>Short scripts keep the member experience polished and consistent.</p>
        </div>
        <div className="scriptGrid">
          <div>
            <span className="scriptIcon"><UserRound size={20} /><MessageCircle size={18} /></span>
            <h3>If a member asks how to order</h3>
            <p>Please scan the Turn Truck QR code, choose your items, and submit your order. The truck team will receive it directly.</p>
          </div>
          <div>
            <span className="scriptIcon"><AlertTriangle size={20} /><MessageCircle size={18} /></span>
            <h3>If an item is sold out</h3>
            <p>I am sorry, that item is no longer available today. We are updating the ordering screen now.</p>
          </div>
          <div>
            <span className="scriptIcon"><Truck size={20} /><MessageCircle size={18} /></span>
            <h3>If there is a delay</h3>
            <p>The truck team has your order and is working through the queue. We appreciate your patience.</p>
          </div>
        </div>
      </section>

      <section className="opsSection opsTwoCol">
        <div className="opsPanel">
          <p className="sectionKicker"><AlertTriangle size={15} /> Avoid these</p>
          <h2>Common Mistakes</h2>
          <div className="opsSteps mistakeList">
            <div><strong>1</strong><span>Do not mark Completed until the order has actually been picked up.</span></div>
            <div><strong>2</strong><span>Do not leave sold-out items active in the system.</span></div>
          </div>
        </div>

        <div className="opsPanel">
          <p className="sectionKicker"><ShieldCheck size={15} /> Staff Training sign-off</p>
          <h2>Manager Checklist</h2>
          <div className="opsSteps">
            <div><strong>1</strong><span>Staff member can open the correct truck links.</span></div>
            <div><strong>2</strong><span>Staff member can process a sample order.</span></div>
            <div><strong>3</strong><span>Staff member can mark an item sold out.</span></div>
            <div><strong>4</strong><span>Staff member can complete an order and mark POS posted.</span></div>
          </div>
        </div>
      </section>

      <section className="opsFooterCard">
        <img src="/eastpointe-logo-tight.png" alt="" />
        <div>
          <h2>Recommended truck setup</h2>
          <p>Print the Turn Truck QR code, bookmark the Truck Staff Dashboard on the iPad, and use the dashboard during service. Use the Google Sheet only for manager-level menu and member updates.</p>
        </div>
      </section>

      <details className="opsSection managerReference">
        <summary>
          <div className="managerSummaryCopy">
            <span className="sectionKicker"><ShieldCheck size={15} /> Manager reference</span>
            <strong>Truck backend: Menu, Members & Closeout</strong>
            <p>Step-by-step setup guide for the person responsible for menu changes, member updates, and end-of-shift closeout.</p>
          </div>
          <em>Open only for manager/admin setup</em>
        </summary>
        <div className="managerReferenceBody">
          <div className="managerIntroPanel">
            <div>
              <p className="sectionKicker"><Lock size={15} /> Manager/admin only</p>
              <h2>Daily staff should use the dashboard. Managers use the sheet.</h2>
              <p>During service, do not edit menu rows, pricing, member numbers, or sort order unless a manager is making an intentional backend change.</p>
            </div>
            <a href={GOOGLE_SHEET_URL} target="_blank" rel="noreferrer">
              Open Menu & Member Update Sheet <ExternalLink size={16} />
            </a>
          </div>

          <div className="managerGuideGrid">
            <article className="managerGuideCard">
              <span className="managerGuideIcon"><TableProperties size={22} /></span>
              <h3>1. Update truck menu items</h3>
              <p>Use the <strong>TruckMenuItems</strong> tab for the truck menu only. One row equals one item members can order.</p>
              <ul>
                <li><strong>ItemName</strong>: what the customer sees.</li>
                <li><strong>Description</strong>: short menu description.</li>
                <li><strong>Price</strong>: number only, no dollar sign.</li>
                <li><strong>Available</strong>: TRUE shows the item; FALSE hides it.</li>
                <li><strong>Modifiers</strong>: controls item customization buttons.</li>
                <li><strong>Alcoholic</strong>: TRUE triggers the age/ID warning.</li>
                <li><strong>SortOrder</strong>: controls customer menu order.</li>
              </ul>
            </article>
            <article className="managerGuideCard">
              <span className="managerGuideIcon"><Users size={22} /></span>
              <h3>2. Add or update member numbers</h3>
              <p>Use the <strong>Members</strong> tab. Member numbers must stay as text when they start with zero.</p>
              <ul>
                <li><strong>MemberNumber</strong>: 4-6 digits, keep leading zeroes.</li>
                <li><strong>Status</strong>: Active allows ordering.</li>
                <li><strong>CustomerType</strong>: controls truck fee visibility.</li>
                <li><strong>Golf Member</strong>: no service fee.</li>
                <li><strong>RSM</strong>: visible 22% service fee.</li>
                <li><strong>Guest - Pay at Pickup</strong>: visible 20% service charge plus visible 3% credit card service charge.</li>
              </ul>
            </article>
            <article className="managerGuideCard">
              <span className="managerGuideIcon"><Download size={22} /></span>
              <h3>3. Close out and reconcile</h3>
              <p>Use the <strong>TruckOrders</strong> tab and dashboard exports as the permanent truck order record.</p>
              <ul>
                <li>Review completed orders.</li>
                <li>Check service fees, card fees, and tips.</li>
                <li>Use the dashboard export for daily POS closeout.</li>
                <li>Confirm POS posted items before ending the shift.</li>
              </ul>
            </article>
          </div>

          <div className="managerDoDontGrid">
            <article>
              <h3>Okay during service</h3>
              <ul>
                <li>Mark a truck item sold out from the dashboard.</li>
                <li>Open or close truck ordering from the dashboard.</li>
                <li>Export a daily report for POS closeout.</li>
              </ul>
            </article>
            <article>
              <h3>Manager changes only</h3>
              <ul>
                <li>Add new menu rows or change prices.</li>
                <li>Add/remove member numbers.</li>
                <li>Change CustomerType, modifiers, or sort order.</li>
              </ul>
            </article>
          </div>

          <div className="opsPanel ownerToolsPanel">
            <p className="sectionKicker"><ExternalLink size={15} /> Owner tools</p>
            <h2>Truck Admin Links</h2>
            <div className="opsBackendLinks">
              <a href={GOOGLE_SHEET_URL} target="_blank" rel="noreferrer">
                <strong>Menu & Member Update Sheet</strong>
                <span>TruckMenuItems, Members, Settings, and TruckOrders</span>
                <ExternalLink size={16} />
              </a>
            </div>
            <div className="opsBackendNote">
              <strong>Need website/app changes?</strong>
              <span>Notify the developer to push updates.</span>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

export default function App() {
  const initialMode = window.location.pathname.includes('/truck-admin')
    ? 'truck-admin'
    : window.location.pathname.includes('/truck-operations-guide')
      ? 'truck-operations-guide'
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
        : mode === 'truck-operations-guide'
          ? '/truck-operations-guide'
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
    : mode === 'operations-guide' || mode === 'truck-operations-guide'
      ? 'app opsApp'
      : 'app';
  const showCustomerFooter = mode !== 'admin' && mode !== 'truck-admin' && mode !== 'operations-guide' && mode !== 'truck-operations-guide';
  return (
    <main className={mainClass}>
      <AppErrorBoundary key={mode}>
        {mode === 'operations-guide' && <OperationsGuide />}
        {mode === 'truck-operations-guide' && <TruckOperationsGuide />}
        {mode === 'order' && <Header mode={mode} setMode={setMode} />}
        {isTruckMode && mode !== 'truck-admin' && <TruckHeader />}
        {mode === 'admin' && <AdminPage onBackToOrder={() => setMode('order')} />}
        {mode === 'truck-admin' && <TruckAdminPage onBackToOrder={() => setMode('truck')} />}
        {mode === 'truck' && <TruckOrderPage />}
        {mode === 'order' && <OrderPage />}
        {showCustomerFooter && <footer>{mode === 'truck' ? 'Members charge account. Guests pay staff at pickup.' : 'Members charge account. Guests pay staff at pickup. No online payment processing.'}</footer>}
      </AppErrorBoundary>
    </main>
  );
}
