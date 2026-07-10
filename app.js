const STORAGE_KEY = "ricambi-delivery-orders-v1";
const CUSTOMER_KEY = "ricambi-delivery-customer-v1";
const ACCESS_KEY = "ricambi-delivery-access-v1";
const SHOP_SESSION_KEY = "ricambi-delivery-shop-session-v1";
const ROUTE_CACHE_KEY = "ricambi-delivery-route-cache-v1";

const riders = ["Marco", "Luca", "Antonio", "Salvatore"];
const statuses = [
  { key: "created", label: "Da ritirare", progress: 5 },
  { key: "picked", label: "Ritirato", progress: 28 },
  { key: "moving", label: "In consegna", progress: 58 },
  { key: "near", label: "Sta arrivando", progress: 84 },
  { key: "delivered", label: "Consegnato", progress: 100 }
];

const shopLocation = {
  label: "Negozio",
  lat: 41.0723,
  lng: 14.3320
};

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
  shopFilter: "active",
  shopSearch: "",
  customer: loadCustomer(),
  access: loadAccess(),
  shopSession: loadShopSession(),
  routeCache: loadRouteCache(),
  orders: loadOrders(),
  loading: false,
  online: isSupabaseReady(),
  locationSharing: null
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

function loadRouteCache() {
  const raw = localStorage.getItem(ROUTE_CACHE_KEY);
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(ROUTE_CACHE_KEY);
    return {};
  }
}

function saveRouteCache() {
  localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(state.routeCache));
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
    let details = "";
    try {
      const payload = await response.json();
      details = payload.message || payload.details || payload.hint || "";
    } catch {
      details = await response.text().catch(() => "");
    }

    const error = new Error(details || `Supabase error ${response.status}`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

async function supabaseRpc(functionName, body, options = {}) {
  return supabaseRequest(`rpc/${functionName}`, {
    method: "POST",
    body,
    accessToken: options.accessToken,
    prefer: "return=representation"
  });
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
    updatedAt: Date.parse(row.updated_at || row.created_at || new Date().toISOString()),
    lat: row.last_lat === null || row.last_lat === undefined ? null : Number(row.last_lat),
    lng: row.last_lng === null || row.last_lng === undefined ? null : Number(row.last_lng),
    locationAt: row.last_location_at ? Date.parse(row.last_location_at) : null
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
  if (typeof patch.lat === "number") mapped.last_lat = patch.lat;
  if (typeof patch.lng === "number") mapped.last_lng = patch.lng;
  if (patch.locationAt) mapped.last_location_at = patch.locationAt;
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
    let rows = [];

    if (state.activeView === "customer" && state.customer && state.selectedOrder) {
      rows = await supabaseRpc("get_customer_order", {
        p_code: state.selectedOrder.trim().toUpperCase(),
        p_phone: state.customer.phone
      });
    } else if (state.activeView === "rider" && state.access.riderPin) {
      rows = await supabaseRpc("get_rider_orders", {
        p_pin: state.access.riderPin
      });
    } else if (state.shopSession) {
      rows = await supabaseRequest("orders?select=*&order=created_at.desc");
    } else {
      rows = [];
    }

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
  state.selectedOrder = "";
  qs("#order-code").value = "";
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
    const session = JSON.parse(raw);
    if (!session.access_token || session.expires_at <= Date.now()) {
      localStorage.removeItem(SHOP_SESSION_KEY);
      return null;
    }
    return session;
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
  if (!timestamp) return "mai";
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.round(minutes / 60);
  return `${hours} ore fa`;
}

function hasLiveLocation(order) {
  return Number.isFinite(order.lat) && Number.isFinite(order.lng);
}

function isSharingLocationFor(code) {
  return state.locationSharing?.code === code;
}

function routeCacheKey(prefix, parts) {
  return `${prefix}:${parts.map((part) => String(part).trim().toLowerCase()).join("|")}`;
}

function roundedCoord(value) {
  return Number(value).toFixed(4);
}

function formatEta(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

function distanceInMeters(from, to) {
  const earthRadius = 6371000;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fallbackEtaText(from, to) {
  const directDistance = distanceInMeters(from, to);
  const roadDistance = directDistance * 1.35;
  const urbanMetersPerSecond = 7.8;
  return `ETA indicativo ${formatEta(roadDistance / urbanMetersPerSecond)} - ${formatDistance(roadDistance)}`;
}

async function fetchJson(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("Richiesta non disponibile");
    return response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function geocodeAddress(address) {
  const query = `${address}, Campania, Italia`;
  const key = routeCacheKey("geo", [query]);

  if (state.routeCache[key]) return state.routeCache[key];

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const results = await fetchJson(url);
  if (!results.length) return null;

  const location = {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon)
  };

  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;

  state.routeCache[key] = location;
  saveRouteCache();
  return location;
}

async function fetchDrivingRoute(from, to) {
  const key = routeCacheKey("route", [
    roundedCoord(from.lat),
    roundedCoord(from.lng),
    roundedCoord(to.lat),
    roundedCoord(to.lng)
  ]);

  if (state.routeCache[key]) return state.routeCache[key];

  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const data = await fetchJson(url);
  const firstRoute = data.routes?.[0];
  if (!firstRoute) return null;

  const route = {
    duration: firstRoute.duration,
    distance: firstRoute.distance,
    points: firstRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng])
  };

  state.routeCache[key] = route;
  saveRouteCache();
  return route;
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

  const hasShopSession = Boolean(state.shopSession?.access_token && state.shopSession.expires_at > Date.now());

  riderLogin.hidden = state.access.rider;
  riderProtected.hidden = !state.access.rider;
  shopLogin.hidden = hasShopSession;
  shopProtected.hidden = !hasShopSession;
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

  const query = state.shopSearch.trim().toLowerCase();
  const orders = state.orders.filter((order) => {
    const matchesFilter = state.shopFilter === "all"
      || (state.shopFilter === "active" && order.status !== "delivered")
      || order.status === state.shopFilter;
    const haystack = [
      order.code,
      order.client,
      order.phone,
      order.address,
      order.rider,
      statusMeta(order.status).label
    ].join(" ").toLowerCase();

    return matchesFilter && (!query || haystack.includes(query));
  });

  list.innerHTML = "";

  if (!orders.length) {
    list.innerHTML = '<div class="empty-state">Nessun ordine trovato.</div>';
    return;
  }

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
  renderLiveMap(qs(".map", card), order);

  const metaRow = qs(".meta-row", card);
  metaRow.append(createPill(`Rider: ${order.rider}`));
  metaRow.append(createPill(`Aggiornato: ${timeAgo(order.updatedAt)}`));
  metaRow.append(createPill(hasLiveLocation(order) ? `GPS: ${timeAgo(order.locationAt)}` : "GPS: in attesa"));
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
  const isDelivered = order.status === "delivered";

  if (!isDelivered) {
    if (isSharingLocationFor(order.code)) {
      container.append(createButton("Stop GPS", "secondary", stopLocationSharing));
    } else {
      container.append(createButton("Condividi GPS", "", () => startLocationSharing(order)));
    }
  }

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
  container.append(createButton("Modifica", "secondary", () => editShopOrder(order)));
  if (order.status !== "delivered") {
    container.append(createButton("Consegnato", "", () => updateOrder(order.code, { status: "delivered" })));
  }
  container.append(createButton("Annulla", "danger", () => cancelShopOrder(order)));
}

function positionRider(pin, progress) {
  const x = 8 + progress * 0.72;
  const y = 17 + progress * 0.42;
  pin.style.left = `${x}%`;
  pin.style.bottom = `${y}%`;
}

function renderLiveMap(container, order) {
  if (!window.L) return;

  const hasLocation = hasLiveLocation(order);
  const riderLocation = hasLocation ? [order.lat, order.lng] : [shopLocation.lat, shopLocation.lng];

  container.classList.add("live-map");
  container.innerHTML = "";

  window.setTimeout(() => {
    if (!container.isConnected || container.offsetParent === null) return;

    const map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      tap: false
    }).setView(riderLocation, hasLocation ? 15 : 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19
    }).addTo(map);

    L.circleMarker([shopLocation.lat, shopLocation.lng], {
      radius: 8,
      color: "#111827",
      fillColor: "#111827",
      fillOpacity: 1,
      weight: 2
    }).addTo(map).bindTooltip("Negozio");

    if (hasLocation) {
      L.circleMarker(riderLocation, {
        radius: 10,
        color: "#ffffff",
        fillColor: "#e11d48",
        fillOpacity: 1,
        weight: 3
      }).addTo(map).bindTooltip(`Rider ${order.rider}`);
      renderRouteEta(map, container, order, {
        lat: order.lat,
        lng: order.lng
      });
    } else {
      const empty = document.createElement("div");
      empty.className = "map-empty";
      empty.textContent = "GPS rider in attesa";
      container.append(empty);
    }
  }, 0);
}

async function renderRouteEta(map, container, order, riderLocation) {
  const summary = document.createElement("div");
  summary.className = "route-summary";
  summary.textContent = "Calcolo percorso...";
  container.append(summary);

  try {
    const destination = await geocodeAddress(order.address);
    if (!destination || !container.isConnected) {
      summary.textContent = "ETA non disponibile";
      return;
    }

    L.circleMarker([destination.lat, destination.lng], {
      radius: 9,
      color: "#ffffff",
      fillColor: "#16a34a",
      fillOpacity: 1,
      weight: 3
    }).addTo(map).bindTooltip("Cliente");

    const route = await fetchDrivingRoute(riderLocation, destination);
    if (!route || !container.isConnected) {
      summary.textContent = fallbackEtaText(riderLocation, destination);
      return;
    }

    const line = L.polyline(route.points, {
      color: "#e11d48",
      weight: 5,
      opacity: 0.82
    }).addTo(map);

    map.fitBounds(line.getBounds(), {
      padding: [22, 22],
      maxZoom: 15
    });

    summary.textContent = `ETA ${formatEta(route.duration)} - ${formatDistance(route.distance)}`;
  } catch {
    try {
      const destination = await geocodeAddress(order.address);
      summary.textContent = destination
        ? fallbackEtaText(riderLocation, destination)
        : "ETA non disponibile: controlla indirizzo";
    } catch {
      summary.textContent = "ETA non disponibile: controlla indirizzo";
    }
  }
}

async function updateOrderLocation(code, coords) {
  const patch = {
    lat: Number(coords.latitude.toFixed(6)),
    lng: Number(coords.longitude.toFixed(6)),
    locationAt: new Date().toISOString()
  };

  const order = state.orders.find((item) => item.code === code);
  if (order && order.status !== "delivered" && statusIndex(order.status) < statusIndex("moving")) {
    patch.status = "moving";
  }

  if (isSupabaseReady()) {
    if (state.access.riderPin) {
      await supabaseRpc("update_rider_order", {
        p_pin: state.access.riderPin,
        p_code: code,
        p_status: patch.status || null,
        p_lat: patch.lat,
        p_lng: patch.lng,
        p_location_at: patch.locationAt
      });
    } else {
      await supabaseRequest(`orders?code=eq.${encodeURIComponent(code)}`, {
        method: "PATCH",
        body: mapOrderPatchForSupabase(patch)
      });
    }
    await refreshOrders({ silent: true, reportErrors: false });
    return;
  }

  const orders = state.orders.map((item) => (
    item.code === code
      ? { ...item, ...patch, updatedAt: Date.now() }
      : item
  ));
  saveOrders(orders);
  renderAll();
}

function startLocationSharing(order) {
  if (!navigator.geolocation) {
    alert("Questo telefono non permette la posizione GPS nel browser.");
    return;
  }

  stopLocationSharing({ render: false });

  let firstFix = true;
  const watchId = navigator.geolocation.watchPosition(
    async (position) => {
      try {
        await updateOrderLocation(order.code, position.coords);
        if (firstFix) {
          firstFix = false;
          alert("GPS attivo. Il cliente ora vede il rider sulla mappa.");
        }
      } catch {
        if (firstFix) {
          firstFix = false;
          alert("Non riesco a salvare la posizione online. Riprova tra poco.");
        }
      }
    },
    () => {
      alert("Posizione non autorizzata. Sul telefono del rider devi premere Consenti.");
      stopLocationSharing();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    }
  );

  state.locationSharing = { code: order.code, watchId };
  renderAll();
}

function stopLocationSharing(options = {}) {
  if (state.locationSharing?.watchId !== undefined) {
    navigator.geolocation.clearWatch(state.locationSharing.watchId);
  }

  state.locationSharing = null;
  if (options.render !== false) renderAll();
}

async function updateOrder(code, patch) {
  if (patch.status === "delivered" && isSharingLocationFor(code)) {
    stopLocationSharing({ render: false });
  }

  if (isSupabaseReady()) {
    try {
      if (state.activeView === "rider" && state.access.riderPin) {
        await supabaseRpc("update_rider_order", {
          p_pin: state.access.riderPin,
          p_code: code,
          p_status: patch.status || null,
          p_lat: patch.lat || null,
          p_lng: patch.lng || null,
          p_location_at: patch.locationAt || null
        });
      } else {
        await supabaseRequest(`orders?code=eq.${encodeURIComponent(code)}`, {
          method: "PATCH",
          body: mapOrderPatchForSupabase(patch)
        });
      }
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
  const order = state.orders.find((item) => item.code.toUpperCase() === String(code).toUpperCase());
  const params = new URLSearchParams({ ordine: code });

  if (order?.phone) params.set("phone", order.phone);
  if (order?.client) params.set("name", order.client);

  return `${normalizedBase}?${params.toString()}`;
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

async function updateShopOrder(order, patch) {
  if (isSupabaseReady()) {
    if (!state.shopSession?.access_token) {
      clearShopSession();
      renderAll();
      alert("Accesso negozio scaduto. Entra di nuovo e riprova.");
      return;
    }

    try {
      const updated = await supabaseRpc("update_shop_order", {
        p_code: order.code,
        p_customer_name: patch.client || null,
        p_customer_phone: patch.phone || null,
        p_delivery_address: patch.address || null,
        p_rider_name: patch.rider || null
      }, {
        accessToken: state.shopSession.access_token
      });

      if (!updated?.length) throw new Error("Ordine non aggiornato");

      await refreshOrders();
      return;
    } catch {
      alert("Modifica non salvata. Esci dal negozio, rientra e riprova.");
      return;
    }
  }

  const orders = state.orders.map((item) => (
    item.code === order.code ? { ...item, ...patch, updatedAt: Date.now() } : item
  ));
  saveOrders(orders);
  renderAll();
}

async function editShopOrder(order) {
  const client = window.prompt("Cliente", order.client);
  if (client === null) return;

  const phone = window.prompt("Telefono cliente", order.phone || "");
  if (phone === null) return;

  const address = window.prompt("Indirizzo", order.address);
  if (address === null) return;

  const rider = window.prompt(`Rider (${riders.join(", ")})`, order.rider);
  if (rider === null) return;

  await updateShopOrder(order, {
    client: client.trim(),
    phone: phone.trim(),
    address: address.trim(),
    rider: rider.trim()
  });
}

async function cancelShopOrder(order) {
  const confirmed = window.confirm(`Annullare l'ordine ${order.code}?`);
  if (!confirmed) return;

  if (isSupabaseReady()) {
    if (!state.shopSession?.access_token) {
      clearShopSession();
      renderAll();
      alert("Accesso negozio scaduto. Entra di nuovo e riprova.");
      return;
    }

    try {
      const deleted = await supabaseRpc("delete_shop_order", {
        p_code: order.code
      }, {
        accessToken: state.shopSession.access_token
      });

      if (!deleted) throw new Error("Ordine non annullato");

      await refreshOrders();
      return;
    } catch {
      alert("Ordine non annullato. Esci dal negozio, rientra e riprova.");
      return;
    }
  }

  saveOrders(state.orders.filter((item) => item.code !== order.code));
  renderAll();
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
      if (!state.shopSession?.access_token) {
        clearShopSession();
        renderAll();
        alert("Accesso negozio scaduto. Entra di nuovo e riprova.");
        return;
      }

      const created = await supabaseRpc("create_shop_order", {
        p_code: order.code,
        p_customer_name: order.client,
        p_customer_phone: order.phone || "",
        p_delivery_address: order.address,
        p_rider_name: order.rider
      }, {
        accessToken: state.shopSession.access_token
      });

      if (!created?.length) {
        throw new Error("Ordine non autorizzato");
      }

      state.shopSearch = "";
      state.shopFilter = "active";
      qs("#shop-search").value = "";
      qs("#shop-status-filter").value = "active";
      form.reset();
      await refreshOrders();
      alert(`Ordine ${order.code} creato.`);
      return;
    } catch (error) {
      if (error.status === 409 || String(error.message).toLowerCase().includes("duplicate")) {
        alert(`Ordine ${order.code} gia esistente. Usa un numero ordine nuovo oppure modifica quello esistente.`);
      } else {
        alert(`Ordine non creato: ${error.message || "riprova tra poco."}`);
      }
      return;
    }
  }

  orders.unshift(order);

  saveOrders(orders);
  state.shopSearch = "";
  state.shopFilter = "active";
  form.reset();
  renderAll();
  alert(`Ordine ${order.code} creato.`);
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
    tab.addEventListener("click", () => {
      setActiveView(tab.dataset.view);
      renderAll();
    });
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

  qs("#rider-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const pin = String(new FormData(form).get("pin")).trim();
    const error = qs("#rider-login-error");
    const submit = form.querySelector("button");

    error.hidden = true;
    submit.disabled = true;
    submit.textContent = "Entro...";

    try {
      let riderName = "";

      if (isSupabaseReady()) {
        const rows = await supabaseRpc("get_rider_profile", { p_pin: pin });
        riderName = rows?.[0]?.rider_name || "";
      } else if (pin === accessConfig().riderPin) {
        riderName = "Rider";
      }

      if (!riderName) {
        error.textContent = "PIN non corretto.";
        error.hidden = false;
        return;
      }

      form.reset();
      state.riderFilter = "all";
      saveAccess({ rider: true, riderPin: pin, riderName });
      renderAll();
      await refreshOrders({ reportErrors: false });
    } catch {
      error.textContent = "Accesso rider non disponibile. Riprova tra poco.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = "Entra";
    }
  });

  qs("#shop-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const error = qs("#shop-login-error");
    const submit = form.querySelector("button");

    error.hidden = true;
    submit.disabled = true;
    submit.textContent = "Entro...";
    try {
      await shopLogin(String(data.get("email")).trim(), String(data.get("password")));
      error.hidden = true;
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
    stopLocationSharing({ render: false });
    saveAccess({ rider: false, riderPin: "", riderName: "" });
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

  qs("#shop-search").addEventListener("input", (event) => {
    state.shopSearch = event.target.value;
    renderShop();
  });

  qs("#shop-status-filter").addEventListener("change", (event) => {
    state.shopFilter = event.target.value;
    renderShop();
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
  navigator.serviceWorker.register("./sw.js")
    .then((registration) => registration.update())
    .catch(() => {});
}

setInterval(() => {
  if (state.customer && state.selectedOrder && !state.loading) {
    refreshOrders({ silent: true, reportErrors: false });
  }
}, 5000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.customer && state.selectedOrder) {
    refreshOrders({ silent: true, reportErrors: false });
  }
});
