// Личный кабинет = «дом» приложения (полноэкранный раздел, открыт по
// умолчанию поверх конфигуратора). Внутри — стек страниц:
//   корень (профиль + «+ Новый заказ» + заказы) → детали заказа
//                                                → правка профиля
//
// Если профиль ещё не создан — корень показывает регистрацию (гейт при
// первом запуске). Конфигуратор открывается из кабинета: «+ Новый заказ»
// или тап по черновику. Всё ходит через api.profile / api.orders.

import { api } from './api';
import type { Order, OrderState } from './order';
import { fmtMoney, escapeHtml, compactSpec, facadeIcon } from './ui-format';
import { bindLongPress } from './item-preview';

const STATE_LABEL: Record<OrderState, string> = {
  draft:     'Черновик',
  pending:   'Отправляется',
  confirmed: 'Принят',
  failed:    'Ошибка',
};

const ICON_BACK  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`;

interface Page {
  title: string;
  build: (body: HTMLElement) => void;
  action?: { label: string; onClick: () => void };
}

interface CabinetHandlers {
  /** «+ Новый заказ» — начать сборку нового черновика в конфигураторе. */
  onNewOrder: () => void;
  /** Тап по черновику — продолжить его в конфигураторе. */
  onOpenDraft: (id: string) => void;
}

let handlers: CabinetHandlers = { onNewOrder: () => {}, onOpenDraft: () => {} };
export function setCabinetHandlers(h: CabinetHandlers) { handlers = h; }

let overlay: HTMLElement | null = null;
let stack: Page[] = [];
let unsubs: Array<() => void> = [];

export function openCabinet(opts: { animate?: boolean } = {}) {
  const animate = opts.animate ?? true;
  ensureOverlay(animate);
  stack = [rootPage()];
  renderTop();
}

export function closeCabinet() {
  if (!overlay) return;
  unsubs.forEach(fn => fn()); unsubs = [];
  const o = overlay;
  overlay = null;
  stack = [];
  o.classList.remove('screen-overlay--open');
  setTimeout(() => o.remove(), 300);
}

/** Открыть кабинет сразу на деталях заказа (из экрана «Заказ принят»). */
export function openOrderDetails(o: Order) {
  ensureOverlay(true);
  if (stack.length === 0) stack = [rootPage()];
  stack.push(orderDetailsPage(o));
  renderTop();
}

function ensureOverlay(animate: boolean) {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'screen-overlay';
  overlay.innerHTML = `
    <div class="screen-header">
      <button class="screen-back" id="screen-back" aria-label="Назад"></button>
      <div class="screen-title" id="screen-title"></div>
      <div class="screen-action" id="screen-action"></div>
    </div>
    <div class="screen-body" id="screen-body"></div>`;
  document.body.appendChild(overlay);

  (overlay.querySelector('#screen-back') as HTMLElement).onclick = () => {
    if (stack.length > 1) { stack.pop(); renderTop(); }
  };

  if (animate) {
    requestAnimationFrame(() => overlay!.classList.add('screen-overlay--open'));
  } else {
    overlay.style.transition = 'none';
    overlay.classList.add('screen-overlay--open');
    void overlay.offsetHeight;
    overlay.style.transition = '';
  }

  // Живое обновление, пока кабинет открыт.
  unsubs.push(api.orders.subscribe(renderTop));
  unsubs.push(api.profile.subscribe(renderTop));
}

function renderTop() {
  if (!overlay) return;
  const p = stack[stack.length - 1];
  if (!p) return;

  (overlay.querySelector('#screen-title') as HTMLElement).textContent = p.title;

  // На корне (дом) кнопки «назад» нет — выйти можно только в конфигуратор.
  const back = overlay.querySelector('#screen-back') as HTMLElement;
  const isRoot = stack.length <= 1;
  back.innerHTML = isRoot ? '' : ICON_BACK;
  back.style.visibility = isRoot ? 'hidden' : 'visible';

  const actionSlot = overlay.querySelector('#screen-action') as HTMLElement;
  actionSlot.innerHTML = '';
  if (p.action) {
    const btn = document.createElement('button');
    btn.className = 'screen-action-btn';
    btn.textContent = p.action.label;
    btn.onclick = p.action.onClick;
    actionSlot.appendChild(btn);
  }

  const body = overlay.querySelector('#screen-body') as HTMLElement;
  body.innerHTML = '';
  body.scrollTop = 0;
  p.build(body);
}

// ─── Корень: регистрация ИЛИ профиль + заказы ────────────────────────────────

function rootPage(): Page {
  return {
    title: 'Личный кабинет',
    build(body) {
      const profile = api.profile.get();
      if (!profile) { buildRegistration(body); return; }

      const wrap = document.createElement('div');
      wrap.className = 'cabinet-body';
      body.appendChild(wrap);

      const orders = api.orders.list();
      const initials = profile.name.trim().charAt(0).toUpperCase() || '?';
      wrap.innerHTML = `
        <div class="cab-profile">
          <div class="cab-avatar">${escapeHtml(initials)}</div>
          <div class="cab-profile-info">
            <div class="cab-profile-name">${escapeHtml(profile.name)}</div>
            <div class="cab-profile-phone">${escapeHtml(profile.phone)}</div>
          </div>
          <button class="cab-edit-btn" id="cab-edit" type="button">Изменить</button>
        </div>

        <button class="cab-new-order" id="cab-new" type="button">
          <span class="cab-new-plus">＋</span> Новый заказ
        </button>

        <div class="cab-section-title">Мои заказы ${orders.length ? `<span class="cab-count">${orders.length}</span>` : ''}</div>
        <div class="cab-orders" id="cab-orders"></div>`;

      (wrap.querySelector('#cab-edit') as HTMLButtonElement).onclick = () => {
        stack.push(profileEditPage());
        renderTop();
      };
      (wrap.querySelector('#cab-new') as HTMLButtonElement).onclick = () => {
        closeCabinet();
        handlers.onNewOrder();
      };

      const list = wrap.querySelector('#cab-orders') as HTMLElement;
      if (orders.length === 0) {
        list.innerHTML = `<div class="cab-orders-empty">Заказов пока нет</div>`;
        return;
      }
      orders.forEach(o => list.appendChild(orderRow(o)));
    },
  };
}

function buildRegistration(body: HTMLElement) {
  const wrap = document.createElement('div');
  wrap.className = 'cabinet-body checkout-body';
  body.appendChild(wrap);
  wrap.innerHTML = `
    <div class="checkout-hint">Добро пожаловать! Представьтесь, чтобы оформлять заказы и видеть их историю.</div>
    <label class="checkout-field">
      <span class="checkout-label">Имя</span>
      <input type="text" class="checkout-input" id="reg-name" autocomplete="name" placeholder="Как к вам обращаться">
    </label>
    <label class="checkout-field">
      <span class="checkout-label">Телефон</span>
      <input type="tel" class="checkout-input" id="reg-phone" autocomplete="tel" inputmode="tel" placeholder="+7 …">
    </label>
    <div class="checkout-error" id="reg-err" hidden></div>
    <div class="checkout-actions">
      <button class="btn btn-primary checkout-submit" id="reg-go">Продолжить</button>
    </div>`;
  const nameEl  = wrap.querySelector('#reg-name')  as HTMLInputElement;
  const phoneEl = wrap.querySelector('#reg-phone') as HTMLInputElement;
  const errEl   = wrap.querySelector('#reg-err')   as HTMLElement;
  setTimeout(() => nameEl.focus(), 150);
  (wrap.querySelector('#reg-go') as HTMLButtonElement).onclick = () => {
    const name = nameEl.value.trim();
    const phone = phoneEl.value.trim();
    if (!name)  { errEl.hidden = false; errEl.textContent = 'Укажите имя'; nameEl.focus(); return; }
    if (phone.replace(/\D/g, '').length < 9) { errEl.hidden = false; errEl.textContent = 'Укажите телефон'; phoneEl.focus(); return; }
    api.profile.register(name, phone); // подписка перерисует корень → хаб
  };
}

function orderRow(o: Order): HTMLElement {
  const row = document.createElement('button');
  row.className = 'cab-order';
  row.type = 'button';
  const count = o.items.reduce((s, i) => s + i.qty, 0);
  const total = o.items.reduce((s, i) => s + i.priceSnapshot.total * i.qty, 0);
  const state = o.state ?? 'confirmed';
  const isDraft = state === 'draft';
  const title = o.header?.title ?? (isDraft ? 'Черновик' : 'Без названия');
  const dateOrHint = isDraft ? 'не отправлен' : fmtDate(o.submittedAt);
  row.innerHTML = `
    <div class="cab-order-top">
      <span class="cab-order-title">${escapeHtml(title)}</span>
      <span class="cab-badge cab-badge--${state}">${STATE_LABEL[state]}</span>
    </div>
    <div class="cab-order-meta">
      <span>${dateOrHint}</span>
      <span class="cab-dot">·</span>
      <span>${count} поз.</span>
      <span class="cab-order-total">${fmtMoney(total)}</span>
    </div>`;
  row.onclick = () => {
    if (isDraft) {
      closeCabinet();
      handlers.onOpenDraft(o.clientId!);
    } else {
      stack.push(orderDetailsPage(o));
      renderTop();
    }
  };
  return row;
}

function orderDetailsPage(o: Order): Page {
  return {
    title: o.header?.title ?? 'Заказ',
    build(body) {
      const wrap = document.createElement('div');
      wrap.className = 'cabinet-body';
      body.appendChild(wrap);

      const state = o.state ?? 'confirmed';
      const total = o.items.reduce((s, i) => s + i.priceSnapshot.total * i.qty, 0);
      const h = o.header;

      const itemsHtml = o.items.map((it, i) => {
        const c = it.config;
        const spec = compactSpec(c);
        return `
          <div class="cab-item" data-item-id="${escapeHtml(it.id)}">
            <span class="cab-item-num">${i + 1}.</span>
            <span class="cab-item-size">${c.width}×${c.height}</span>
            ${facadeIcon(c, 'od-' + it.id)}
            <span class="cab-item-spec">${escapeHtml(spec || '—')}</span>
            <span class="cab-item-qty">×${it.qty}</span>
            <span class="cab-item-total">${fmtMoney(it.priceSnapshot.total * it.qty)}</span>
          </div>`;
      }).join('');

      wrap.innerHTML = `
        <div class="cab-od-head">
          <span class="cab-badge cab-badge--${state}">${STATE_LABEL[state]}</span>
          <span class="cab-od-date">${fmtDate(o.submittedAt)}</span>
        </div>

        ${h ? `
        <div class="cab-od-block">
          <div class="cab-od-row"><span class="cab-od-label">Получатель</span><span class="cab-od-val">${escapeHtml(h.contact.name)}</span></div>
          <div class="cab-od-row"><span class="cab-od-label">Телефон</span><span class="cab-od-val">${escapeHtml(h.contact.phone)}</span></div>
          ${h.delivery.address ? `<div class="cab-od-row"><span class="cab-od-label">Доставка</span><span class="cab-od-val">${escapeHtml(h.delivery.address)}</span></div>` : ''}
          ${h.comment ? `<div class="cab-od-row"><span class="cab-od-label">Комментарий</span><span class="cab-od-val">${escapeHtml(h.comment)}</span></div>` : ''}
        </div>` : ''}

        <div class="cab-section-title">Состав <span class="cab-section-hint">удерживайте для превью</span></div>
        <div class="cab-items">${itemsHtml}</div>

        <div class="cab-od-total">
          <span>Итого</span>
          <span class="cab-od-total-val">${fmtMoney(total)}</span>
        </div>`;

      // Long-press на строке позиции → превью изделия (как в корзине).
      wrap.querySelectorAll<HTMLElement>('.cab-item').forEach((row, i) => {
        const id = row.dataset.itemId;
        const item = o.items.find(it => it.id === id);
        if (item) bindLongPress(row, item, i + 1);
      });
    },
  };
}

function profileEditPage(): Page {
  const profile0 = api.profile.get();
  let draftName  = profile0?.name  ?? '';
  let draftPhone = profile0?.phone ?? '';

  const page: Page = {
    title: 'Профиль',
    build(body) {
      const profile = api.profile.get();
      if (!profile) { stack.pop(); renderTop(); return; }

      const wrap = document.createElement('div');
      wrap.className = 'cabinet-body checkout-body';
      body.appendChild(wrap);

      // Адреса временно скрыты — производство ещё не готово к доставке.
      // Когда вернём, добавим сюда блок сохранённых адресов; данные в
      // profile.addresses сохраняются.
      wrap.innerHTML = `
        <label class="checkout-field">
          <span class="checkout-label">Имя</span>
          <input type="text" class="checkout-input" id="pe-name" value="${escapeHtml(draftName)}">
        </label>
        <label class="checkout-field">
          <span class="checkout-label">Телефон</span>
          <input type="tel" class="checkout-input" id="pe-phone" inputmode="tel" value="${escapeHtml(draftPhone)}">
        </label>

        <div class="checkout-error" id="pe-err" hidden></div>`;

      const nameEl  = wrap.querySelector('#pe-name')  as HTMLInputElement;
      const phoneEl = wrap.querySelector('#pe-phone') as HTMLInputElement;
      nameEl.oninput  = () => { draftName  = nameEl.value; };
      phoneEl.oninput = () => { draftPhone = phoneEl.value; };
    },
    action: {
      label: 'Сохранить',
      onClick: () => {
        const err = overlay?.querySelector('#pe-err') as HTMLElement | null;
        if (!draftName.trim()) { if (err) { err.hidden = false; err.textContent = 'Укажите имя'; } return; }
        if (draftPhone.replace(/\D/g, '').length < 9) { if (err) { err.hidden = false; err.textContent = 'Укажите корректный телефон'; } return; }
        api.profile.update({ name: draftName.trim(), phone: draftPhone.trim() });
        stack.pop();
        renderTop();
      },
    },
  };
  return page;
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) +
         ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
