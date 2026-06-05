// Оформление заказа: профиль → форма → submit → история.
//
// При первом оформлении показываем регистрацию (имя + телефон), потом
// форму заказа: заголовок, адрес доставки (из сохранённых или новый, с
// опцией «сохранить»), телефон (дефолт из профиля), комментарий.

import { api } from './api';
import type { Order, OrderHeader, SavedAddress } from './order';
import { openSheet } from './ui-sheet';
import { escapeHtml } from './ui-format';
import { openOrderDetails } from './cabinet';

export function openCheckoutSheet() {
  const cart = api.cart.get();
  if (cart.items.length === 0) return;

  const profile = api.profile.get();
  if (!profile) {
    openRegisterSheet();
    return;
  }
  openOrderFormSheet();
}

function openRegisterSheet() {
  openSheet('Регистрация', (body, close) => {
    body.classList.add('checkout-body');
    body.innerHTML = `
      <div class="checkout-hint">Чтобы оформить заказ — представьтесь</div>
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
    const nameEl  = body.querySelector('#reg-name')  as HTMLInputElement;
    const phoneEl = body.querySelector('#reg-phone') as HTMLInputElement;
    const errEl   = body.querySelector('#reg-err')   as HTMLElement;
    const goBtn   = body.querySelector('#reg-go')    as HTMLButtonElement;
    setTimeout(() => nameEl.focus(), 100);
    goBtn.onclick = () => {
      const name = nameEl.value.trim();
      const phone = phoneEl.value.trim();
      if (!name)  { errEl.hidden = false; errEl.textContent = 'Укажите имя'; nameEl.focus(); return; }
      if (!isValidPhone(phone)) { errEl.hidden = false; errEl.textContent = 'Укажите телефон'; phoneEl.focus(); return; }
      api.profile.register(name, phone);
      close();
      // После регистрации сразу — форма заказа.
      setTimeout(() => openOrderFormSheet(), 100);
    };
  }, { id: 'checkout-reg' });
}

function openOrderFormSheet() {
  openSheet('Оформление', (body, close) => {
    const profile = api.profile.get()!;
    let pickedAddressId: string | null = profile.addresses[0]?.id ?? null;
    let customAddress = '';
    let saveAddr = false;

    body.classList.add('checkout-body');

    const render = () => {
      body.innerHTML = `
        <label class="checkout-field">
          <span class="checkout-label">Название заказа</span>
          <input type="text" class="checkout-input" id="ord-title" placeholder="Например: «Кухня Иванов»">
        </label>

        <div class="checkout-field">
          <span class="checkout-label">Адрес доставки</span>
          ${renderAddressBlock(profile.addresses, pickedAddressId)}
        </div>

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

      // Привязка обработчиков для выбора сохранённого адреса
      body.querySelectorAll<HTMLElement>('.addr-chip').forEach(el => {
        el.onclick = () => {
          pickedAddressId = el.dataset.id || null;
          customAddress = '';
          render();
        };
      });
      const newBtn = body.querySelector<HTMLButtonElement>('#addr-new');
      if (newBtn) newBtn.onclick = () => {
        pickedAddressId = null;
        render();
        (body.querySelector('#addr-input') as HTMLInputElement)?.focus();
      };
      const inp = body.querySelector<HTMLInputElement>('#addr-input');
      if (inp) inp.oninput = () => { customAddress = inp.value; };
      const saveChk = body.querySelector<HTMLInputElement>('#addr-save');
      if (saveChk) saveChk.onchange = () => { saveAddr = saveChk.checked; };

      (body.querySelector('#ord-go') as HTMLButtonElement).onclick = () => submit();
    };

    const submit = async () => {
      const title    = (body.querySelector('#ord-title')   as HTMLInputElement).value.trim();
      const phone    = (body.querySelector('#ord-phone')   as HTMLInputElement).value.trim();
      const comment  = (body.querySelector('#ord-comment') as HTMLTextAreaElement).value.trim();
      const err      = body.querySelector('#ord-err') as HTMLElement;
      let address = '';
      if (pickedAddressId) {
        const saved = profile.addresses.find(a => a.id === pickedAddressId);
        address = saved?.address ?? '';
      } else {
        address = customAddress.trim();
      }

      if (!title)   { err.hidden = false; err.textContent = 'Введите название заказа'; return; }
      if (!address) { err.hidden = false; err.textContent = 'Укажите адрес доставки'; return; }
      if (!isValidPhone(phone)) { err.hidden = false; err.textContent = 'Укажите корректный телефон'; return; }

      if (!pickedAddressId && saveAddr && address) {
        api.profile.saveAddress({ address });
      }

      const header: OrderHeader = {
        title,
        contact: { name: profile.name, phone },
        delivery: { address },
        comment: comment || undefined,
      };

      const cart = api.cart.get();
      const result = await api.orders.submit(header, cart);
      close();
      setTimeout(() => openOrderSuccess(result), 100);
    };

    render();
  }, { id: 'checkout-form' });
}

function openOrderSuccess(order: Order) {
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
    (body.querySelector('#ok-go') as HTMLButtonElement).onclick = close;
    (body.querySelector('#ok-view') as HTMLButtonElement).onclick = () => {
      close();
      setTimeout(() => openOrderDetails(order), 100);
    };
  }, { id: 'checkout-success' });
}

function renderAddressBlock(saved: SavedAddress[], pickedId: string | null): string {
  const customSelected = pickedId === null;
  const chips = saved.map(a => `
    <button class="addr-chip ${a.id === pickedId ? 'active' : ''}" data-id="${escapeHtml(a.id)}" type="button">
      ${a.label ? `<span class="addr-chip-label">${escapeHtml(a.label)}</span>` : ''}
      <span class="addr-chip-text">${escapeHtml(a.address)}</span>
    </button>`).join('');
  return `
    <div class="addr-chips">
      ${chips}
      <button class="addr-chip addr-chip--new ${customSelected ? 'active' : ''}" id="addr-new" type="button">+ Новый</button>
    </div>
    ${customSelected ? `
      <input type="text" class="checkout-input" id="addr-input" placeholder="Город, улица, дом, квартира" value="${escapeHtml('')}">
      <label class="checkout-checkbox">
        <input type="checkbox" id="addr-save">
        <span>Сохранить адрес в профиле</span>
      </label>
    ` : ''}`;
}

function isValidPhone(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  return digits.length >= 9;
}
