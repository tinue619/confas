// Потоки:
//   категория → модель → конфигурация → [+ В заказ] → корзина → [Оформить]
//   корзина → клик по позиции → конфигурация в режиме редактирования → [Сохранить]

import { FacadeState, sideLength, autoHingePositions,
         type HingeMode, type HingeSide } from './state';
import { PROFILE_COLORS, GLASS_COLORS, GLASS_TYPES,
         type ProfileColor, type GlassColor, type GlassType } from './catalog';
import { CATEGORY_LABEL,
         type Category, type CatalogEntry, type FacadeModel, type HingesSpec } from './model';
import { modelsByCategory, categoryHasModels, CATALOG } from './models-loader';
import { createScene } from './scene';
import { calcPrice } from './pricing';
import { type FacadeConfig, type OrderItem, orderItemCount, orderTotal } from './order';
import * as store from './order-store';

type View =
  | { kind: 'category' }
  | { kind: 'model'; category: Category }
  | { kind: 'config'; entry: CatalogEntry; editingItemId?: string; returnTo: 'model' | 'cart' };

export function mountUI(root: HTMLElement) {
  injectResponsiveStyles();
  root.innerHTML = '';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%';

  // ── Контекстная шапка: слева кнопка/заголовок, справа корзина ──────────
  const topbar = document.createElement('header');
  topbar.className = 'app-topbar';
  topbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 14px;background:#fff;border-bottom:1px solid #e1e3e8;flex:0 0 auto;min-height:48px';
  root.appendChild(topbar);

  const leftBox = document.createElement('div');
  leftBox.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0';
  topbar.appendChild(leftBox);

  const cartBtn = document.createElement('button');
  cartBtn.style.cssText = 'background:#f4f5f7;border:1px solid #e1e3e8;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;display:flex;gap:8px;align-items:center;flex:0 0 auto;min-height:40px';
  cartBtn.onclick = () => openCartSheet();
  topbar.appendChild(cartBtn);

  // ── Контейнер контента (меняется при смене view) ───────────────────────
  const content = document.createElement('main');
  content.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column';
  root.appendChild(content);

  let view: View = { kind: 'category' };

  const navigateBack = () => {
    if (view.kind === 'config') {
      const v = view;
      view = { kind: 'model', category: v.entry.category };
      render();
      if (v.returnTo === 'cart') openCartSheet();
    } else if (view.kind === 'model') {
      view = { kind: 'category' };
      render();
    }
  };

  const renderTopbar = () => {
    leftBox.innerHTML = '';

    // Слева — в зависимости от экрана
    if (view.kind === 'category') {
      const brand = document.createElement('div');
      brand.textContent = 'Конфигуратор';
      brand.style.cssText = 'font-weight:600;font-size:15px';
      leftBox.appendChild(brand);
    } else {
      const back = document.createElement('button');
      back.textContent = '←';
      back.style.cssText = 'background:none;border:none;font-size:22px;color:#3056d3;cursor:pointer;padding:4px 8px;flex:0 0 auto;min-height:40px;min-width:40px';
      back.onclick = navigateBack;
      leftBox.appendChild(back);

      const title = document.createElement('div');
      title.style.cssText = 'font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0';
      title.textContent = view.kind === 'model'
        ? CATEGORY_LABEL[view.category]
        : view.entry.model.name;
      leftBox.appendChild(title);
    }

    // Справа — корзина с бейджем
    const order = store.getOrder();
    const n = orderItemCount(order);
    cartBtn.innerHTML = '';
    cartBtn.appendChild(document.createTextNode('🛒'));
    const lbl = document.createElement('span');
    lbl.textContent = 'Корзина';
    lbl.className = 'cart-btn-label';
    cartBtn.appendChild(lbl);
    if (n > 0) {
      const badge = document.createElement('span');
      badge.style.cssText = 'background:#3056d3;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;font-weight:600;min-width:18px;text-align:center';
      badge.textContent = String(n);
      cartBtn.appendChild(badge);
      const total = document.createElement('span');
      total.style.cssText = 'color:#7b8392;font-size:12px;white-space:nowrap';
      total.className = 'cart-btn-total';
      total.textContent = fmtMoney(orderTotal(order));
      cartBtn.appendChild(total);
    }
  };

  const render = () => {
    content.innerHTML = '';
    content.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column';
    renderTopbar();

    if (view.kind === 'category') {
      renderCategory(content, c => { view = { kind: 'model', category: c }; render(); });
    } else if (view.kind === 'model') {
      const cat = view.category;
      renderModelList(content, cat,
        e  => { view = { kind: 'config', entry: e, returnTo: 'model' }; render(); },
        () => { view = { kind: 'category' }; render(); });
    } else if (view.kind === 'config') {
      const v = view;
      renderConfig(content, v.entry, v.editingItemId,
        // onBack — кнопка «назад»: уходим в список моделей
        () => {
          view = { kind: 'model', category: v.entry.category };
          render();
          if (v.returnTo === 'cart') openCartSheet();
        },
        // onSaved — после добавления/сохранения:
        //   • редактирование (пришли из корзины) → возврат + корзина
        //   • добавление → остаёмся в конфигураторе, открываем корзину
        () => {
          if (v.editingItemId) {
            view = { kind: 'model', category: v.entry.category };
            render();
          }
          openCartSheet();
        });
    }
  };

  // ── Шторка корзины — доступна из любого экрана ─────────────────────────
  const openCartSheet = () => {
    openSheet('Корзина', (body, close) => {
      renderCartContent(body, item => {
        close();
        const entry = findEntry(item.modelRef.category, item.modelRef.modelId);
        if (!entry) return;
        view = { kind: 'config', entry, editingItemId: item.id, returnTo: 'cart' };
        render();
      }, () => close());
    }, { wide: true });
  };

  store.subscribe(() => renderTopbar());
  render();
}

function findEntry(category: Category, modelId: string): CatalogEntry | null {
  return CATALOG.find(e => e.category === category && e.id === modelId) ?? null;
}

// ─── Шаг 1: категория ─────────────────────────────────────────────────────────

function renderCategory(root: HTMLElement, onPick: (c: Category) => void) {
  const wrap = mkDiv(root, css.center);
  mkHeader(wrap, 'Выберите тип изделия');

  const grid = mkDiv(wrap, css.cardGrid);
  for (const cat of ['facade', 'mirror', 'glass'] as Category[]) {
    const hasModels = categoryHasModels(cat);
    const card = mkDiv(grid, hasModels ? css.card : css.cardDisabled);
    card.innerHTML = `<div style="font-size:32px;margin-bottom:8px">${icon(cat)}</div>
                      <div style="font-weight:600;font-size:16px">${CATEGORY_LABEL[cat]}</div>
                      <div style="margin-top:6px;font-size:12px;color:#7b8392">
                        ${hasModels ? `${modelsByCategory(cat).length} моделей` : 'нет моделей'}
                      </div>`;
    if (hasModels) card.onclick = () => onPick(cat);
  }
}

function icon(c: Category): string {
  return c === 'facade' ? '🪟' : c === 'mirror' ? '🪞' : '🟦';
}

// ─── Шаг 2: список моделей ────────────────────────────────────────────────────

function renderModelList(
  root: HTMLElement, category: Category,
  onPick: (e: CatalogEntry) => void, _onBack: () => void,
) {
  const wrap = mkDiv(root, css.center);
  mkHeader(wrap, 'Выберите модель');

  const list = mkDiv(wrap, css.cardGrid);
  for (const entry of modelsByCategory(category)) {
    const card = mkDiv(list, css.card);
    card.innerHTML = `<div style="font-weight:600;font-size:15px">${escapeHtml(entry.model.name)}</div>
                      <div style="margin-top:6px;font-size:11px;color:#7b8392">id: ${entry.id}</div>`;
    card.onclick = () => onPick(entry);
  }
}

// ─── Шаг 3: конфигуратор ──────────────────────────────────────────────────────

function renderConfig(
  root: HTMLElement, entry: CatalogEntry, editingItemId: string | undefined,
  onBack: () => void, onSaved: () => void,
) {
  // ── Состояние ───────────────────────────────────────────────────────────
  const fs = new FacadeState();
  if (editingItemId) {
    const existing = store.getOrder().items.find(i => i.id === editingItemId);
    if (existing) applyConfig(fs, existing.config);
  }

  const commit = (qty = 1) => {
    const breakdown = calcPrice(entry.model, fs);
    if (breakdown.missing.length > 0) {
      if (!confirm(`Не найдено в каталоге: ${breakdown.missing.join(', ')}\nДобавить в заказ всё равно?`)) return;
    }
    const cfg = extractConfig(fs);
    if (editingItemId) {
      store.updateItem(editingItemId, it => ({
        ...it, config: cfg, priceSnapshot: breakdown, qty: Math.max(1, Math.round(qty)),
      }));
    } else {
      store.addItem({
        id: store.newId(),
        modelRef: { category: entry.category, modelId: entry.id },
        modelName: entry.model.name,
        config: cfg, priceSnapshot: breakdown, qty: Math.max(1, Math.round(qty)),
        addedAt: new Date().toISOString(),
      });
    }
    onSaved();
  };

  if (isMobileLayout()) {
    renderConfigMobile(root, entry, editingItemId, fs, onBack, commit);
  } else {
    renderConfigDesktop(root, entry, editingItemId, fs, onBack, commit);
  }
}

function isMobileLayout(): boolean {
  return window.matchMedia('(max-width: 768px)').matches;
}

// ─── Desktop layout (левая панель + canvas) ───────────────────────────────────

function renderConfigDesktop(
  root: HTMLElement, entry: CatalogEntry, editingItemId: string | undefined,
  fs: FacadeState, onBack: () => void, onCommit: (qty?: number) => void,
) {
  root.style.cssText = 'flex:1;display:flex;overflow:hidden';

  const panel = mkDiv(root, css.panel);
  mkBack(panel, editingItemId ? '← К корзине' : '← К моделям', onBack);
  const h = document.createElement('h2');
  h.textContent = entry.model.name;
  h.style.cssText = 'margin:0 0 6px;font-size:18px';
  panel.appendChild(h);
  const sub = document.createElement('div');
  sub.textContent = editingItemId ? 'Редактирование позиции' : CATEGORY_LABEL[entry.category];
  sub.style.cssText = 'font-size:12px;color:#7b8392;margin-bottom:18px';
  panel.appendChild(sub);

  const stage = mkDiv(root, css.stage);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;outline:none;touch-action:none';
  stage.appendChild(canvas);

  const { rebuild } = createScene(canvas, fs, entry.model);
  const update = () => { rebuild(); updatePrice(); };

  renderSizeSection(panel, fs, update);
  renderProfileSection(panel, fs, update);
  renderGlassSection(panel, fs, update);
  if (entry.model.drilling && entry.model.hinges) {
    renderHingesSection(panel, fs, entry.model.hinges, update);
  }

  const priceBox = document.createElement('div');
  priceBox.style.cssText = 'margin-top:auto;padding-top:18px;border-top:1px solid #e1e3e8';
  panel.appendChild(priceBox);
  const updatePrice = () => renderPrice(priceBox, entry.model, fs);

  const actionBtn = document.createElement('button');
  actionBtn.textContent = editingItemId ? 'Сохранить изменения' : '+ В заказ';
  actionBtn.style.cssText = 'margin-top:12px;width:100%;padding:12px;background:#3056d3;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500';
  actionBtn.onclick = () => onCommit();
  panel.appendChild(actionBtn);

  update();
}

// ─── Mobile layout: 3D на весь экран + 3 чипа снизу ───────────────────────────

function renderConfigMobile(
  root: HTMLElement, entry: CatalogEntry, editingItemId: string | undefined,
  fs: FacadeState, _onBack: () => void, onCommit: (qty?: number) => void,
) {
  root.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative';

  // ── 3D — на весь оставшийся экран ──────────────────────────────────────
  const stage = document.createElement('div');
  stage.style.cssText = 'flex:1;position:relative;background:#eef0f3;min-height:0';
  root.appendChild(stage);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;outline:none;touch-action:none';
  stage.appendChild(canvas);

  const { rebuild } = createScene(canvas, fs, entry.model);
  const update = () => { rebuild(); };

  // ── Карусель чипов ──────────────────────────────────────────────────────
  const chipBar = document.createElement('div');
  chipBar.className = 'chip-bar';
  root.appendChild(chipBar);

  // 1. Свойства — размеры + профиль + стекло
  addChip(chipBar, '⚙️', 'Свойства', () => {
    openSheet('Свойства', body => {
      renderSizeSection(body, fs, update);
      renderProfileSection(body, fs, update);
      renderGlassSection(body, fs, update);
    });
  });

  // 2. Присадка — секция петель (только если модель поддерживает)
  if (entry.model.drilling && entry.model.hinges) {
    const spec = entry.model.hinges;
    addChip(chipBar, '🔧', 'Присадка', () => {
      openSheet('Присадка', body => renderHingesSection(body, fs, spec, update));
    });
  }

  // 3. В заказ — qty + добавить
  addChip(chipBar, '🛒', editingItemId ? 'Сохранить' : 'В заказ', () => {
    openSheet(editingItemId ? 'Сохранить изменения' : 'Добавить в заказ', (body, close) => {
      renderAddToCartSheet(body, entry, fs, editingItemId, qty => { close(); onCommit(qty); });
    });
  }, true);

  update();
}

function addChip(bar: HTMLElement, icon: string, label: string, onClick: () => void, primary = false) {
  const chip = document.createElement('button');
  chip.className = primary ? 'chip chip--primary' : 'chip';
  chip.innerHTML = `<span style="font-size:15px">${icon}</span> <span>${label}</span>`;
  chip.onclick = onClick;
  bar.appendChild(chip);
}

// ── Содержимое шторки "В заказ": цена + qty + кнопка ──────────────────────────
function renderAddToCartSheet(
  body: HTMLElement, entry: CatalogEntry, fs: FacadeState,
  editingItemId: string | undefined, onCommit: (qty: number) => void,
) {
  // Цена за шт + детализация
  renderPrice(body, entry.model, fs);

  // Количество (текущее, если редактируем)
  let qty = 1;
  if (editingItemId) {
    const existing = store.getOrder().items.find(i => i.id === editingItemId);
    if (existing) qty = existing.qty;
  }

  const qtyLbl = document.createElement('label');
  qtyLbl.textContent = 'Количество, шт';
  qtyLbl.style.cssText = 'display:block;margin-top:16px;font-size:12px;color:#5a6270';
  body.appendChild(qtyLbl);

  const qtyRow = document.createElement('div');
  qtyRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:6px';
  body.appendChild(qtyRow);

  const minus = mkQtyBtn('−');
  const plus  = mkQtyBtn('+');
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = '1';
  inp.value = String(qty);
  inp.style.cssText = 'flex:1;padding:9px 10px;text-align:center;border:1px solid #cdd0d4;border-radius:6px;font-size:16px;font-weight:600';
  inp.oninput = () => { const v = parseInt(inp.value, 10); if (!isNaN(v) && v > 0) qty = v; };
  inp.onblur  = () => { if (isNaN(parseInt(inp.value, 10)) || qty < 1) { qty = 1; inp.value = '1'; } };
  minus.onclick = () => { qty = Math.max(1, qty - 1); inp.value = String(qty); };
  plus.onclick  = () => { qty = qty + 1; inp.value = String(qty); };
  qtyRow.append(minus, inp, plus);

  const btn = document.createElement('button');
  btn.textContent = editingItemId ? 'Сохранить изменения' : '+ Добавить в корзину';
  btn.style.cssText = 'margin-top:18px;width:100%;padding:14px;background:#3056d3;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600';
  btn.onclick = () => onCommit(qty);
  body.appendChild(btn);
}

// ─── Bottom-sheet (шторка): drag-to-dismiss, тап-overlay-закрытие ─────────────

function openSheet(
  title: string,
  render: (body: HTMLElement, close: () => void) => void,
  opts?: { wide?: boolean },
): { close: () => void } {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'sheet' + (opts?.wide ? ' sheet--wide' : '');

  const handle = document.createElement('div');
  handle.className = 'sheet-handle';
  handle.innerHTML = '<span class="sheet-grip"></span>';

  const header = document.createElement('div');
  header.className = 'sheet-header';
  header.textContent = title;

  const body = document.createElement('div');
  body.className = 'sheet-body';

  sheet.append(handle, header, body);
  document.body.append(overlay, sheet);

  const close = () => {
    overlay.classList.remove('sheet-overlay--open');
    sheet.classList.remove('sheet--open');
    sheet.style.transform = '';
    setTimeout(() => { overlay.remove(); sheet.remove(); }, 250);
  };

  render(body, close);

  // Анимация открытия
  requestAnimationFrame(() => {
    overlay.classList.add('sheet-overlay--open');
    sheet.classList.add('sheet--open');
  });

  overlay.onclick = close;

  // Свайп вниз — закрыть. На десктопной wide-шторке drag отключён (там клик по фону).
  const isDesktopWide = () => !!opts?.wide && window.matchMedia('(min-width: 768px)').matches;
  let startY = 0, dy = 0, dragging = false;
  const onDown = (e: PointerEvent) => {
    if (isDesktopWide()) return;
    dragging = true;
    startY = e.clientY;
    sheet.style.transition = 'none';
    handle.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    if (dy > 80) close();
    else sheet.style.transform = '';
  };
  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup',   onUp);
  handle.addEventListener('pointercancel', onUp);

  return { close };
}

// ─── Секции-конструкторы (используются и десктопом, и мобильным) ──────────────

function renderSizeSection(panel: HTMLElement, fs: FacadeState, update: () => void) {
  field(panel, 'Ширина, мм', fs.width,  v => { fs.width  = v; update(); }, { min: 100, max: 2250 });
  field(panel, 'Высота, мм', fs.height, v => { fs.height = v; update(); }, { min: 100, max: 3210 });
}

function renderProfileSection(panel: HTMLElement, fs: FacadeState, update: () => void) {
  select<ProfileColor>(panel, 'Цвет профиля',
    Object.entries(PROFILE_COLORS).map(([k, v]) => ({ value: k as ProfileColor, label: v.name })),
    fs.profileColor, v => { fs.profileColor = v; update(); });
}

function renderGlassSection(panel: HTMLElement, fs: FacadeState, update: () => void) {
  select<GlassColor>(panel, 'Цвет стекла',
    Object.entries(GLASS_COLORS).map(([k, v]) => ({ value: k as GlassColor, label: v.name })),
    fs.glassColor, v => { fs.glassColor = v; update(); });
  select<GlassType>(panel, 'Тип стекла',
    Object.entries(GLASS_TYPES).map(([k, v]) => ({ value: k as GlassType, label: v.name })),
    fs.glassType, v => { fs.glassType = v; update(); });
  checkbox(panel, 'Закалённое стекло', fs.tempered, v => { fs.tempered = v; update(); });
}

// ─── Корзина (содержимое для шторки) ──────────────────────────────────────────

function renderCartContent(
  body: HTMLElement,
  onEdit: (item: OrderItem) => void,
  onContinueShopping: () => void,
) {
  const refresh = () => {
    body.innerHTML = '';
    fillCart(body, onEdit, onContinueShopping, refresh);
  };
  refresh();
  // Подписка на изменения корзины (на случай если qty меняется в другом окне)
  const unsub = store.subscribe(refresh);
  // Снимаем подписку когда body удалят из DOM
  const observer = new MutationObserver(() => {
    if (!body.isConnected) { unsub(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function fillCart(
  body: HTMLElement,
  onEdit: (item: OrderItem) => void,
  onContinueShopping: () => void,
  rerender: () => void,
) {
  const order = store.getOrder();

  if (order.items.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:30px 20px;text-align:center;color:#7b8392';
    empty.innerHTML = `<div style="font-size:48px;margin-bottom:10px">🛒</div>
                       <div style="font-size:14px;margin-bottom:18px">В корзине пусто</div>`;
    const btn = document.createElement('button');
    btn.textContent = 'Перейти к выбору';
    btn.style.cssText = 'padding:10px 20px;background:#3056d3;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px';
    btn.onclick = onContinueShopping;
    empty.appendChild(btn);
    body.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:10px;width:100%';
  body.appendChild(list);

  for (const item of order.items) {
    const row = document.createElement('div');
    row.className = 'cart-row';
    row.style.cssText = 'background:#fff;border:1px solid #e1e3e8;border-radius:8px;padding:14px 16px;display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center';
    list.appendChild(row);

    // ── Описание (клик → редактирование) ──────────────────────────────
    const info = document.createElement('div');
    info.style.cssText = 'cursor:pointer;min-width:0';
    info.onclick = () => onEdit(item);
    info.innerHTML = `
      <div style="font-weight:600;font-size:14px">${escapeHtml(item.modelName)}</div>
      <div style="font-size:12px;color:#5a6270;margin-top:4px">${configSummary(item.config)}</div>
      <div style="font-size:11px;color:#7b8392;margin-top:3px">за шт: ${fmtMoney(item.priceSnapshot.total)}</div>
    `;
    row.appendChild(info);

    // ── Количество ────────────────────────────────────────────────────
    const qtyBox = document.createElement('div');
    qtyBox.style.cssText = 'display:flex;align-items:center;gap:4px';
    const minus = mkQtyBtn('−');
    const plus  = mkQtyBtn('+');
    const qtyInp = document.createElement('input');
    qtyInp.type = 'number'; qtyInp.min = '1'; qtyInp.value = String(item.qty);
    qtyInp.style.cssText = 'width:48px;padding:5px 6px;text-align:center;border:1px solid #cdd0d4;border-radius:4px;font-size:13px';
    qtyInp.onchange = () => store.setQty(item.id, parseInt(qtyInp.value, 10) || 1);
    minus.onclick = () => { store.setQty(item.id, item.qty - 1); rerender(); };
    plus.onclick  = () => { store.setQty(item.id, item.qty + 1); rerender(); };
    qtyBox.append(minus, qtyInp, plus);
    row.appendChild(qtyBox);

    // ── Сумма + удалить ───────────────────────────────────────────────
    const right = document.createElement('div');
    right.className = 'cart-right';
    right.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:120px';
    const sumDiv = document.createElement('div');
    sumDiv.style.cssText = 'font-weight:600;font-size:15px;font-variant-numeric:tabular-nums';
    sumDiv.textContent = fmtMoney(item.priceSnapshot.total * item.qty);
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕ Удалить';
    delBtn.style.cssText = 'background:none;border:none;color:#d04545;cursor:pointer;font-size:11px;padding:0';
    delBtn.onclick = () => { store.removeItem(item.id); rerender(); };
    right.append(sumDiv, delBtn);
    row.appendChild(right);
  }

  // ── Итого + действия ───────────────────────────────────────────────────
  const footer = document.createElement('div');
  footer.className = 'cart-footer';
  footer.style.cssText = 'margin-top:20px;width:100%;background:#f9fafb;border:1px solid #e1e3e8;border-radius:8px;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap';
  body.appendChild(footer);

  const totalLbl = document.createElement('div');
  totalLbl.innerHTML = `<div style="font-size:12px;color:#7b8392">Итого по заказу</div>
                        <div style="font-size:22px;font-weight:600;margin-top:2px">${fmtMoney(orderTotal(order))}</div>`;
  footer.appendChild(totalLbl);

  const btnBox = document.createElement('div');
  btnBox.className = 'cart-footer-btns';
  btnBox.style.cssText = 'display:flex;gap:8px';
  footer.appendChild(btnBox);

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Очистить';
  clearBtn.style.cssText = 'padding:10px 14px;background:#fff;color:#d04545;border:1px solid #d04545;border-radius:6px;cursor:pointer;font-size:13px';
  clearBtn.onclick = () => {
    if (confirm('Удалить все позиции из корзины?')) { store.clearOrder(); rerender(); }
  };
  btnBox.appendChild(clearBtn);

  const checkoutBtn = document.createElement('button');
  checkoutBtn.textContent = 'Оформить заказ';
  checkoutBtn.style.cssText = 'padding:10px 18px;background:#22a06b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500';
  checkoutBtn.onclick = () => {
    alert('Оформление заказа: пока заглушка (позже — отправка на сервер)');
  };
  btnBox.appendChild(checkoutBtn);
}

function configSummary(c: FacadeConfig): string {
  const parts = [
    `${c.width}×${c.height}мм`,
    PROFILE_COLORS[c.profileColor]?.name,
    GLASS_COLORS[c.glassColor]?.name,
    GLASS_TYPES[c.glassType]?.name,
  ];
  if (c.tempered) parts.push('закалка');
  if (c.hingeMode !== 'none' && c.hingePositions.length > 0) {
    const sideRu = { left:'лево', right:'право', top:'верх', bottom:'низ' }[c.hingeSide];
    parts.push(`${c.hingeMode === 'holes' ? 'присадка' : 'петли'} ${sideRu}×${c.hingePositions.length}`);
  }
  return parts.filter(Boolean).join(' · ');
}

function mkQtyBtn(text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = 'width:28px;height:28px;background:#f4f5f7;border:1px solid #cdd0d4;border-radius:4px;cursor:pointer;font-size:14px;font-weight:600;color:#5a6270';
  return b;
}

// ─── State ↔ Config (сериализация) ────────────────────────────────────────────

function extractConfig(fs: FacadeState): FacadeConfig {
  return {
    width: fs.width, height: fs.height,
    profileColor: fs.profileColor, glassColor: fs.glassColor, glassType: fs.glassType,
    tempered: fs.tempered,
    hingeMode: fs.hingeMode, hingeSide: fs.hingeSide,
    hingePositions: [...fs.hingePositions],
  };
}

function applyConfig(fs: FacadeState, c: FacadeConfig) {
  fs.width = c.width; fs.height = c.height;
  fs.profileColor = c.profileColor; fs.glassColor = c.glassColor; fs.glassType = c.glassType;
  fs.tempered = c.tempered;
  fs.hingeMode = c.hingeMode; fs.hingeSide = c.hingeSide;
  fs.hingePositions = [...c.hingePositions];
}

// ─── Блок цены ────────────────────────────────────────────────────────────────

function renderPrice(box: HTMLElement, model: FacadeModel, fs: FacadeState) {
  box.innerHTML = '';
  if (!model.pricing) {
    const stub = document.createElement('div');
    stub.style.cssText = 'font-size:12px;color:#7b8392';
    stub.textContent = 'Цена не настроена в модели';
    box.appendChild(stub);
    return;
  }

  const breakdown = calcPrice(model, fs);

  const totalRow = document.createElement('div');
  totalRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px';
  const label = document.createElement('div');
  label.textContent = 'Цена за шт';
  label.style.cssText = 'font-size:13px;color:#5a6270';
  const value = document.createElement('div');
  value.textContent = fmtMoney(breakdown.total);
  value.style.cssText = 'font-size:22px;font-weight:600';
  totalRow.append(label, value);
  box.appendChild(totalRow);

  if (breakdown.missing.length > 0) {
    const warn = document.createElement('div');
    warn.style.cssText = 'padding:6px 8px;background:#fff4d6;border:1px solid #f0c060;border-radius:4px;font-size:11px;color:#7a5300;margin-bottom:8px';
    warn.textContent = 'Нет в каталоге: ' + breakdown.missing.join(', ');
    box.appendChild(warn);
  }

  const details = document.createElement('details');
  details.style.cssText = 'font-size:12px;color:#3a4258';
  const summary = document.createElement('summary');
  summary.textContent = 'Детализация';
  summary.style.cssText = 'cursor:pointer;user-select:none;color:#3056d3;padding:2px 0';
  details.appendChild(summary);

  const table = document.createElement('div');
  table.style.cssText = 'margin-top:8px;display:grid;grid-template-columns:1fr auto;gap:4px 12px;font-variant-numeric:tabular-nums';
  for (const item of breakdown.items) {
    const l = document.createElement('div');
    l.textContent = `${item.label} — ${item.qty} ${item.unit} × ${fmtMoney(item.unitPrice)}`;
    if (!item.resolved) l.style.color = '#d04545';
    const r = document.createElement('div');
    r.textContent = fmtMoney(item.total);
    r.style.textAlign = 'right';
    if (!item.resolved) r.style.color = '#d04545';
    table.append(l, r);
  }
  if (breakdown.temperedSurcharge > 0) {
    const l = document.createElement('div');
    l.textContent = 'Закалка стекла';
    const r = document.createElement('div');
    r.textContent = fmtMoney(breakdown.temperedSurcharge);
    r.style.textAlign = 'right';
    table.append(l, r);
  }
  details.appendChild(table);
  box.appendChild(details);
}

function fmtMoney(n: number): string {
  return n.toLocaleString('ru-KZ') + ' ₸';
}

// ─── Секция «Петли» ───────────────────────────────────────────────────────────

function renderHingesSection(
  panel: HTMLElement, fs: FacadeState, spec: HingesSpec, rebuild: () => void,
) {
  const h = document.createElement('h3');
  h.textContent = 'Петли';
  h.style.cssText = 'margin:22px 0 8px;font-size:14px;font-weight:600;color:#1a1a1a';
  panel.appendChild(h);

  const details = document.createElement('div');
  panel.appendChild(details);

  const refresh = () => {
    details.innerHTML = '';

    select<HingeMode>(details, 'Режим', [
      { value: 'none',         label: 'Без петель'       },
      { value: 'holes',        label: 'Только присадка'  },
      { value: 'holes+hinges', label: 'Присадка + петли' },
    ], fs.hingeMode, v => {
      fs.hingeMode = v;
      if (v !== 'none' && fs.hingePositions.length === 0) {
        fs.hingePositions = autoHingePositions(spec, sideLength(fs));
      }
      refresh();
      rebuild();
    });

    if (fs.hingeMode === 'none') return;

    select<HingeSide>(details, 'Сторона', [
      { value: 'left',   label: 'Левая'  },
      { value: 'right',  label: 'Правая' },
      { value: 'top',    label: 'Верх'   },
      { value: 'bottom', label: 'Низ'    },
    ], fs.hingeSide, v => {
      fs.hingeSide = v;
      fs.hingePositions = autoHingePositions(spec, sideLength(fs));
      refresh();
      rebuild();
    });

    const listLbl = document.createElement('label');
    listLbl.textContent = `Позиции центров, мм от начала стороны (${fs.hingePositions.length})`;
    listLbl.style.cssText = 'display:block;margin-top:10px;font-size:12px;color:#5a6270';
    details.appendChild(listLbl);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:4px';
    details.appendChild(list);

    const maxPos = sideLength(fs);
    fs.hingePositions.forEach((pos, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center';
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = '0'; inp.max = String(maxPos);
      inp.value = String(pos);
      inp.style.cssText = css.input + ';margin-top:0;flex:1';
      inp.onchange = () => {
        let v = parseFloat(inp.value);
        if (isNaN(v)) v = pos;
        v = Math.max(0, Math.min(maxPos, Math.round(v)));
        fs.hingePositions[idx] = v;
        inp.value = String(v);
        rebuild();
      };
      const del = document.createElement('button');
      del.textContent = '✕'; del.title = 'Удалить';
      del.style.cssText = 'padding:4px 9px;background:#e9eaee;color:#5a6270;border:none;border-radius:4px;cursor:pointer;font-size:12px';
      del.onclick = () => { fs.hingePositions.splice(idx, 1); refresh(); rebuild(); };
      row.append(inp, del);
      list.appendChild(row);
    });

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px';

    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Добавить';
    addBtn.style.cssText = 'padding:6px;background:#e5e7eb;color:#222;border:none;border-radius:4px;cursor:pointer;font-size:12px';
    addBtn.onclick = () => {
      fs.hingePositions.push(Math.round(maxPos / 2));
      fs.hingePositions.sort((a, b) => a - b);
      refresh(); rebuild();
    };

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Сбросить';
    resetBtn.title = 'Пересчитать из правил модели';
    resetBtn.style.cssText = 'padding:6px;background:#e5e7eb;color:#222;border:none;border-radius:4px;cursor:pointer;font-size:12px';
    resetBtn.onclick = () => {
      fs.hingePositions = autoHingePositions(spec, maxPos);
      refresh(); rebuild();
    };

    btnRow.append(addBtn, resetBtn);
    details.appendChild(btnRow);
  };

  refresh();
}

// ─── Хелперы UI ────────────────────────────────────────────────────────────────

function mkDiv(parent: HTMLElement, style: string): HTMLDivElement {
  const d = document.createElement('div');
  d.style.cssText = style;
  parent.appendChild(d);
  return d;
}

function mkHeader(parent: HTMLElement, text: string) {
  const h = document.createElement('h1');
  h.textContent = text;
  h.style.cssText = 'margin:0 0 24px;font-size:24px;font-weight:600';
  parent.appendChild(h);
}

function mkBack(parent: HTMLElement, text: string, onClick: () => void) {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = 'background:none;border:none;color:#3056d3;cursor:pointer;font-size:13px;padding:0;margin-bottom:14px;align-self:flex-start';
  b.onclick = onClick;
  parent.appendChild(b);
}

function field(
  parent: HTMLElement, label: string, init: number, on: (v: number) => void,
  limits?: { min?: number; max?: number },
) {
  const lbl = document.createElement('label');
  lbl.textContent = limits?.max
    ? `${label} (${limits.min ?? 1}–${limits.max})`
    : label;
  lbl.style.cssText = 'display:block;margin-top:10px;font-size:12px;color:#5a6270';
  parent.appendChild(lbl);
  const i = document.createElement('input');
  i.type = 'number'; i.value = String(init);
  if (limits?.min !== undefined) i.min = String(limits.min);
  if (limits?.max !== undefined) i.max = String(limits.max);
  i.style.cssText = css.input;
  i.oninput = () => {
    const v = parseFloat(i.value);
    if (isNaN(v) || v <= 0) return;
    if (limits?.min !== undefined && v < limits.min) return;
    if (limits?.max !== undefined && v > limits.max) return;
    on(v);
  };
  i.onblur = () => {
    let v = parseFloat(i.value);
    if (isNaN(v) || v <= 0) v = init;
    if (limits?.min !== undefined && v < limits.min) v = limits.min;
    if (limits?.max !== undefined && v > limits.max) v = limits.max;
    i.value = String(v);
    on(v);
  };
  parent.appendChild(i);
}

function select<T extends string>(
  parent: HTMLElement, label: string,
  options: { value: T; label: string }[],
  init: T, on: (v: T) => void,
) {
  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style.cssText = 'display:block;margin-top:10px;font-size:12px;color:#5a6270';
  parent.appendChild(lbl);
  const s = document.createElement('select');
  s.style.cssText = css.input;
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    if (o.value === init) opt.selected = true;
    s.appendChild(opt);
  }
  s.onchange = () => on(s.value as T);
  parent.appendChild(s);
}

function checkbox(parent: HTMLElement, label: string, init: boolean, on: (v: boolean) => void) {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;cursor:pointer';
  const c = document.createElement('input');
  c.type = 'checkbox'; c.checked = init;
  c.onchange = () => on(c.checked);
  wrap.append(c, document.createTextNode(label));
  parent.appendChild(wrap);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]!));
}

const css = {
  center: 'display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:40px 20px;max-width:900px;margin:0 auto;width:100%;overflow-y:auto',
  cardGrid: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;width:100%',
  card: 'background:#fff;border:1px solid #e1e3e8;border-radius:8px;padding:24px;text-align:center;cursor:pointer;transition:all .15s;user-select:none',
  cardDisabled: 'background:#f0f1f3;border:1px solid #e1e3e8;border-radius:8px;padding:24px;text-align:center;opacity:.5;user-select:none',
  panel: 'flex:0 0 320px;background:#fff;border-right:1px solid #e1e3e8;padding:20px;display:flex;flex-direction:column;overflow-y:auto',
  stage: 'flex:1;position:relative;background:#eef0f3',
  input: 'width:100%;padding:7px 9px;margin-top:4px;box-sizing:border-box;background:#fff;border:1px solid #cdd0d4;color:#222;border-radius:4px;font-size:13px',
};

// ─── Адаптив под мобильный ────────────────────────────────────────────────────

function injectResponsiveStyles() {
  if (document.getElementById('cfg-responsive-styles')) return;
  const style = document.createElement('style');
  style.id = 'cfg-responsive-styles';
  style.textContent = `
    /* Минимальный целевой размер контролов для пальца */
    @media (hover: none) and (pointer: coarse) {
      input, select, button { min-height: 40px !important; }
    }

    /* Шапка компактнее на мобильном */
    @media (max-width: 560px) {
      .app-topbar { padding: 8px 12px !important; }
    }

    /* ── Карусель чипов внизу ───────────────────────────────────────── */
    .chip-bar {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
      background: #fff;
      border-top: 1px solid #e1e3e8;
      flex: 0 0 auto;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .chip-bar::-webkit-scrollbar { display: none; }
    .chip {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: #f4f5f7;
      border: 1px solid #e1e3e8;
      border-radius: 22px;
      font-size: 13px;
      font-weight: 500;
      color: #1a1a1a;
      cursor: pointer;
      white-space: nowrap;
      min-height: 40px;
    }
    .chip:active { background: #e5e7eb; }
    .chip--primary {
      background: #3056d3;
      color: #fff;
      border-color: #3056d3;
    }
    .chip--primary:active { background: #2a4ab8; }

    /* ── Bottom-sheet ────────────────────────────────────────────────── */
    .sheet-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0);
      z-index: 100;
      transition: background .25s ease;
    }
    .sheet-overlay--open { background: rgba(0,0,0,.45); }

    .sheet {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      max-height: 85vh;
      background: #fff;
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -8px 24px rgba(0,0,0,.18);
      z-index: 101;
      display: flex;
      flex-direction: column;
      transform: translateY(100%);
      transition: transform .25s ease;
      padding-bottom: env(safe-area-inset-bottom);
    }
    .sheet--open { transform: translateY(0); }

    /* Широкая шторка (корзина) — на десктопе центрируется и ограничивается шириной */
    @media (min-width: 768px) {
      .sheet--wide {
        left: 50%;
        right: auto;
        transform: translate(-50%, 100%);
        width: 720px;
        max-width: calc(100% - 40px);
        border-radius: 16px;
        max-height: 80vh;
        bottom: 20px;
      }
      .sheet--wide.sheet--open { transform: translate(-50%, 0); }
    }

    .sheet-handle {
      flex: 0 0 auto;
      padding: 10px 0 6px;
      display: flex;
      justify-content: center;
      cursor: grab;
      touch-action: none;
    }
    .sheet-grip {
      width: 44px;
      height: 4px;
      background: #cdd0d4;
      border-radius: 2px;
    }
    .sheet-header {
      flex: 0 0 auto;
      padding: 0 20px 12px;
      font-size: 16px;
      font-weight: 600;
      color: #1a1a1a;
      border-bottom: 1px solid #f0f1f3;
    }
    .sheet-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 14px 20px 20px;
      -webkit-overflow-scrolling: touch;
    }

    /* Узкие экраны для корзины — позиции вертикально */
    @media (max-width: 560px) {
      .cart-row {
        grid-template-columns: 1fr !important;
        gap: 10px !important;
      }
      .cart-row .cart-right {
        align-items: flex-start !important;
        flex-direction: row !important;
        justify-content: space-between;
        width: 100%;
      }
      .cart-footer {
        flex-direction: column !important;
        align-items: stretch !important;
      }
      .cart-footer-btns { width: 100%; }
      .cart-footer-btns button { flex: 1; }
    }
  `;
  document.head.appendChild(style);
}
