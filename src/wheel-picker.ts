// Колесо-пикер числового значения. Порт из HTML-прототипа на TypeScript.
// Драг по горизонтали, инерция, mousewheel на десктопе, haptic на каждом мм.

export interface WheelPickerOpts {
  parent: HTMLElement;
  axis?:  string;          // "X", "Y" — короткая метка
  name:   string;          // "Ширина"
  unit?:  string;          // "мм"
  min:    number;
  max:    number;
  value:  number;
  pxPerMm?: number;        // 1мм = N px ленты, дефолт 4
  onChange: (v: number) => void;
}

export class WheelPicker {
  private track: HTMLDivElement;
  private tape:  HTMLDivElement;
  private readoutEl: HTMLElement;
  private min: number; private max: number;
  private value: number;
  private pxPerMm: number;
  private onChange: (v: number) => void;

  private isDragging = false;
  private startX = 0;
  private startValue = 0;
  private velocity = 0;
  private lastX = 0;
  private lastTime = 0;
  private momentumId: number | null = null;
  private lastHapticValue: number;

  constructor(o: WheelPickerOpts) {
    this.min = o.min; this.max = o.max; this.value = o.value;
    this.pxPerMm = o.pxPerMm ?? 4;
    this.onChange = o.onChange;
    this.lastHapticValue = o.value;

    const block = document.createElement('div');
    block.className = 'wheel-block';
    block.innerHTML = `
      <div class="wheel-header">
        <div class="wheel-title">
          ${o.axis ? `<span class="wheel-axis">${o.axis}</span>` : ''}
          <span class="wheel-name"></span>
        </div>
        <div class="wheel-readout"><span class="readout"></span><span class="unit"></span></div>
      </div>
      <div class="wheel-track">
        <div class="wheel-tape"></div>
        <div class="wheel-center"></div>
      </div>`;
    (block.querySelector('.wheel-name') as HTMLElement).textContent = o.name;
    (block.querySelector('.unit') as HTMLElement).textContent = o.unit ?? '';
    o.parent.appendChild(block);

    this.track     = block.querySelector('.wheel-track') as HTMLDivElement;
    this.tape      = block.querySelector('.wheel-tape')  as HTMLDivElement;
    this.readoutEl = block.querySelector('.readout')     as HTMLElement;

    this.buildTicks();
    this.update(o.value, false);
    this.bindEvents();
  }

  private buildTicks() {
    const frag = document.createDocumentFragment();
    for (let mm = this.min; mm <= this.max; mm++) {
      const tick = document.createElement('div');
      tick.className = 'tick ' + (mm % 100 === 0 ? 'major' : mm % 10 === 0 ? 'mid' : 'minor');
      tick.style.left = (mm * this.pxPerMm) + 'px';
      const line = document.createElement('div');
      line.className = 'tick-line';
      tick.appendChild(line);
      if (mm % 100 === 0) {
        const label = document.createElement('div');
        label.className = 'tick-label';
        label.textContent = String(mm);
        tick.appendChild(label);
      }
      frag.appendChild(tick);
    }
    this.tape.appendChild(frag);
  }

  private applyTransform() {
    this.tape.style.transform = `translateX(${-this.value * this.pxPerMm}px)`;
  }

  update(newValue: number, doCallback = true) {
    const clamped = Math.round(Math.min(this.max, Math.max(this.min, newValue)));
    const changed = clamped !== this.value;
    this.value = clamped;
    this.applyTransform();
    this.readoutEl.textContent = String(clamped);
    if (changed && doCallback) this.onChange(clamped);
    if (changed && (navigator as any).vibrate && Math.abs(clamped - this.lastHapticValue) >= 1) {
      (navigator as any).vibrate(1);
      this.lastHapticValue = clamped;
    }
  }

  setValue(v: number) { this.update(v, false); }
  getValue(): number { return this.value; }

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
    this.startValue = this.value;
    this.lastX = e.clientX;
    this.lastTime = performance.now();
    this.velocity = 0;
    if (this.momentumId !== null) cancelAnimationFrame(this.momentumId);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.isDragging) return;
    e.preventDefault();
    const dx = e.clientX - this.startX;
    this.update(this.startValue - dx / this.pxPerMm);
    const now = performance.now();
    const dt = now - this.lastTime;
    if (dt > 0) this.velocity = (e.clientX - this.lastX) / dt;
    this.lastX = e.clientX; this.lastTime = now;
  };

  private onUp = () => {
    if (!this.isDragging) return;
    this.isDragging = false;
    if (Math.abs(this.velocity) > 0.05) this.startMomentum();
  };

  private startMomentum() {
    let v = this.velocity;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last; last = now;
      this.update(this.value - (v * dt) / this.pxPerMm);
      v *= Math.pow(0.95, dt / 16);
      if (Math.abs(v) < 0.01) { this.velocity = 0; return; }
      this.momentumId = requestAnimationFrame(tick);
    };
    this.momentumId = requestAnimationFrame(tick);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const d = e.deltaY || e.deltaX;
    const step = Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / 30));
    this.update(this.value + step);
  };
}
