const STORAGE_KEY = "ricambi-delivery-orders-v1";
const CUSTOMER_KEY = "ricambi-delivery-customer-v1";
const ACCESS_KEY = "ricambi-delivery-access-v1";
const SHOP_SESSION_KEY = "ricambi-delivery-shop-session-v1";

const riders = ["Marco", "Luca", "Antonio", "Salvatore"];
const statuses = [
  { key: "created", label: "Da ritirare", progress: 5 },
  { key: "picked", label: "Ritirato", progress: 28 },
  { key: "moving", label: "In consegna", progress: 58 },
  { key: "near", label: "Sta arrivando", progress: 84 },
  { key: "delivered", label: "Consegnato", progress: 100 }
];

const seedOrders = [
  {
    code: "ORD-1024",
    client: "Officina Rossi",
    address: "Via Appia 41, Caserta",
    rider: "Marco",
    status: "moving",
    updatedAt: Date.now() - 1000 * 60 * 8
  },
  {
    code: "ORD-1025",
    client: "Autocar Service",
    address: "Viale Europa 18, Maddaloni",
    rider: "Luca",
    status: "picked",
    updatedAt: Date.now() - 1000 * 60 * 18
  },
  {
    code: "ORD-1026",
    client: "Meccanica Sud",
    address: "Via Napoli 9, Marcianise",
    rider: "Antonio",
    status: "near",
    updatedAt: Date.now() - 1000 * 60 * 3
  }
];

const state = {
  activeView: "customer",
  selectedOrder: "",
  riderFilter: "all",
  customer: loadCustomer(),
  access: loadAccess(),
  shopSession: loadShopSession(),
  orders: loadOrders(),
  loading: false,
  online: isSupabaseReady()
};

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadOrders() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    saveOrders(seedOrders);
    return seedOrders;
  }

  try {
    return JSON.parse(raw);
  } catch {
    saveOrders(seedOrders);
    return seedOrders;
  }
}

function saveOrders(orders) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  state.orders = orders;
}

function isSupabaseReady() {
  const config = window.RICAMBI_SUPABASE;
  return Boolean(config?.url && config?.anonKey && !config.anonKey.includes("INCOLLA_QUI"));
}

function accessConfig() {
  return window.RICAMBI_ACCESS || { riderPin: "2222" };
}

async function supabaseRequest(path, options = {}) {
  const config = window.RICAMBI_SUPABASE;
  const accessToken = options.accessToken || state.shopSession?.access_token || config.anonKey;
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    throw new Error(`Supabase error ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function supabaseAuth(path, body) {
  const config = window.RICAMBI_SUPABASE;
  const response = await fetch(`${config.url}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Supabase auth error ${response.status}`);
  }

  return response.json();
}

async function shopLogin(email, password) {
  const session = await supabaseAuth("token?grant_type=password", {
    email,
    password
  });

  saveShopSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: Date.now() + (session.expires_in || 3600) * 1000,
    email: session.user?.email || email
  });
}

function mapSupabaseOrder(row) {
  return {
    id: row.id,
    code: row.code,
    client: row.customer_name,
    phone: row.customer_phone || "",
    address: row.delivery_address,
    rider: row.rider_name || "Da assegnare",
    status: row.status,
    updatedAt: Date.parse(row.updated_at || row.created_at || new Date().toISOString())
  };
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("39")) return digits;
  if (digits.length >= 9) return `39${digits}`;
  return digits;
}

function canCustomerViewOrder(order) {
  if (!state.customer) return false;
  const customerPhone = normalizePhone(state.customer.phone);
  const orderPhone = normalizePhone(order.phone);
  return Boolean(customerPhone && orderPhone && customerPhone === orderPhone);
}

function mapOrderPatchForSupabase(patch) {
  const mapped = { updated_at: new Date().toISOString() };
  if (patch.status) mapped.status = patch.status;
  if (patch.status === "delivered") mapped.delivered_at = new Date().toISOString();
  return mapped;
}

async function refreshOrders(options = {}) {
  const { silent = false, reportErrors = true } = options;

  if (!isSupabaseReady()) {
    state.online = false;
    state.orders = loadOrders();
    renderAll();
    return;
  }

  state.online = true;
  if (!silent) {
    state.loading = true;
    renderAll();
  }

  try {
    const rows = await supabaseRequest("orders?select=*&order=created_at.desc");
    state.orders = rows.map(mapSupabaseOrder);
  } catch (error) {
    state.online = false;
    state.orders = loadOrders();
    if (reportErrors) {
      alert("Supabase non risponde ancora. Uso i dati demo sul dispositivo.");
    }
  } finally {
    state.loading = false;
    renderAll();
  }
}

function loadCustomer() {
  const raw = localStorage.getItem(CUSTOMER_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(CUSTOMER_KEY);
    return null;
  }
}

function saveCustomer(customer) {
  state.customer = customer;
  localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
}

function clearCustomer() {
  state.customer = null;
  localStorage.removeItem(CUSTOMER_KEY);
}

function loadAccess() {
  const raw = localStorage.getItem(ACCESS_KEY);
  if (!raw) return { rider: false, shop: false };

  try {
    return { rider: false, shop: false, ...JSON.parse(raw) };
  } catch {
    localStorage.removeItem(ACCESS_KEY);
    return { rider: false, shop: false };
  }
}

function saveAccess(patch) {
  state.access = { ...state.access, ...patch };
  localStorage.setItem(ACCESS_KEY, JSON.stringify(state.access));
}

function loadShopSession() {
  const raw = localStorage.getItem(SHOP_SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(SHOP_SESSION_KEY);
    return null;
  }
}

function saveShopSession(session) {
  state.shopSession = session;
  localStorage.setItem(SHOP_SESSION_KEY, JSON.stringify(session));
  saveAccess({ shop: true });
}

function clearShopSession() {
  state.shopSession = null;
  localStorage.removeItem(SHOP_SESSION_KEY);
  saveAccess({ shop: false });
}

function statusIndex(key) {
  return Math.max(0, statuses.findIndex((status) => status.key === key));
}

function statusMeta(key) {
  return statuses[statusIndex(key)] || statuses[0];
}

function timeAgo(timestamp) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.round(minutes / 60);
  return `${hours} ore fa`;
}

function setActiveView(view) {
  state.activeView = view;
  qsa(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === view));
  qsa(".view").forEach((panel) => panel.classList.toggle("is-active", panel.id === `${view}-view`));
}

function renderRiderOptions() {
  const filter = qs("#rider-filter");
  const select = qs("#new-rider");

  filter.innerHTML = '<option value="all">Tutti</option>';
  select.innerHTML = "";

  riders.forEach((rider) => {
    filter.append(new Option(rider, rider));
    select.append(new Option(rider, rider));
  });

  filter.value = state.riderFilter;
}

function renderAll() {
  renderRiderOptions();
  renderCustomerLogin();
  renderStaffAccess();
  renderCustomer();
  renderRider();
  renderShop();
}

function renderStaffAccess() {
  const riderLogin = qs("#rider-login-panel");
  const riderProtected = qs("#rider-protected");
  const shopLogin = qs("#shop-login-panel");
  const shopProtected = qs("#shop-protected");

  riderLogin.hidden = state.access.rider;
  riderProtected.hidden = !state.access.rider;
  shopLogin.hidden = Boolean(state.shopSession);
  shopProtected.hidden = !state.shopSession;
}

function renderCustomerLogin() {
  const login = qs("#customer-login-panel");
  const account = qs("#customer-account");
  const accountName = qs("#customer-account-name");
  const searchButton = qs("#order-search button");
  const orderInput = qs("#order-code");

  login.hidden = Boolean(state.customer);
  account.hidden = !state.customer;
  searchButton.disabled = !state.customer;
  orderInput.disabled = !state.customer;

  if (state.customer) {
    accountName.textContent = `${state.customer.name} - ${state.customer.phone}`;
  }
}

function renderCustomer() {
  const result = qs("#customer-result");
  const orders = state.orders;
  const code = state.selectedOrder.trim().toUpperCase();

  if (state.loading) {
    result.innerHTML = '<div class="empty-state">Carico gli ordini...</div>';
    return;
  }

  if (!state.customer) {
    result.innerHTML = '<div class="empty-state">Accedi come cliente, poi inserisci il numero ordine.</div>';
    return;
  }

  if (!code) {
    result.innerHTML = '<div class="empty-state">Inserisci il numero ordine per vedere lo stato della consegna.</div>';
    return;
  }

  const order = orders.find((item) => item.code.toUpperCase() === code);
  result.innerHTML = "";

  if (!order) {
    result.innerHTML = '<div class="empty-state">Ordine non trovato. Controlla il numero e riprova.</div>';
    return;
  }

  if (!canCustomerViewOrder(order)) {
    result.innerHTML = '<div class="empty-state">Questo ordine non risulta associato al telefono inserito.</div>';
    return;
  }

  result.append(renderOrderCard(order, "customer"));
}

function renderRider() {
  const list = qs("#rider-list");
  if (!state.access.rider) {
    list.innerHTML = "";
    return;
  }

  const orders = state.orders.filter((order) => (
    state.riderFilter === "all" ? order.status !== "delivered" : order.rider === state.riderFilter
  ));

  list.innerHTML = "";

  if (!orders.length) {
    list.innerHTML = '<div class="empty-state">Nessuna consegna da mostrare.</div>';
    return;
  }

  orders.forEach((order) => list.append(renderOrderCard(order, "rider")));
}

function renderShop() {
  const list = qs("#shop-list");
  if (!state.shopSession) {
    list.innerHTML = "";
    return;
  }

  const orders = state.orders;
  list.innerHTML = "";

  orders.forEach((order) => list.append(renderOrderCard(order, "shop")));
}

function renderOrderCard(order, mode) {
  const template = qs("#order-card-template");
  const card = template.content.firstElementChild.cloneNode(true);
  const currentIndex = statusIndex(order.status);
  const meta = statusMeta(order.status);

  qs(".order-code", card).textContent = order.code;
  qs(".client-name", card).textContent = order.client;
  qs(".address", card).textContent = order.address;
  qs(".badge", card).textContent = meta.label;
  qs(".progress-fill", card).style.width = `${meta.progress}%`;

  const steps = qs(".steps", card);
  statuses.forEach((status, index) => {
    const li = document.createElement("li");
    li.textContent = status.label;
    li.classList.toggle("is-done", index <= currentIndex);
    steps.append(li);
  });

  positionRider(qs(".rider-pin", card), meta.progress);

  const metaRow = qs(".meta-row", card);
  metaRow.append(createPill(`Rider: ${order.rider}`));
  metaRow.append(createPill(`Aggiornato: ${timeAgo(order.updatedAt)}`));
  if (mode === "customer" && state.customer) {
    metaRow.append(createPill(`Cliente: ${state.customer.name}`));
  }

  const actions = qs(".actions", card);
  if (mode === "rider") renderRiderActions(actions, order);
  if (mode === "shop") renderShopActions(actions, order);
  if (mode === "customer") {
    actions.append(createButton("Aggiorna", "secondary", () => refreshOrders()));
    actions.append(createButton("Copia link", "secondary", () => copyCustomerLink(order.code)));
  }

  return card;
}

function createPill(text) {
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = text;
  return pill;
}

function createButton(label, variant, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `action-button ${variant || ""}`.trim();
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderRiderActions(container, order) {
  const currentIndex = statusIndex(order.status);
  const next = statuses[currentIndex + 1];

  if (next) {
    container.append(createButton(next.label, "", () => updateOrder(order.code, { status: next.key })));
  }

  if (order.status !== "created") {
    const previous = statuses[currentIndex - 1];
    if (previous) {
      container.append(createButton("Indietro", "secondary", () => updateOrder(order.code, { status: previous.key })));
    }
  }
}

function renderShopActions(container, order) {
  container.append(createButton("Link cliente", "secondary", () => copyCustomerLink(order.code)));
  container.append(createButton("Invia WhatsApp", "secondary", () => openWhatsApp(order)));
  container.append(createButton("Segna consegnato", "", () => updateOrder(order.code, { status: "delivered" })));
}

function positionRider(pin, progress) {
  const x = 8 + progress * 0.72;
  const y = 17 + progress * 0.42;
  pin.style.left = `${x}%`;
  pin.style.bottom = `${y}%`;
}

async function updateOrder(code, patch) {
  if (isSupabaseReady()) {
    try {
      await supabaseRequest(`orders?code=eq.${encodeURIComponent(code)}`, {
        method: "PATCH",
        body: mapOrderPatchForSupabase(patch)
      });
      await refreshOrders();
      return;
    } catch {
      alert("Aggiornamento online non riuscito. Riprova tra poco.");
      return;
    }
  }

  const orders = state.orders.map((order) => (
    order.code === code ? { ...order, ...patch, updatedAt: Date.now() } : order
  ));
  saveOrders(orders);
  renderAll();
}

async function copyCustomerLink(code) {
  const url = trackingLink(code);
  state.selectedOrder = code;
  qs("#order-code").value = code;
  setActiveView("customer");
  await refreshOrders({ silent: true, reportErrors: false });

  try {
    await navigator.clipboard.writeText(url);
  } catch {
    window.prompt("Link cliente", url);
  }
}

function trackingLink(code) {
  const configuredUrl = window.RICAMBI_APP?.publicUrl;
  const baseUrl = configuredUrl || location.href.split("?")[0];
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}?ordine=${encodeURIComponent(code)}`;
}

function openWhatsApp(order) {
  const url = trackingLink(order.code);
  const message = `Ciao ${order.client}, puoi seguire la consegna del tuo ordine ${order.code} qui: ${url}`;
  const phone = normalizePhone(order.phone);
  const whatsappUrl = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  window.open(whatsappUrl, "_blank", "noopener");
}

async function createOrder(form) {
  const data = new FormData(form);
  const orders = state.orders;
  const code = String(data.get("code")).trim().toUpperCase();

  if (orders.some((order) => order.code.toUpperCase() === code)) {
    alert("Questo numero ordine esiste gia.");
    return;
  }

  const order = {
    code,
    client: String(data.get("client")).trim(),
    phone: String(data.get("phone")).trim(),
    address: String(data.get("address")).trim(),
    rider: String(data.get("rider")),
    status: "created",
    updatedAt: Date.now()
  };

  if (isSupabaseReady()) {
    try {
      await supabaseRequest("orders", {
        method: "POST",
        body: {
          code: order.code,
          customer_name: order.client,
          customer_phone: order.phone || state.customer?.phone || null,
          delivery_address: order.address,
          rider_name: order.rider,
          status: order.status
        }
      });
      form.reset();
      await refreshOrders();
      return;
    } catch {
      alert("Ordine non creato su Supabase. Controlla chiave e schema.");
      return;
    }
  }

  orders.unshift(order);

  saveOrders(orders);
  form.reset();
  renderAll();
}

function bootFromUrl() {
  const params = new URLSearchParams(location.search);
  const name = params.get("name");
  const phone = params.get("phone");
  const code = params.get("ordine");

  if (name && phone && !state.customer) {
    saveCustomer({
      name: name.trim(),
      phone: phone.trim()
    });
  }

  if (code) {
    state.selectedOrder = code.toUpperCase();
    qs("#order-code").value = state.selectedOrder;
    setActiveView("customer");
  }
}

function bindEvents() {
  qsa(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setActiveView(tab.dataset.view));
  });

  qs("#order-search").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.customer) return;
    state.selectedOrder = qs("#order-code").value;
    refreshOrders();
  });

  qs("#customer-login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    saveCustomer({
      name: String(data.get("name")).trim(),
      phone: String(data.get("phone")).trim()
    });
    event.currentTarget.reset();
    renderAll();
  });

  qs("#customer-logout").addEventListener("click", () => {
    clearCustomer();
    renderAll();
  });

  qs("#rider-login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const pin = new FormData(event.currentTarget).get("pin");
    const error = qs("#rider-login-error");

    if (String(pin).trim() !== accessConfig().riderPin) {
      error.hidden = false;
      return;
    }

    error.hidden = true;
    event.currentTarget.reset();
    saveAccess({ rider: true });
    renderAll();
  });

  qs("#shop-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const error = qs("#shop-login-error");
    const submit = event.currentTarget.querySelector("button");

    error.hidden = true;
    submit.disabled = true;
    submit.textContent = "Entro...";
    try {
      await shopLogin(String(data.get("email")).trim(), String(data.get("password")));
      error.hidden = true;
      event.currentTarget.reset();
      renderAll();
      await refreshOrders({ reportErrors: false });
    } catch (loginError) {
      error.textContent = loginError.message || "Accesso non riuscito.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = "Entra";
    }
  });

  qs("#rider-logout").addEventListener("click", () => {
    saveAccess({ rider: false });
    renderAll();
  });

  qs("#shop-logout").addEventListener("click", () => {
    clearShopSession();
    renderAll();
  });

  qs("#rider-filter").addEventListener("change", (event) => {
    state.riderFilter = event.target.value;
    renderRider();
  });

  qs("#new-order-form").addEventListener("submit", (event) => {
    event.preventDefault();
    createOrder(event.currentTarget);
  });

  qs("#reset-demo").addEventListener("click", () => {
    saveOrders(seedOrders.map((order) => ({ ...order, updatedAt: Date.now() - 1000 * 60 * 4 })));
    state.selectedOrder = "";
    qs("#order-code").value = "";
    renderAll();
  });
}

bindEvents();
bootFromUrl();
refreshOrders();

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) refreshOrders();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

setInterval(() => {
  if (state.customer && state.selectedOrder && !state.loading) {
    refreshOrders({ silent: true, reportErrors: false });
  }
}, 8000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.customer && state.selectedOrder) {
    refreshOrders({ silent: true, reportErrors: false });
  }
});
