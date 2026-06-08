// Парсер сечения профиля из svgContent модели → данные для 3D-экструзии.
//
// В SVG (из CorelDRAW) сечение задано набором <line>:
//   • чёрные линии (class str0 / без класса) — контур профиля;
//   • отдельная синяя линия <line id="glass"> — плоскость стекла относительно
//     профиля (где и насколько глубоко садится стекло).
//
// Координаты в SVG: единицы = viewBox, ось Y вниз. Переводим в мм
// (scale = viewBoxW / widthMm), инвертируем Y (вверх), нормируем к min=0.
//
// Возвращаем:
//   outline   — внешний контур профиля, мм, CCW, ось Y = глубина (front→back)
//   faceWidth — ширина профиля по фронту (вдоль плоскости фасада), мм
//   depth     — глубина профиля (перпендикулярно фасаду), мм
//   glassMid  — глубина центра стекла внутри профиля (по оси depth), мм
//   glassSeat — насколько стекло заходит под профиль, мм

export interface Section3D {
  outline: { x: number; y: number }[]; // x = вдоль фронта (0..faceWidth), y = глубина (0..depth)
  faceWidth: number;
  depth: number;
  glassMid: number;   // позиция стекла по оси глубины, мм
  glassSeat: number;  // нахлёст стекла под профиль, мм
}

interface Seg { x1: number; y1: number; x2: number; y2: number }

export function parseSection(svgContent: string): Section3D | null {
  try {
    const doc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return null;

    // scale: единиц SVG на мм
    const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const widthMm = parseFloat(svg.getAttribute('width') ?? '0'); // "210mm" → 210
    const scale = vb.length === 4 && widthMm ? vb[2] / widthMm : 100;

    const allLines = Array.from(svg.querySelectorAll('line'));
    const glassEl = allLines.find(l => l.getAttribute('id') === 'glass'
      || (l.getAttribute('class') ?? '').includes('str1'));
    const contourEls = allLines.filter(l => l !== glassEl);
    if (contourEls.length < 3) return null;

    const num = (el: Element, a: string) => parseFloat(el.getAttribute(a) ?? 'NaN');
    const segs: Seg[] = contourEls.map(l => ({
      x1: num(l, 'x1'), y1: num(l, 'y1'), x2: num(l, 'x2'), y2: num(l, 'y2'),
    })).filter(s => [s.x1, s.y1, s.x2, s.y2].every(Number.isFinite));

    // Цепляем сегменты в замкнутые петли; берём с наибольшей площадью bbox (внешнюю)
    const loops = chainLoops(segs);
    if (loops.length === 0) return null;
    const outerRaw = loops.sort((a, b) => bboxArea(b) - bboxArea(a))[0];

    // raw → мм, инверсия Y, нормировка
    let minX = Infinity, minY = Infinity;
    const mm = outerRaw.map(p => ({ x: p.x / scale, y: -p.y / scale }));
    for (const p of mm) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
    const outline = mm.map(p => ({ x: p.x - minX, y: p.y - minY }));

    let maxX = 0, maxY = 0;
    for (const p of outline) { maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const faceWidth = maxX;
    const depth = maxY;

    // Линия стекла → глубина центра + нахлёст
    let glassMid = depth / 2;
    let glassSeat = 8;
    if (glassEl) {
      const gy = (-num(glassEl, 'y1') / scale) - minY; // глубина плоскости стекла
      const gx1 = num(glassEl, 'x1') / scale - minX;
      const gx2 = num(glassEl, 'x2') / scale - minX;
      glassMid = gy;
      glassSeat = Math.abs(gx2 - gx1);
    }

    ensureCCW(outline);
    return { outline, faceWidth, depth, glassMid, glassSeat };
  } catch {
    return null;
  }
}

/** Сцепляет отрезки в замкнутые полилинии по совпадающим концам. */
function chainLoops(segs: Seg[]): { x: number; y: number }[][] {
  const used = new Array(segs.length).fill(false);
  const loops: { x: number; y: number }[][] = [];
  const EPS = 1e-3;
  const eq = (a: number, b: number) => Math.abs(a - b) < EPS;

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const loop = [{ x: segs[i].x1, y: segs[i].y1 }, { x: segs[i].x2, y: segs[i].y2 }];
    let extended = true;
    while (extended) {
      extended = false;
      const tail = loop[loop.length - 1];
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const s = segs[j];
        if (eq(s.x1, tail.x) && eq(s.y1, tail.y)) { loop.push({ x: s.x2, y: s.y2 }); used[j] = true; extended = true; break; }
        if (eq(s.x2, tail.x) && eq(s.y2, tail.y)) { loop.push({ x: s.x1, y: s.y1 }); used[j] = true; extended = true; break; }
      }
    }
    // убираем дубль-замыкание (последняя точка == первой)
    const first = loop[0], last = loop[loop.length - 1];
    if (loop.length > 2 && eq(first.x, last.x) && eq(first.y, last.y)) loop.pop();
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function bboxArea(loop: { x: number; y: number }[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of loop) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return (maxX - minX) * (maxY - minY);
}

/** Гарантирует обход против часовой (для корректной триангуляции earcut). */
function ensureCCW(pts: { x: number; y: number }[]) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0) pts.reverse();
}
