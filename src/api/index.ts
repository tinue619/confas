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

/** Заказы — единая сущность с состоянием (`draft` → `confirmed`).
 *  Черновик наполняется в конфигураторе; «Оформить» переводит его в `confirmed`.
 *  На бэке — `GET/POST /orders`, `PATCH /orders/:id`. */
export interface OrdersApi {
  /** Все заказы (черновики + отправленные), свежие сверху. */
  list(): Order[];
  /** Получить один заказ по clientId/serverId. */
  get(id: string): Order | null;
  /** Создать новый черновик (пустой) и вернуть его. */
  createDraft(): Order;
  /** Добавить позицию в заказ-черновик. */
  addItem(orderId: string, item: OrderItem): void;
  /** Заменить позицию (для редактирования). */
  updateItem(orderId: string, itemId: string, updater: (it: OrderItem) => OrderItem): void;
  /** Изменить количество позиции. */
  setQty(orderId: string, itemId: string, qty: number): void;
  /** Удалить позицию. */
  removeItem(orderId: string, itemId: string): void;
  /** Удалить заказ целиком (например, пустой черновик при выходе). */
  deleteOrder(orderId: string): void;
  /** Оформить черновик: проставить шапку, перевести в `confirmed`. */
  submit(orderId: string, header: OrderHeader): Promise<Order>;
  subscribe(fn: () => void): () => void;
  /** Сгенерировать локальный ID (UUID-like). При синке заменится на serverId. */
  newId(): string;
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
