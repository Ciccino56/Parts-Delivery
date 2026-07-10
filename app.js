const STORAGE_KEY = "ricambi-delivery-orders-v1";
const CUSTOMER_KEY = "ricambi-delivery-customer-v1";
const CUSTOMER_DIRECTORY_KEY = "ricambi-delivery-customer-directory-v1";
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

const branches = [
  {
    key: "poggioreale",
    label: "Poggioreale",
    address: "Via Nuova Poggioreale 48a, 80143 Napoli",
    lat: 40.8615,
    lng: 14.2857
  },
  {
    key: "vomero",
    label: "Vomero",
    address: "Via Luigi Caldieri 146/148, Napoli",
    lat: 40.8483,
    lng: 14.2201
  }
];

const shopLocation = branches[0];

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
  customers: loadCustomerDirectory(),
  access: loadAccess(),
  shopSession: loadShopSession(),
  routeCache: loadRouteCache(),
  orders: loadOrders(),
  plan: null,
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

function loadCustomerDirectory() {
  const raw = localStorage.getItem(CUSTOMER_DIRECTORY_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(CUSTOMER_DIRECTORY_KEY);
    return [];
  }
}

function saveCustomerDirectory(customers) {
  const seen = new Set();
  const normalized = customers
    .filter((customer) => customer?.name)
    .map((customer) => ({
      id: customer.id || "",
      name: String(customer.name || "").trim(),
      phone: String(customer.phone || "").trim(),
      address: String(customer.address || "").trim(),
      notes: String(customer.notes || "").trim(),
      updatedAt: Number(customer.updatedAt || Date.now())
    }))
    .filter((customer) => {
      const key = customer.phone ? normalizePhone(customer.phone) : customer.name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
    .slice(0, 300);

  state.customers = normalized;
  localStorage.setItem(CUSTOMER_DIRECTORY_KEY, JSON.stringify(normalized));
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
    let message = "Accesso non riuscito. Controlla email e password.";

    try {
      const payload = await response.json();
      const rawMessage = [
        payload.error_description,
        payload.message,
        payload.msg,
        payload.error
      ]
        .filter(Boolean)
        .join(" ");
      const normalized = rawMessage.toLowerCase();

      if (
        normalized.includes("invalid") ||
        normalized.includes("credential") ||
        normalized.includes("login")
      ) {
        message = "Email o password non corrette.";
      } else if (rawMessage) {
        message = rawMessage;
      }
    } catch {
      if (response.status === 400) {
        message = "Email o password non corrette.";
      }
    }

    const error = new Error(message);
    error.status = response.status;
    throw error;
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
    notes: row.delivery_notes || "",
    priority: row.priority || "normal",
    paymentStatus: row.payment_status || "unknown",
    updatedAt: Date.parse(row.updated_at || row.created_at || new Date().toISOString()),
    lat: row.last_lat === null || row.last_lat === undefined ? null : Number(row.last_lat),
    lng: row.last_lng === null || row.last_lng === undefined ? null : Number(row.last_lng),
    locationAt: row.last_location_at ? Date.parse(row.last_location_at) : null
  };
}

function rememberOrder(order) {
  const nextOrders = [
    order,
    ...state.orders.filter((item) => item.code.toUpperCase() !== order.code.toUpperCase())
  ];
  saveOrders(nextOrders);
}

function mapSupabaseCustomer(row) {
  return {
    id: row.id || "",
    name: row.name || "",
    phone: row.phone || "",
    address: row.default_address || "",
    notes: row.notes || "",
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now()
  };
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("39")) return digits;
  if (digits.length >= 9) return `39${digits}`;
  return digits;
}

function customerFromOrder(order) {
  return {
    name: order.client,
    phone: order.phone || "",
    address: order.address || "",
    notes: "",
    updatedAt: order.updatedAt || Date.now()
  };
}

function syncCustomersFromOrders() {
  saveCustomerDirectory([
    ...state.orders.map(customerFromOrder),
    ...state.customers
  ]);
}

async function refreshCustomerDirectory() {
  if (!isSupabaseReady() || !state.shopSession?.access_token) {
    syncCustomersFromOrders();
    return;
  }

  try {
    const rows = await supabaseRpc("list_shop_customers", {}, {
      accessToken: state.shopSession.access_token
    });
    saveCustomerDirectory([
      ...rows.map(mapSupabaseCustomer),
      ...state.orders.map(customerFromOrder),
      ...state.customers
    ]);
  } catch {
    syncCustomersFromOrders();
  }
}

async function saveShopCustomerOnline(order) {
  if (!isSupabaseReady() || !state.shopSession?.access_token) return;

  try {
    await supabaseRpc("upsert_shop_customer", {
      p_customer_name: order.client,
      p_customer_phone: order.phone || "",
      p_default_address: order.address || "",
      p_notes: ""
    }, {
      accessToken: state.shopSession.access_token
    });
  } catch {
    // Older database versions may not have the customer directory yet.
  }
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
    syncCustomersFromOrders();
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
    await refreshCustomerDirectory();
  } catch (error) {
    state.online = false;
    if (!silent || !state.orders.length) {
      state.orders = loadOrders();
    }
    syncCustomersFromOrders();
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

function priorityLabel(value) {
  return value === "urgent" ? "Urgente" : "Normale";
}

function paymentLabel(value) {
  if (value === "paid") return "Pagato";
  if (value === "collect") return "Da incassare";
  return "Pagamento n/d";
}

function branchByKey(key) {
  return branches.find((branch) => branch.key === key) || branches[0];
}

function branchFromOrder(order) {
  const match = String(order.notes || "").match(/Filiale:\s*([^|]+)/i);
  if (!match) return branches[0];

  const value = match[1].trim().toLowerCase();
  return branches.find((branch) => (
    branch.key === value || branch.label.toLowerCase() === value
  )) || branches[0];
}

function plannedStep(order) {
  const match = String(order.notes || "").match(/Giro:\s*([^,|]+),\s*tappa\s*(\d+)/i);
  return {
    rider: match?.[1]?.trim() || "",
    step: match ? Number(match[2]) : 999
  };
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

function activePlannerOrders() {
  return state.orders
    .filter((order) => order.status !== "delivered" && order.code && order.client && order.address)
    .sort((a, b) => {
      const urgentScore = Number(b.priority === "urgent") - Number(a.priority === "urgent");
      return urgentScore || statusIndex(a.status) - statusIndex(b.status) || b.updatedAt - a.updatedAt;
    });
}

function selectedPlannerRiders() {
  return qsa("#planner-riders input:checked").map((input) => input.value);
}

function selectedOrderRiders() {
  return qsa("#new-rider-options input:checked").map((input) => input.value);
}

function plannerDepotStops() {
  return qs("#planner-depots").value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((address, index) => ({
      id: `deposit-${index + 1}`,
      type: "deposit",
      label: `Deposito ${index + 1}`,
      address,
      priority: "normal"
    }));
}

async function enrichPlannerStop(stop) {
  const location = await geocodeAddress(stop.address).catch(() => null);
  return { ...stop, location };
}

async function enrichPlannerStops(stops) {
  const enriched = [];
  for (const stop of stops) {
    enriched.push(await enrichPlannerStop(stop));
  }
  return enriched;
}

function routeDistance(from, to) {
  if (!from || !to) return 8000;
  return distanceInMeters(from, to) * 1.35;
}

function eligibleRidersForOrder(order, availableRiders) {
  const match = String(order.notes || "").match(/Rider possibili:\s*([^|]+)/i);
  const preferred = match
    ? match[1].split(",").map((name) => name.trim()).filter(Boolean)
    : [];
  const eligible = preferred.filter((rider) => availableRiders.includes(rider));

  if (eligible.length) return eligible;
  if (availableRiders.includes(order.rider)) return [order.rider];
  return availableRiders;
}

function routeCanTakeStop(route, stop, availableRiders) {
  if (stop.type !== "delivery") return true;
  return eligibleRidersForOrder(stop.order, availableRiders).includes(route.rider);
}

function startLocationForStop(stop) {
  return stop.type === "delivery" ? branchFromOrder(stop.order) : shopLocation;
}

function nearestPlannerOrder(stops, startLocation) {
  const urgentStops = stops.filter((stop) => stop.priority === "urgent");
  const pool = urgentStops.length ? urgentStops : stops;

  return pool.reduce((best, stop) => {
    const score = routeDistance(startLocation, stop.location);
    return !best || score < best.score ? { stop, score } : best;
  }, null)?.stop;
}

function orderPlannerStops(stops) {
  const remaining = [...stops];
  const ordered = [];
  let cursor = remaining[0] ? startLocationForStop(remaining[0]) : shopLocation;

  while (remaining.length) {
    const next = nearestPlannerOrder(remaining, cursor) || remaining[0];
    ordered.push(next);
    remaining.splice(remaining.indexOf(next), 1);
    cursor = next.location || cursor;
  }

  return ordered;
}

function buildPlannerRoutes(stops, availableRiders) {
  const routes = availableRiders.map((rider) => ({
    rider,
    stops: [],
    distance: 0,
    cursor: null
  }));

  const orderedStops = [
    ...orderPlannerStops(stops.filter((stop) => stop.priority === "urgent")),
    ...orderPlannerStops(stops.filter((stop) => stop.priority !== "urgent"))
  ];

  orderedStops.forEach((stop) => {
    const routePool = routes.filter((route) => routeCanTakeStop(route, stop, availableRiders));
    const bestRoute = (routePool.length ? routePool : routes).reduce((best, route) => {
      const start = route.cursor || startLocationForStop(stop);
      const leg = routeDistance(start, stop.location);
      const loadPenalty = route.stops.length * 1800;
      const score = route.distance + leg + loadPenalty;
      return !best || score < best.score ? { route, leg, score } : best;
    }, null);

    bestRoute.route.stops.push(stop);
    bestRoute.route.distance += bestRoute.leg;
    bestRoute.route.cursor = stop.location || bestRoute.route.cursor;
  });

  return routes.map((route) => ({
    ...route,
    stops: orderPlannerStops(route.stops),
    etaSeconds: route.distance / 7.8
  }));
}

function hasDraftOrder() {
  const form = qs("#new-order-form");
  const data = new FormData(form);
  return Boolean(
    String(data.get("code") || "").trim()
      || String(data.get("client") || "").trim()
      || String(data.get("address") || "").trim()
  );
}

async function planShopRoutes() {
  const button = qs("#plan-routes");
  const status = qs("#planner-status");
  const availableRiders = selectedPlannerRiders();

  if (!availableRiders.length) {
    alert("Seleziona almeno un rider disponibile.");
    return;
  }

  if (isSupabaseReady() && !state.shopSession?.access_token) {
    alert("Entra come negozio, poi riprova a pianificare.");
    return;
  }

  button.disabled = true;
  button.textContent = "Carico...";
  status.textContent = "Aggiorno gli ordini prima di pianificare...";

  try {
    await refreshOrders({ silent: true, reportErrors: false });
    const orders = activePlannerOrders();

    if (!orders.length) {
      if (hasDraftOrder()) {
        const shouldCreate = window.confirm("Hai una consegna compilata ma non ancora salvata. Vuoi crearla e poi pianificare?");
        if (shouldCreate) {
          const created = await createOrder(qs("#new-order-form"), { silentSuccess: true });
          if (created) {
            await refreshOrders({ silent: true, reportErrors: false });
            return planShopRoutes();
          }
        }
      }

      alert("Non ci sono ordini aperti da pianificare. Controlla che non siano gia consegnati o annullati.");
      status.textContent = "Nessun ordine aperto da pianificare.";
      return;
    }

    button.textContent = "Calcolo...";
    status.textContent = "Sto leggendo indirizzi e zone...";

    const deliveryStops = orders.map((order) => ({
      id: order.code,
      type: "delivery",
      order,
      label: order.client,
      address: order.address,
      priority: order.priority || "normal"
    }));
    const stops = await enrichPlannerStops([...deliveryStops, ...plannerDepotStops()]);
    const routes = buildPlannerRoutes(stops, availableRiders);

    state.plan = {
      createdAt: Date.now(),
      routes
    };

    status.textContent = "Piano pronto. Controllalo e applicalo se ti va bene.";
    renderPlannerResult();
  } catch {
    alert("Non sono riuscito a calcolare il giro. Controlla gli indirizzi e riprova.");
    status.textContent = "Pianificazione non riuscita.";
  } finally {
    button.disabled = false;
    button.textContent = "Pianifica";
  }
}

function plannerStopTitle(stop) {
  if (stop.type === "deposit") return stop.label;
  return `${stop.order.code} - ${stop.order.client}`;
}

function renderPlannerResult() {
  const container = qs("#planner-result");
  const applyButton = qs("#apply-plan");
  const status = qs("#planner-status");
  if (!container || !applyButton) return;

  container.innerHTML = "";
  applyButton.hidden = !state.plan;

  if (!state.plan) {
    if (status && !state.loading) {
      const count = activePlannerOrders().length;
      status.textContent = count
        ? `${count} ordini aperti pronti da pianificare.`
        : "Nessun ordine aperto da pianificare.";
    }
    return;
  }

  state.plan.routes.forEach((route) => {
    const card = document.createElement("article");
    card.className = "route-plan";

    const deliveryCount = route.stops.filter((stop) => stop.type === "delivery").length;
    const summary = `${deliveryCount} consegne - ${formatDistance(route.distance)} - ${formatEta(route.etaSeconds)}`;
    card.innerHTML = `
      <div class="route-plan-top">
        <h4>${route.rider}</h4>
        <span class="pill">${summary}</span>
      </div>
    `;

    const list = document.createElement("ol");
    if (!route.stops.length) {
      const item = document.createElement("li");
      item.textContent = "Nessuna tappa assegnata";
      list.append(item);
    }

    route.stops.forEach((stop) => {
      const item = document.createElement("li");
      const tag = stop.priority === "urgent" ? "Urgente" : stop.type === "deposit" ? "Deposito" : "Consegna";
      const branchText = stop.type === "delivery" ? `${branchFromOrder(stop.order).label} - ` : "";
      const title = document.createTextNode(plannerStopTitle(stop));
      const detail = document.createElement("small");
      detail.textContent = `${tag} - ${branchText}${stop.address}`;
      item.append(title, detail);
      list.append(item);
    });

    card.append(list);
    container.append(card);
  });
}

function appendPlanNote(existing, rider, index) {
  const clean = String(existing || "")
    .replace(/\s*Giro:\s*[^|]+(\|\s*)?/i, "")
    .replace(/\s*Rider possibili:\s*[^|]+(\|\s*)?/i, "")
    .trim();
  const note = `Giro: ${rider}, tappa ${index}`;
  return clean ? `${note} | ${clean}` : note;
}

async function applyShopPlan() {
  if (!state.plan) return;

  const confirmed = window.confirm("Applicare rider e numero tappa agli ordini del piano?");
  if (!confirmed) return;

  const button = qs("#apply-plan");
  button.disabled = true;
  button.textContent = "Applico...";

  try {
    for (const route of state.plan.routes) {
      const deliveries = route.stops.filter((stop) => stop.type === "delivery");
      for (let index = 0; index < deliveries.length; index += 1) {
        const order = deliveries[index].order;
        await updateShopOrder(order, {
          rider: route.rider,
          notes: appendPlanNote(order.notes, route.rider, index + 1)
        });
      }
    }

    state.plan = null;
    renderPlannerResult();
    alert("Piano applicato agli ordini.");
  } finally {
    button.disabled = false;
    button.textContent = "Applica piano";
  }
}

function setActiveView(view) {
  state.activeView = view;
  qsa(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === view));
  qsa(".view").forEach((panel) => panel.classList.toggle("is-active", panel.id === `${view}-view`));
}

function renderRiderOptions() {
  const filter = qs("#rider-filter");
  const orderOptions = qs("#new-rider-options");

  filter.innerHTML = '<option value="all">Tutti</option>';
  if (orderOptions && !orderOptions.children.length) {
    orderOptions.innerHTML = "";
  }

  riders.forEach((rider) => {
    filter.append(new Option(rider, rider));
    if (orderOptions && !orderOptions.querySelector(`input[value="${rider}"]`)) {
      const label = document.createElement("label");
      label.className = "check-pill";
      label.innerHTML = `<input type="checkbox" value="${rider}" checked> <span>${rider}</span>`;
      orderOptions.append(label);
    }
  });

  filter.value = state.riderFilter;
}

function renderBranchOptions() {
  const select = qs("#new-branch");
  if (!select || select.children.length) return;

  branches.forEach((branch) => {
    select.append(new Option(`${branch.label} - ${branch.address}`, branch.key));
  });
}

function renderCustomerDirectoryOptions() {
  const datalist = qs("#shop-customer-options");
  if (!datalist) return;

  datalist.innerHTML = "";
  state.customers.forEach((customer) => {
    const option = document.createElement("option");
    option.value = customer.name;
    option.label = [customer.phone, customer.address].filter(Boolean).join(" - ");
    datalist.append(option);
  });
}

function renderPlannerRiders() {
  const container = qs("#planner-riders");
  if (!container) return;
  if (container.children.length) return;

  container.innerHTML = "";
  riders.forEach((rider) => {
    const label = document.createElement("label");
    label.className = "check-pill";
    label.innerHTML = `<input type="checkbox" value="${rider}" checked> <span>${rider}</span>`;
    container.append(label);
  });
}

function renderAll() {
  renderRiderOptions();
  renderBranchOptions();
  renderCustomerDirectoryOptions();
  renderPlannerRiders();
  renderCustomerLogin();
  renderStaffAccess();
  renderCustomer();
  renderRider();
  renderShop();
  renderPlannerResult();
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

  const orders = state.orders
    .filter((order) => (
      order.status !== "delivered"
        && (state.riderFilter === "all" || order.rider === state.riderFilter)
    ))
    .sort((a, b) => {
      const planA = plannedStep(a);
      const planB = plannedStep(b);
      return a.rider.localeCompare(b.rider)
        || planA.step - planB.step
        || Number(b.priority === "urgent") - Number(a.priority === "urgent")
        || b.updatedAt - a.updatedAt;
    });

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
      order.notes,
      priorityLabel(order.priority),
      paymentLabel(order.paymentStatus),
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
  if (order.priority === "urgent") metaRow.append(createPill("Priorita: urgente", "urgent"));
  if (order.paymentStatus && order.paymentStatus !== "unknown") {
    metaRow.append(createPill(paymentLabel(order.paymentStatus)));
  }
  metaRow.append(createPill(`Filiale: ${branchFromOrder(order).label}`));
  metaRow.append(createPill(hasLiveLocation(order) ? `GPS: ${timeAgo(order.locationAt)}` : "GPS: in attesa"));
  if (order.notes) metaRow.append(createPill(`Note: ${order.notes}`));
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

function createPill(text, variant = "") {
  const pill = document.createElement("span");
  pill.className = `pill ${variant}`.trim();
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
  const branch = branchFromOrder(order);
  const riderLocation = hasLocation ? [order.lat, order.lng] : [branch.lat, branch.lng];

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

    L.circleMarker([branch.lat, branch.lng], {
      radius: 8,
      color: "#111827",
      fillColor: "#111827",
      fillOpacity: 1,
      weight: 2
    }).addTo(map).bindTooltip(branch.label);

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

function fillKnownCustomer() {
  const nameInput = qs("#new-client");
  const phoneInput = qs("#new-phone");
  const addressInput = qs("#new-address");
  const selectedName = nameInput.value.trim().toLowerCase();
  const match = state.customers.find((customer) => customer.name.toLowerCase() === selectedName);

  if (!match) return;
  if (!phoneInput.value.trim() && match.phone) phoneInput.value = match.phone;
  if (!addressInput.value.trim() && match.address) addressInput.value = match.address;
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
      const updated = await supabaseRpc("update_shop_order_v2", {
        p_code: order.code,
        p_customer_name: patch.client || null,
        p_customer_phone: patch.phone || null,
        p_delivery_address: patch.address || null,
        p_rider_name: patch.rider || null,
        p_delivery_notes: patch.notes ?? null,
        p_priority: patch.priority || null,
        p_payment_status: patch.paymentStatus || null
      }, {
        accessToken: state.shopSession.access_token
      });

      if (!updated?.length) throw new Error("Ordine non aggiornato");

      await saveShopCustomerOnline({ ...order, ...patch });
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
  saveCustomerDirectory([customerFromOrder({ ...order, ...patch }), ...state.customers]);
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

  const priority = window.prompt("Priorita: normal oppure urgent", order.priority || "normal");
  if (priority === null) return;

  const paymentStatus = window.prompt("Pagamento: unknown, paid oppure collect", order.paymentStatus || "unknown");
  if (paymentStatus === null) return;

  const notes = window.prompt("Note consegna", order.notes || "");
  if (notes === null) return;

  await updateShopOrder(order, {
    client: client.trim(),
    phone: phone.trim(),
    address: address.trim(),
    rider: rider.trim(),
    priority: priority.trim(),
    paymentStatus: paymentStatus.trim(),
    notes: notes.trim()
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

async function createOrder(form, options = {}) {
  const data = new FormData(form);
  const orders = state.orders;
  const code = String(data.get("code")).trim().toUpperCase();
  const client = String(data.get("client")).trim();
  const address = String(data.get("address")).trim();
  const possibleRiders = selectedOrderRiders();
  const branch = branchByKey(String(data.get("branch") || branches[0].key));

  if (!code || !client || !address) {
    alert("Per creare la consegna servono almeno ordine, cliente e indirizzo.");
    return false;
  }

  if (!possibleRiders.length) {
    alert("Seleziona almeno un rider possibile per questa consegna.");
    return false;
  }

  if (orders.some((order) => order.code.toUpperCase() === code)) {
    alert("Questo numero ordine esiste gia.");
    return false;
  }

  const order = {
    code,
    client,
    phone: String(data.get("phone")).trim(),
    address,
    rider: possibleRiders.length === 1 ? possibleRiders[0] : "Da assegnare",
    notes: [
      `Filiale: ${branch.label}`,
      `Rider possibili: ${possibleRiders.join(", ")}`,
      String(data.get("notes") || "").trim()
    ].filter(Boolean).join(" | "),
    priority: String(data.get("priority") || "normal"),
    paymentStatus: String(data.get("payment") || "unknown"),
    status: "created",
    updatedAt: Date.now()
  };

  if (isSupabaseReady()) {
    try {
      if (!state.shopSession?.access_token) {
        clearShopSession();
        renderAll();
        alert("Accesso negozio scaduto. Entra di nuovo e riprova.");
        return false;
      }

      const created = await supabaseRpc("create_shop_order_v2", {
        p_code: order.code,
        p_customer_name: order.client,
        p_customer_phone: order.phone || "",
        p_delivery_address: order.address,
        p_rider_name: order.rider,
        p_delivery_notes: order.notes || "",
        p_priority: order.priority,
        p_payment_status: order.paymentStatus
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
      rememberOrder(mapSupabaseOrder(created[0]));
      saveCustomerDirectory([customerFromOrder(order), ...state.customers]);
      await saveShopCustomerOnline(order);
      await refreshOrders({ silent: true, reportErrors: false });
      if (!options.silentSuccess) alert(`Ordine ${order.code} creato.`);
      return true;
    } catch (error) {
      if (error.status === 409 || String(error.message).toLowerCase().includes("duplicate")) {
        alert(`Ordine ${order.code} gia esistente. Usa un numero ordine nuovo oppure modifica quello esistente.`);
      } else {
        alert(`Ordine non creato: ${error.message || "riprova tra poco."}`);
      }
      return false;
    }
  }

  orders.unshift(order);

  saveOrders(orders);
  saveCustomerDirectory([customerFromOrder(order), ...state.customers]);
  state.shopSearch = "";
  state.shopFilter = "active";
  form.reset();
  renderAll();
  if (!options.silentSuccess) alert(`Ordine ${order.code} creato.`);
  return true;
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

  qs("#new-client").addEventListener("change", fillKnownCustomer);
  qs("#new-client").addEventListener("input", fillKnownCustomer);

  qs("#plan-routes").addEventListener("click", planShopRoutes);
  qs("#apply-plan").addEventListener("click", applyShopPlan);

  qs("#new-order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await createOrder(event.currentTarget);
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
