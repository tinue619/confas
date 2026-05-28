// Горизонтальный список с выбором тапом. При нехватке места — нативный скролл.
// Активный элемент: акцентный цвет + подчёркивание. Авто-скролл к выбранному.

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

export class Carousel<T> {
  private track: HTMLDivElement;
  private items: CarouselItem<T>[];
  private onChange: (v: T) => void;
  private value: T;
  private buttons: HTMLButtonElement[] = [];

  constructor(o: CarouselOpts<T>) {
    this.items = o.items;
    this.value = o.value;
    this.onChange = o.onChange;

    const block = document.createElement('div');
    block.className = 'carousel-block';
    block.innerHTML = `
      <div class="carousel-header">
        <div class="carousel-name"></div>
      </div>
      <div class="carousel-track"></div>`;
    (block.querySelector('.carousel-name') as HTMLElement).textContent = o.name;
    this.track = block.querySelector('.carousel-track') as HTMLDivElement;
    o.parent.appendChild(block);

    this.buildItems();
    requestAnimationFrame(() => this.scrollActiveIntoView(false));
  }

  private buildItems() {
    const frag = document.createDocumentFragment();
    this.items.forEach((item, i) => {
      const b = document.createElement('button');
      b.className = 'carousel-item';
      if (item.value === this.value) b.classList.add('active');
      b.type = 'button';
      b.dataset.idx = String(i);
      if (item.swatch) {
        const sw = document.createElement('span');
        sw.className = 'carousel-swatch';
        sw.style.background = item.swatch;
        b.appendChild(sw);
      }
      const t = document.createElement('span');
      t.textContent = item.label;
      b.appendChild(t);
      b.addEventListener('click', () => this.select(i));
      this.buttons.push(b);
      frag.appendChild(b);
    });
    this.track.appendChild(frag);
  }

  private select(i: number) {
    const item = this.items[i];
    const changed = item.value !== this.value;
    this.value = item.value;
    this.buttons.forEach((b, j) => b.classList.toggle('active', i === j));
    this.scrollActiveIntoView(true);
    if (changed) {
      this.onChange(item.value);
      if ((navigator as any).vibrate) (navigator as any).vibrate(1);
    }
  }

  private scrollActiveIntoView(smooth: boolean) {
    const i = this.items.findIndex(it => it.value === this.value);
    if (i < 0) return;
    const btn = this.buttons[i];
    if (!btn) return;
    const trackRect = this.track.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const center = btnRect.left + btnRect.width / 2 - trackRect.left;
    const target = this.track.scrollLeft + center - trackRect.width / 2;
    this.track.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
  }

  setValue(v: T) {
    const i = this.items.findIndex(it => it.value === v);
    if (i >= 0) this.select(i);
  }

  getValue(): T { return this.value; }
}
