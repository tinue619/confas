// Личный кабинет — раздел верхнего уровня (полноэкранный оверлей, выше
// редактора в иерархии), а не контекстная шторка.
//
// Внутри — простой стек страниц с навигацией «назад»:
//   корень (профиль + заказы) → детали заказа
//                             → правка профиля
//
// Всё ходит через api.profile / api.orders — при появлении бэка меняем только
// реализацию api, экраны кабинета не трогаем.

import { api } from './api';
import type { Order, OrderState } from './order';
import { fmtMoney, escapeHtml, compactSpec, facadeIcon } from './ui-format';

const STATE_LABEL: Record<OrderState, string> = {
  draft:     'Черновик',
  pending:   'Отправляется',
  confirmed: 'Принят',
  failed:    'Ошибка',
};

const ICON_BACK  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

interface Page {
  title: string;
  build: (body: HTMLElement) => void;
  /** action-кнопка справа в шапке (например «Сохранить») */
  action?: { label: string; onClick: () => void };
}

let overlay: HTMLElement | null = null;
let stack: Page[] = [];
let unsubs: Array<() => void> = [];

export function openCabinet() {
  ensureOverlay();
  stack = [rootPage()];
  renderTop();
}

/** Открыть кабинет сразу на деталях заказа (из экрана «Заказ принят»). */
export function openOrderDetails(o: Order) {
  ensureOverlay();
  // База стека — список, чтобы «назад» вёл в историю.
  if (stack.length === 0) stack = [rootPage()];
  stack.push(orderDetailsPage(o));
  renderTop();
}

function ensureOverlay() {
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
    else closeCabinet();
  };

  requestAnimationFrame(() => overlay!.classList.add('screen-overlay--open'));

  // Живое обновление, пока кабинет открыт.
  unsubs.push(api.orders.subscribe(renderTop));
  unsubs.push(api.profile.subscribe(renderTop));
}

function closeCabinet() {
  if (!overlay) return;
  unsubs.forEach(fn => fn()); unsubs = [];
  const o = overlay;
  overlay = null;
  stack = [];
  o.classList.remove('screen-overlay--open');
  setTimeout(() => o.remove(), 300);
}

function renderTop() {
  if (!overlay) return;
  const p = stack[stack.length - 1];
  if (!p) { closeCabinet(); return; }

  (overlay.querySelector('#screen-title') as HTMLElement).textContent = p.title;
  (overlay.querySelector('#screen-back') as HTMLElement).innerHTML =
    stack.length > 1 ? ICON_BACK : ICON_CLOSE;

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

// ─── Страницы ──────────────────────────────────────────────────────────────

function rootPage(): Page {
  return {
    title: 'Личный кабинет',
    build(body) {
      const wrap = document.createElement('div');
      wrap.className = 'cabinet-body';
      body.appendChild(wrap);

      const profile = api.profile.get();
      const orders  = api.orders.list();

      if (!profile) {
        wrap.innerHTML = `
          <div class="cabinet-empty">
            <div class="cabinet-empty-title">Вы ещё не зарегистрированы</div>
            <div class="cabinet-empty-hint">Оформите первый заказ — и здесь появится профиль и история.</div>
          </div>`;
        return;
      }

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

        <div class="cab-section-title">Мои заказы ${orders.length ? `<span class="cab-count">${orders.length}</span>` : ''}</div>
        <div class="cab-orders" id="cab-orders"></div>`;

      (wrap.querySelector('#cab-edit') as HTMLButtonElement).onclick = () => {
        stack.push(profileEditPage());
        renderTop();
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

function orderRow(o: Order): HTMLElement {
  const row = document.createElement('button');
  row.className = 'cab-order';
  row.type = 'button';
  const count = o.items.reduce((s, i) => s + i.qty, 0);
  const total = o.items.reduce((s, i) => s + i.priceSnapshot.total * i.qty, 0);
  const state = o.state ?? 'confirmed';
  row.innerHTML = `
    <div class="cab-order-top">
      <span class="cab-order-title">${escapeHtml(o.header?.title ?? 'Без названия')}</span>
      <span class="cab-badge cab-badge--${state}">${STATE_LABEL[state]}</span>
    </div>
    <div class="cab-order-meta">
      <span>${fmtDate(o.submittedAt)}</span>
      <span class="cab-dot">·</span>
      <span>${count} поз.</span>
      <span class="cab-order-total">${fmtMoney(total)}</span>
    </div>`;
  row.onclick = () => { stack.push(orderDetailsPage(o)); renderTop(); };
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
          <div class="cab-item">
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
          <div class="cab-od-row"><span class="cab-od-label">Доставка</span><span class="cab-od-val">${escapeHtml(h.delivery.address)}</span></div>
          ${h.comment ? `<div class="cab-od-row"><span class="cab-od-label">Комментарий</span><span class="cab-od-val">${escapeHtml(h.comment)}</span></div>` : ''}
        </div>` : ''}

        <div class="cab-section-title">Состав</div>
        <div class="cab-items">${itemsHtml}</div>

        <div class="cab-od-total">
          <span>Итого</span>
          <span class="cab-od-total-val">${fmtMoney(total)}</span>
        </div>`;
    },
  };
}

function profileEditPage(): Page {
  // Локальный черновик имени/телефона — чтобы ввод не сбрасывался при
  // перерисовке (добавление/удаление адреса триггерит подписку).
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

      const addrHtml = profile.addresses.map(a => `
        <div class="cab-addr">
          <span class="cab-addr-text">${escapeHtml(a.address)}</span>
          <button class="cab-addr-del" data-id="${escapeHtml(a.id)}" type="button" aria-label="Удалить">×</button>
        </div>`).join('');

      wrap.innerHTML = `
        <label class="checkout-field">
          <span class="checkout-label">Имя</span>
          <input type="text" class="checkout-input" id="pe-name" value="${escapeHtml(draftName)}">
        </label>
        <label class="checkout-field">
          <span class="checkout-label">Телефон</span>
          <input type="tel" class="checkout-input" id="pe-phone" inputmode="tel" value="${escapeHtml(draftPhone)}">
        </label>

        <div class="checkout-field">
          <span class="checkout-label">Сохранённые адреса</span>
          <div class="cab-addrs">${addrHtml || '<div class="cab-orders-empty">Нет сохранённых адресов</div>'}</div>
          <div class="cab-addr-add">
            <input type="text" class="checkout-input" id="pe-addr" placeholder="Добавить адрес">
            <button class="btn btn-ghost cab-addr-add-btn" id="pe-addr-add" type="button">＋</button>
          </div>
        </div>

        <div class="checkout-error" id="pe-err" hidden></div>`;

      const nameEl  = wrap.querySelector('#pe-name')  as HTMLInputElement;
      const phoneEl = wrap.querySelector('#pe-phone') as HTMLInputElement;
      nameEl.oninput  = () => { draftName  = nameEl.value; };
      phoneEl.oninput = () => { draftPhone = phoneEl.value; };

      wrap.querySelectorAll<HTMLButtonElement>('.cab-addr-del').forEach(btn => {
        btn.onclick = () => { api.profile.removeAddress(btn.dataset.id!); /* подписка перерисует */ };
      });

      const addInput = wrap.querySelector('#pe-addr') as HTMLInputElement;
      (wrap.querySelector('#pe-addr-add') as HTMLButtonElement).onclick = () => {
        const v = addInput.value.trim();
        if (!v) return;
        api.profile.saveAddress({ address: v }); // подписка перерисует
      };
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
