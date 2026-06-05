// Заказ = массив позиций. Каждая позиция — снимок выборов пользователя
// + снимок рассчитанной цены в момент добавления.

import type { Category } from './model';
import type { ProfileColor, GlassColor, GlassType } from './catalog';
import type { HingeMode, HingeSide } from './state';
import type { PriceBreakdown } from './pricing';

/** Сериализуемая копия FacadeState (без методов) */
export interface FacadeConfig {
  width: number;
  height: number;
  profileColor: ProfileColor;
  glassColor:   GlassColor;
  glassType:    GlassType;
  tempered:     boolean;
  hingeMode:    HingeMode;
  hingeSide:    HingeSide;
  hingePositions: number[];
}

export interface OrderItem {
  /** Локальный id строки (генерится клиентом, остаётся на всю жизнь записи) */
  id: string;
  /** ID, выданный сервером после синхронизации. Заполняется при появлении бэка. */
  serverId?: string;
  /** Ссылка на модель в каталоге */
  modelRef: { category: Category; modelId: string };
  /** Снимок названия модели (на случай если модель удалят/переименуют) */
  modelName: string;
  /** Снимок конфигурации пользователя */
  config: FacadeConfig;
  /** Оценка цены (за 1 шт). Когда подключим сервер — он вернёт авторитетную;
   *  сейчас рассчитывается локально и используется только для UI. */
  priceSnapshot: PriceBreakdown;
  /** Количество */
  qty: number;
  /** Время добавления */
  addedAt: string;
}

/** Состояние заказа относительно бэка. */
export type OrderState = 'draft' | 'pending' | 'confirmed' | 'failed';

/** Сохранённый адрес доставки в профиле клиента. */
export interface SavedAddress {
  id: string;
  /** Опциональная метка: «Дом», «Офис» и т.д. */
  label?: string;
  address: string;
}

/** Профиль конечного заказчика. Хранится локально; когда поднимется
 *  бэк — синхронизируется как аккаунт. */
export interface Customer {
  id: string;
  name: string;
  phone: string;
  addresses: SavedAddress[];
  createdAt: string;
}

/** Данные конкретной отправки заказа: контакт + доставка + название. */
export interface OrderHeader {
  /** Заголовок, который клиент сам задаёт для навигации в истории. */
  title: string;
  /** Снимок контакта (по умолчанию из профиля, можно переопределить). */
  contact: { name: string; phone: string };
  /** Адрес доставки на момент оформления. */
  delivery: { address: string };
  comment?: string;
}

export interface Order {
  /** Локальный ID заказа. На сервере получит serverId. */
  clientId?: string;
  serverId?: string;
  state?: OrderState;
  /** Шапка заказа — заполняется в момент оформления. У черновика отсутствует. */
  header?: OrderHeader;
  items: OrderItem[];
  /** Время отправки (когда state стал != 'draft'). */
  submittedAt?: string;
}

export function emptyOrder(): Order {
  return { items: [] };
}

export function orderTotal(order: Order): number {
  return order.items.reduce((s, i) => s + i.priceSnapshot.total * i.qty, 0);
}

export function orderItemCount(order: Order): number {
  return order.items.reduce((s, i) => s + i.qty, 0);
}
