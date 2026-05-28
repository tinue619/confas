// iOS-стиль карусель для дискретных категорий. Лента наименований,
// центральный элемент = выбранный. Драг/инерция, snap по элементу.

export interface CarouselItem<T> {
  value: T;
  label: string;
  /** Опциональный hex-цвет для свотча слева от названия */
  swatch?: string;
}

export interface CarouselOpts<T> {
  parent: HTMLElement;
  name: string;            // "Цвет профиля"
  items: CarouselItem<T>[];
  value: T;
  onChange: (v: T) => void;
}

const ITEM_WIDTH = 110; // px — ширина каждого айтема (приблизительно — реально пересчитается)

export class Carousel<T> {
  private track: HTMLDivElement;
  private tape:  HTMLDivElement;
  private readoutEl: HTMLElement;
  private items: CarouselItem<T>[];
  private onChange: (v: T) => void;
  private value: T;
  private positions: number[] = [];  // координата центра каждого item в ленте
  private isDragging = false;
  private startX = 0;
  private startOffset = 0;
  private velocity = 0;
  private lastX = 0;
  private lastTime = 0;
  private momentumId: number | null = null;
  private offset = 0;     // текущий translateX ленты

  constructor(o: CarouselOpts<T>) {
    this.items = o.items;
    this.value = o.value;
    this.onChange = o.onChange;

    const block = document.createElement('div');
    block.className = 'carousel-block';
    block.innerHTML = `
      <div class="carousel-header">
        <div class="carousel-name"></div>
        <div class="carousel-readout"></div>
      </div>
      <div class="carousel-track">
        <div class="carousel-tape"></div>
        <div class="carousel-center"></div>
      </div>`;
    (block.querySelector('.carousel-name') as HTMLElement).textContent = o.name;
    o.parent.appendChild(block);

    this.track     = block.querySelector('.carousel-track') as HTMLDivElement;
    this.tape      = block.querySelector('.carousel-tape')  as HTMLDivElement;
    this.readoutEl = block.querySelector('.carousel-readout') as HTMLElement;

    this.buildItems();
    // После того как DOM в дереве — измеряем позиции
    requestAnimationFrame(() => {
      this.measure();
      this.snapTo(this.indexOf(this.value), false);
    });
    this.bindEvents();
  }

  private indexOf(v: T): number {
    const i = this.items.findIndex(it => it.value === v);
    return i < 0 ? 0 : i;
  }

  private buildItems() {
    const frag = document.createDocumentFragment();
    for (const item of this.items) {
      const el = document.createElement('div');
      el.className = 'carousel-item';
      if (item.swatch) {
        const sw = document.createElement('span');
        sw.className = 'carousel-swatch';
        sw.style.background = item.swatch;
        el.appendChild(sw);
      }
      const t = document.createElement('span');
      t.textContent = item.label;
      el.appendChild(t);
      frag.appendChild(el);
    }
    this.tape.appendChild(frag);
  }

  private measure() {
    const itemsEls = Array.from(this.tape.children) as HTMLElement[];
    this.positions = itemsEls.map(el => el.offsetLeft + el.offsetWidth / 2);
  }

  setValue(v: T) {
    this.value = v;
    if (this.positions.length) this.snapTo(this.indexOf(v), false);
  }

  getValue(): T { return this.value; }

  private snapTo(index: number, doCallback = true) {
    const i = Math.max(0, Math.min(this.items.length - 1, index));
    const targetOffset = -this.positions[i];
    this.offset = targetOffset;
    this.tape.style.transform = `translateX(${this.offset}px)`;
    this.highlightItem(i);
    const newValue = this.items[i].value;
    const changed = newValue !== this.value;
    this.value = newValue;
    this.readoutEl.textContent = this.items[i].label;
    if (changed && doCallback) {
      this.onChange(newValue);
      if ((navigator as any).vibrate) (navigator as any).vibrate(1);
    }
  }

  private highlightItem(activeIndex: number) {
    const els = Array.from(this.tape.children) as HTMLElement[];
    els.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
  }

  private nearestIndex(offset: number): number {
    // offset — отрицательное значение, ищем позицию ближайшую к |offset|
    const target = -offset;
    let bestI = 0, bestDist = Infinity;
    for (let i = 0; i < this.positions.length; i++) {
      const d = Math.abs(this.positions[i] - target);
      if (d < bestDist) { bestDist = d; bestI = i; }
    }
    return bestI;
  }

  private bindEvents() {
    this.track.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup',   this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    this.track.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onDown = (e: PointerEvent) => {
    this.track.setPointerCapture(e.pointerId);
    this.isDragging = true;
    this.startX = e.clientX;
    this.startOffset = this.offset;
    this.lastX = e.clientX; this.lastTime = performance.now();
    this.velocity = 0;
    if (this.momentumId !== null) cancelAnimationFrame(this.momentumId);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.isDragging) return;
    e.preventDefault();
    const dx = e.clientX - this.startX;
    this.offset = this.startOffset + dx;
    this.tape.style.transform = `translateX(${this.offset}px)`;
    // Подсвечиваем ближайший центр (без onChange — только визуал)
    this.highlightItem(this.nearestIndex(this.offset));
    const now = performance.now(); const dt = now - this.lastTime;
    if (dt > 0) this.velocity = (e.clientX - this.lastX) / dt;
    this.lastX = e.clientX; this.lastTime = now;
  };

  private onUp = () => {
    if (!this.isDragging) return;
    this.isDragging = false;
    // Если есть скорость — даём инерцию + snap. Иначе сразу snap.
    if (Math.abs(this.velocity) > 0.05) this.startMomentum();
    else this.snapTo(this.nearestIndex(this.offset));
  };

  private startMomentum() {
    let v = this.velocity;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last; last = now;
      this.offset += v * dt;
      this.tape.style.transform = `translateX(${this.offset}px)`;
      this.highlightItem(this.nearestIndex(this.offset));
      v *= Math.pow(0.94, dt / 16);
      if (Math.abs(v) < 0.02) { this.snapTo(this.nearestIndex(this.offset)); return; }
      this.momentumId = requestAnimationFrame(tick);
    };
    this.momentumId = requestAnimationFrame(tick);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const d = e.deltaY || e.deltaX;
    const step = Math.sign(d);
    this.snapTo(this.indexOf(this.value) + step);
  };
}

// Suppress unused-warning
void ITEM_WIDTH;
