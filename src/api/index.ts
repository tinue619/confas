// Транспортный слой для бэкенда — единая точка для каталога, корзины и заказов.
//
// Сегодня — `localApi`: каталог из бандла (Vite import.meta.glob), корзина
// в localStorage. Завтра — `httpApi` поверх fetch без правок consumer'ов.
//
// Consumer'ы (UI / mountApp) ходят строго через `api.*`. Внутреннее
// устройство (localStorage, fetch, websockets и т.д.) скрыто.

import type { CatalogEntry } from '../model';
import type { Order, OrderItem } from '../order';
import { localApi } from './local';

export interface Api {
  catalog: CatalogApi;
  cart:    CartApi;
  orders:  OrdersApi;
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

/** Отправка заказа на бэк. Сейчас — заглушка. */
export interface OrdersApi {
  /** Поставить заказ в очередь на отправку. Сейчас просто помечает state='pending'. */
  submit(order: Order): Promise<{ serverId: string; total: number }>;
  /** Получить статус заказа по серверному ID. Сейчас — отказ. */
  getStatus(serverId: string): Promise<Order>;
}

/** Текущая реализация — локальная. Импортится туда, где нужно. */
export const api: Api = localApi;
