// Оформление активного черновика: форма (название, адрес, телефон,
// комментарий) → submit → экран успеха.
//
// Профиль к этому моменту уже есть (регистрация — гейт в «доме»). Заказ —
// это активный черновик из order-store; submit переводит его в `confirmed`.
// После оформления зовём onSubmitted, чтобы хост (конфигуратор) закрылся и
// вернул нас в кабинет (опционально — сразу на детали заказа).

import { api } from './api';
import type { Order, OrderHeader } from './order';
import { openSheet } from './ui-sheet';
import { escapeHtml } from './ui-format';
import * as store from './order-store';

export interface CheckoutCallbacks {
  /** Заказ оформлен. openDetails — открыть ли сразу карточку заказа. */
  onSubmitted?: (order: Order, openDetails: boolean) => void;
}

export function openCheckoutSheet(cb: CheckoutCallbacks = {}) {
  const draft = store.getOrder();
  if (draft.items.length === 0) return;
  if (!api.profile.get()) return; // в новой модели сюда не попасть без профиля
  openOrderFormSheet(cb);
}

function openOrderFormSheet(cb: CheckoutCallbacks) {
  openSheet('Оформление', (body, close) => {
    const profile = api.profile.get()!;
    body.classList.add('checkout-body');
    body.innerHTML = `
      <label class="checkout-field">
        <span class="checkout-label">Название заказа</span>
        <input type="text" class="checkout-input" id="ord-title" placeholder="Например: «Кухня Иванов»">
      </label>

      <label class="checkout-field">
        <span class="checkout-label">Телефон</span>
        <input type="tel" class="checkout-input" id="ord-phone" inputmode="tel" value="${escapeHtml(profile.phone)}">
      </label>

      <label class="checkout-field">
        <span class="checkout-label">Комментарий</span>
        <textarea class="checkout-input checkout-textarea" id="ord-comment" rows="3" placeholder="Пожелания, сроки, особенности"></textarea>
      </label>

      <div class="checkout-error" id="ord-err" hidden></div>

      <div class="checkout-actions">
        <button class="btn btn-primary checkout-submit" id="ord-go">Отправить заказ</button>
      </div>`;

    (body.querySelector('#ord-go') as HTMLButtonElement).onclick = async () => {
      const title   = (body.querySelector('#ord-title')   as HTMLInputElement).value.trim();
      const phone   = (body.querySelector('#ord-phone')   as HTMLInputElement).value.trim();
      const comment = (body.querySelector('#ord-comment') as HTMLTextAreaElement).value.trim();
      const err     = body.querySelector('#ord-err') as HTMLElement;

      if (!title)               { err.hidden = false; err.textContent = 'Введите название заказа'; return; }
      if (!isValidPhone(phone)) { err.hidden = false; err.textContent = 'Укажите корректный телефон'; return; }

      // Доставка пока скрыта — заказы забираются/обсуждаются вручную.
      // Когда производство будет готово к доставке, вернём поле адреса
      // (тип OrderHeader.delivery.address уже на месте).
      const header: OrderHeader = {
        title,
        contact: { name: profile.name, phone },
        delivery: { address: '' },
        comment: comment || undefined,
      };

      const result = await store.submitActive(header);
      close();
      setTimeout(() => openOrderSuccess(result, cb), 100);
    };
  }, { id: 'checkout-form' });
}

function openOrderSuccess(order: Order, cb: CheckoutCallbacks) {
  openSheet('Заказ отправлен', (body, close) => {
    body.classList.add('checkout-body');
    const itemsCount = order.items.reduce((s, i) => s + i.qty, 0);
    const total = order.items.reduce((s, i) => s + i.priceSnapshot.total * i.qty, 0);
    body.innerHTML = `
      <div class="checkout-success">
        <div class="checkout-success-icon">✓</div>
        <div class="checkout-success-title">${escapeHtml(order.header?.title ?? 'Заказ')}</div>
        <div class="checkout-success-meta">${itemsCount} поз. · ${total.toLocaleString('ru-KZ')} ₸</div>
        <div class="checkout-success-hint">Заказ принят. Все заказы — в личном кабинете.</div>
      </div>
      <div class="checkout-actions checkout-actions--col">
        <button class="btn btn-primary checkout-submit" id="ok-view">Открыть заказ</button>
        <button class="btn btn-ghost checkout-submit" id="ok-go">Готово</button>
      </div>`;
    (body.querySelector('#ok-go') as HTMLButtonElement).onclick = () => {
      close();
      cb.onSubmitted?.(order, false);
    };
    (body.querySelector('#ok-view') as HTMLButtonElement).onclick = () => {
      close();
      cb.onSubmitted?.(order, true);
    };
  }, { id: 'checkout-success' });
}

function isValidPhone(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  return digits.length >= 9;
}
