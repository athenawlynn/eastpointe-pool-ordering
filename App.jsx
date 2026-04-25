
import React, { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, ClipboardList, RefreshCcw, Printer, Lock, CheckCircle, AlertTriangle } from 'lucide-react';

const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL || '';
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'poolstaff';
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || 'CHANGE_ME_ADMIN_KEY';

const STATUSES = ['New', 'Accepted', 'Preparing', 'Ready for Pickup', 'Completed', 'Cancelled'];

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

async function apiGet(action, extra = {}) {
  if (!SCRIPT_URL) throw new Error('Missing VITE_SCRIPT_URL. Add your Apps Script URL in Netlify environment variables.');
  const url = new URL(SCRIPT_URL);
  url.searchParams.set('action', action);
  Object.entries(extra).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function apiPost(action, payload) {
  if (!SCRIPT_URL) throw new Error('Missing VITE_SCRIPT_URL. Add your Apps Script URL in Netlify environment variables.');
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function Header({ mode, setMode }) {
  return (
    <header className="header">
      <div className="brandLockup">
        <img src="/eastpointe-logo.png" alt="Eastpointe Country Club" className="brandLogo" />
        <div>
          <p className="eyebrow">Eastpointe Country Club</p>
          <h1>Poolside Ordering</h1>
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
  const [menu, setMenu] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [activeCat, setActiveCat] = useState('');
  const [quantities, setQuantities] = useState({});
  const [form, setForm] = useState({
    fulfillmentType: 'Pickup',
    memberName: '',
    memberNumber: '',
    phone: '',
    tableNumber: initialTable,
    barRequest: '',
    authorizationAccepted: false,
    alcoholVerificationAccepted: false
  });
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [liveStatus, setLiveStatus] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [menuData, settingsData] = await Promise.all([
          apiGet('menu'),
          apiGet('settings')
        ]);
        setMenu(menuData.items || []);
        setSettings(settingsData.settings || {});
        const cats = [...new Set((menuData.items || []).filter(i => i.available).map(i => i.category))];
        setActiveCat(cats[0] || '');
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const categories = useMemo(() => [...new Set(menu.filter(i => i.available).map(i => i.category))], [menu]);
  const visibleItems = useMemo(() => menu.filter(i => i.category === activeCat), [menu, activeCat]);

  const selectedItems = useMemo(() => {
    return menu
      .filter(item => Number(quantities[item.itemId] || 0) > 0)
      .map(item => ({ ...item, quantity: Number(quantities[item.itemId]) }));
  }, [menu, quantities]);

  const subtotal = selectedItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const hasAlcohol = selectedItems.some(i => i.alcoholic) || form.barRequest.trim().length > 0;
  const hasBarRequest = form.barRequest.trim().length > 0;

  function setField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function validate() {
    if (!['Pickup', 'Delivery'].includes(form.fulfillmentType)) return 'Please choose pickup or delivery.';
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
      setConfirmation({ orderId: res.orderId, pickupLocation: settings.PickupLocation || 'Pool Bar' });
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
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
        setLiveStatus(res.status || '');
      } catch (e) {
        // Avoid interrupting the confirmation screen if status polling fails.
      }
    }
    pollStatus();
    const id = setInterval(pollStatus, 8000);
    return () => clearInterval(id);
  }, [confirmation?.orderId, form.memberNumber]);

  if (loading) return <LoadingCard message="Loading menu..." />;

  if (confirmation) {
    const ready = liveStatus === 'Ready for Pickup';
    const deliveredReady = form.fulfillmentType === 'Delivery' && ready;
    return (
      <div className="stack">
        <div className={ready ? 'card success readyCard' : 'card success'}>
          <CheckCircle size={38} />
          <h2>{ready ? (form.fulfillmentType === 'Delivery' ? 'Order Ready for Delivery' : 'Ready for Pickup') : 'Order Sent'}</h2>
          <p className="big">Order #{confirmation.orderId}</p>
          <p>Thank you, {form.memberName}. Your order has been sent to the pool bar.</p>
          <div className="statusPanel">
            <span>Current Status</span>
            <strong>{liveStatus || 'New'}</strong>
          </div>
          <div className="notice">
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
                ? 'Your order is ready and will be delivered to your table.'
                : 'Your order is ready. Please pick it up at the Pool Bar and provide your name/member number.'}
            </div>
          )}
        </div>
        <button className="primaryButton" onClick={() => window.location.reload()}>Start New Order</button>
      </div>
    );
  }

  return (
    <div className="stack">
      {err && <div className="alert"><AlertTriangle size={18} />{err}</div>}

      <section className="card hero">
        <p className="eyebrow">{settings.ClubName || 'Eastpointe Country Club'}</p>
        <h2>Poolside food & beverage</h2>
        <p>Orders will be charged to your member account. Choose pickup at the pool bar or delivery to your table.</p>
        <div className="tableBadge">{form.fulfillmentType}{form.tableNumber ? ` • Table ${form.tableNumber}` : ''}</div>
      </section>


      <section className="card">
        <h2>How would you like to receive your order?</h2>
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
            onClick={() => setField('fulfillmentType', 'Delivery')}
            type="button"
          >
            <strong>Delivery</strong>
            <span>Delivered to your table. Table number is required.</span>
          </button>
        </div>
      </section>

      <section className="card">
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
        <label>{form.fulfillmentType === 'Delivery' ? 'Delivery Table Number' : 'Table Number, if applicable'}
          <input inputMode="numeric" value={form.tableNumber} onChange={e => setField('tableNumber', e.target.value.replace(/\D/g, ''))} placeholder="1–100" />
          <span className="fieldHint">{form.fulfillmentType === 'Delivery' ? 'Required for delivery.' : 'Optional for pickup; QR codes may prefill this field.'}</span>
        </label>
      </section>

      <section className="card">
        <div className="sectionTitle">
          <h2>Menu</h2>
          <span className="pill">QR table order</span>
        </div>
        {categories.length ? (
          <>
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
          <h2>Your Order</h2>
          <ShoppingCart size={22} />
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
          {submitting ? 'Sending Order...' : 'Submit Order'}
        </button>
      </section>
    </div>
  );
}

function Login({ onLogin }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  function handle() {
    if (pw === ADMIN_PASSWORD) onLogin();
    else setErr('Incorrect password.');
  }
  return (
    <div className="card login">
      <Lock size={28} />
      <h2>Staff Dashboard</h2>
      <p>Enter the staff password to view orders.</p>
      {err && <div className="alert">{err}</div>}
      <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Staff password" onKeyDown={e => e.key === 'Enter' && handle()} />
      <button className="primaryButton" onClick={handle}>Open Dashboard</button>
    </div>
  );
}

function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(sessionStorage.getItem('adminLoggedIn') === 'true');
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('Active');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  async function loadOrders() {
    setLoading(true);
    try {
      const res = await apiGet('orders', { adminKey: ADMIN_KEY });
      setOrders(res.orders || []);
      setLastUpdated(new Date().toLocaleTimeString());
      setErr('');
    } catch (e) {
      setErr(e.message);
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
    try {
      await apiPost('updateStatus', { adminKey: ADMIN_KEY, orderId, status });
      await loadOrders();
    } catch (e) {
      setErr(e.message);
    }
  }

  function printOrder(order) {
    const w = window.open('', '_blank');
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
      `Alcohol: ${order.alcoholIncluded ? 'YES' : 'No'}`
    ].join('\n');
  }

  if (!loggedIn) {
    return <Login onLogin={() => { sessionStorage.setItem('adminLoggedIn', 'true'); setLoggedIn(true); }} />;
  }

  const filtered = orders.filter(o => {
    if (filter === 'Active') return !['Completed', 'Cancelled'].includes(o.status);
    if (filter === 'Food') return o.items?.some(i => !['Non-Alcoholic', 'Beer / Seltzer', 'Wine', 'Featured Cocktails'].includes(i.category));
    if (filter === 'Bar') return o.alcoholIncluded || o.barRequest;
    return o.status === filter;
  });

  return (
    <div className="stack">
      <section className="card">
        <div className="sectionTitle">
          <div>
            <h2>Staff Dashboard</h2>
            <p className="hint">Auto-refreshes every 8 seconds. Last updated: {lastUpdated || '—'}</p>
          </div>
          <button className="ghostButton" onClick={loadOrders} disabled={loading}><RefreshCcw className={loading ? 'spin' : ''} size={18} /> Refresh</button>
        </div>
        {err && <div className="alert"><AlertTriangle size={18} />{err}</div>}
        <div className="tabs">
          {['Active', 'New', 'Accepted', 'Preparing', 'Ready for Pickup', 'Food', 'Bar', 'Completed', 'Cancelled'].map(f => (
            <button className={filter === f ? 'tab active' : 'tab'} key={f} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      </section>

      {filtered.length === 0 ? (
        <EmptyState title="No orders" body="There are no orders in this view." />
      ) : (
        <div className="orderGrid">
          {filtered.map(order => (
            <div className={order.status === 'New' ? 'orderCard newOrder' : 'orderCard'} key={order.orderId}>
              <div className="orderTop">
                <div>
                  <p className="eyebrow">Order #{order.orderId}</p>
                  <h3>Table {order.tableNumber}</h3>
                </div>
                <span className="status">{order.status}</span>
              </div>

              <div className="orderMeta">
                <p><strong>Service:</strong> {order.fulfillmentType || 'Pickup'}</p>
                <p><strong>Member:</strong> {order.memberName}</p>
                <p><strong>Member #:</strong> {order.memberNumber}</p>
                <p><strong>Phone:</strong> {order.phone}</p>
                <p><strong>Time:</strong> {order.timestamp}</p>
              </div>

              {order.alcoholIncluded && <div className="alcoholFlag">Alcohol order — verify member/ID at pickup</div>}

              <div className="itemsBox">
                <h4>Items</h4>
                <pre>{order.itemsSummary || 'No standard items.'}</pre>
                {order.barRequest && (
                  <>
                    <h4>Bar / Cocktail Request</h4>
                    <pre>{order.barRequest}</pre>
                  </>
                )}
              </div>

              <div className="cartTotal">
                <span>Known subtotal</span>
                <strong>{currency(order.subtotalKnownItems)}</strong>
              </div>

              <div className="statusButtons">
                {STATUSES.map(s => (
                  <button key={s} onClick={() => updateStatus(order.orderId, s)} disabled={order.status === s}>{s}</button>
                ))}
              </div>
              <button className="ghostButton full" onClick={() => printOrder(order)}><Printer size={18} /> Print Ticket</button>
            </div>
          ))}
        </div>
      )}
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
    <main className="app">
      <Header mode={mode} setMode={setMode} />
      {mode === 'admin' ? <AdminPage /> : <OrderPage />}
      <footer>Member-account ordering only. No online payment processing.</footer>
    </main>
  );
}
