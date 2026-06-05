// Локальная реализация Api: каталог из бандла, корзина в localStorage.
// Когда поднимем сервер — пишем `httpApi` с теми же сигнатурами и меняем
// `api` в `./index.ts` на новый импорт. Consumer'ы не правим.

import type { CatalogEntry } from '../model';
import { CATALOG } from '../models-loader';
import type { Customer, Order, OrderHeader, OrderItem, SavedAddress } from '../order';
import { emptyOrder } from '../order';
import type { Api, CatalogApi, CartApi, MaterialDto, OrdersApi, ProfileApi } from './index';
import materialsRaw from '../../config/materials.json';

const CART_KEY    = 'facade-order-v1';
const PROFILE_KEY = 'facade-profile-v1';
const ORDERS_KEY  = 'facade-orders-v1';

const cartListeners    = new Set<() => void>();
const profileListeners = new Set<() => void>();
const ordersListeners  = new Set<() => void>();

let order: Order = loadOrder();
let profile: Customer | null = loadProfile();
let orderHistory: Order[] = loadOrders();

function newClientId(prefix: string) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadOrder(): Order {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return emptyOrder();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return emptyOrder();
    return parsed as Order;
  } catch {
    return emptyOrder();
  }
}

function persistCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(order));
  cartListeners.forEach(fn => fn());
}

function loadProfile(): Customer | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.name !== 'string' || typeof parsed.phone !== 'string') return null;
    if (!Array.isArray(parsed.addresses)) parsed.addresses = [];
    return parsed as Customer;
  } catch { return null; }
}

function persistProfile() {
  if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  else         localStorage.removeItem(PROFILE_KEY);
  profileListeners.forEach(fn => fn());
}

function loadOrders(): Order[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Order[];
  } catch { return []; }
}

function persistOrders() {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orderHistory));
  ordersListeners.forEach(fn => fn());
}

const catalog: CatalogApi = {
  async fetchModels(): Promise<CatalogEntry[]> {
    return CATALOG;
  },
  async fetchMaterials(): Promise<Record<string, MaterialDto>> {
    return materialsRaw as Record<string, MaterialDto>;
  },
};

const cart: CartApi = {
  get: () => order,
  add(item: OrderItem) {
    order.items.push(item);
    persistCart();
  },
  update(id: string, updater: (it: OrderItem) => OrderItem) {
    const idx = order.items.findIndex(i => i.id === id);
    if (idx < 0) return;
    order.items[idx] = updater(order.items[idx]);
    persistCart();
  },
  setQty(id: string, qty: number) {
    const it = order.items.find(i => i.id === id);
    if (!it) return;
    it.qty = Math.max(1, Math.round(qty));
    persistCart();
  },
  remove(id: string) {
    order.items = order.items.filter(i => i.id !== id);
    persistCart();
  },
  clear() {
    order = emptyOrder();
    persistCart();
  },
  subscribe(fn: () => void): () => void {
    cartListeners.add(fn);
    return () => { cartListeners.delete(fn); };
  },
  newId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },
};

const orders: OrdersApi = {
  async submit(header: OrderHeader, draft: Order): Promise<Order> {
    const submitted: Order = {
      ...draft,
      clientId: draft.clientId ?? newClientId('o'),
      serverId: newClientId('local'),
      state: 'confirmed',           // сервера нет — сразу confirmed
      header,
      items: draft.items.map(it => ({ ...it, config: { ...it.config, hingePositions: [...it.config.hingePositions] } })),
      submittedAt: new Date().toISOString(),
    };
    orderHistory.unshift(submitted);
    persistOrders();
    // Корзина-черновик очищается
    order = emptyOrder();
    persistCart();
    return submitted;
  },
  list(): Order[] {
    return orderHistory;
  },
  get(id: string): Order | null {
    return orderHistory.find(o => o.serverId === id || o.clientId === id) ?? null;
  },
  subscribe(fn: () => void): () => void {
    ordersListeners.add(fn);
    return () => { ordersListeners.delete(fn); };
  },
};

const profileApi: ProfileApi = {
  get: () => profile,
  register(name: string, phone: string): Customer {
    profile = {
      id: newClientId('c'),
      name: name.trim(),
      phone: phone.trim(),
      addresses: [],
      createdAt: new Date().toISOString(),
    };
    persistProfile();
    return profile;
  },
  update(patch) {
    if (!profile) return;
    if (patch.name  !== undefined) profile.name  = patch.name.trim();
    if (patch.phone !== undefined) profile.phone = patch.phone.trim();
    persistProfile();
  },
  saveAddress(addr): SavedAddress {
    if (!profile) throw new Error('Сначала зарегистрируйтесь');
    const withId: SavedAddress = 'id' in addr && addr.id
      ? addr
      : { ...addr, id: newClientId('a') };
    const idx = profile.addresses.findIndex(a => a.id === withId.id);
    if (idx >= 0) profile.addresses[idx] = withId;
    else          profile.addresses.push(withId);
    persistProfile();
    return withId;
  },
  removeAddress(id: string) {
    if (!profile) return;
    profile.addresses = profile.addresses.filter(a => a.id !== id);
    persistProfile();
  },
  subscribe(fn: () => void): () => void {
    profileListeners.add(fn);
    return () => { profileListeners.delete(fn); };
  },
};

export const localApi: Api = { catalog, cart, orders, profile: profileApi };
