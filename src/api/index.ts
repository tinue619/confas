// Транспортный слой для бэкенда — единая точка для каталога, корзины и заказов.
//
// Сегодня — `localApi`: каталог из бандла (Vite import.meta.glob), корзина
// в localStorage. Завтра — `httpApi` поверх fetch без правок consumer'ов.
//
// Consumer'ы (UI / mountApp) ходят строго через `api.*`. Внутреннее
// устройство (localStorage, fetch, websockets и т.д.) скрыто.

import type { CatalogEntry } from '../model';
import type { Customer, Order, OrderHeader, OrderItem, SavedAddress } from '../order';
import { localApi } from './local';

export interface Api {
  catalog: CatalogApi;
  cart:    CartApi;
  orders:  OrdersApi;
  profile: ProfileApi;
}

export interface CatalogApi {
  /** Полный каталог моделей. На бэке — `GET /catalog/models`. */
  fetchModels(): Promise<CatalogEntry[]>;
  /** Словарь материалов и цен. На бэке — `GET /catalog/materials`. */
  fetchMaterials(): Promise<Record<string, MaterialDto>>;
}

export interface MaterialDto {
  name: string;
  purchase: number;
  k: number;
}

/** Корзина-черновик. Хранится у клиента до момента «Оформить». */
export interface CartApi {
  get(): Order;
  add(item: OrderItem): void;
  update(id: string, updater: (it: OrderItem) => OrderItem): void;
  setQty(id: string, qty: number): void;
  remove(id: string): void;
  clear(): void;
  subscribe(fn: () => void): () => void;
  /** Сгенерировать локальный ID (UUID-like). При синке с сервером заменится на serverId. */
  newId(): string;
}

/** Отправленные заказы. На бэке — `POST /orders`, `GET /orders`. */
export interface OrdersApi {
  /** Оформить корзину: создать заказ, вернуть его серверный ID. Сегодня —
   *  кладёт в локальную историю и возвращает 'local-…'. */
  submit(header: OrderHeader, cart: Order): Promise<Order>;
  /** Список ранее оформленных заказов (история). */
  list(): Order[];
  /** Получить один заказ по ID. */
  get(id: string): Order | null;
  subscribe(fn: () => void): () => void;
}

/** Профиль клиента + сохранённые адреса. На бэке — `GET/PUT /me`. */
export interface ProfileApi {
  /** Текущий профиль. null если ещё не зарегистрирован. */
  get(): Customer | null;
  /** Создать профиль при первой регистрации. */
  register(name: string, phone: string): Customer;
  /** Обновить имя/телефон. */
  update(patch: Partial<Pick<Customer, 'name' | 'phone'>>): void;
  /** Сохранить адрес. Если у адреса есть id — обновляет, иначе добавляет. */
  saveAddress(addr: SavedAddress | Omit<SavedAddress, 'id'>): SavedAddress;
  removeAddress(id: string): void;
  subscribe(fn: () => void): () => void;
}

/** Текущая реализация — локальная. Импортится туда, где нужно. */
export const api: Api = localApi;
