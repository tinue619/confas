import { Vector2 } from '@babylonjs/core';

/**
 * Парсит SVG-чертёж сечения профиля (из Corel Draw, Inkscape, etc.)
 *
 * Поддерживает:
 *  - <polygon points="x1,y1 x2,y2 ..."/>           — готовый замкнутый контур
 *  - <line x1 y1 x2 y2/> элементы                  — отдельные отрезки, сами цепляем
 *
 * Координаты конвертируются в мм:
 *  - читается viewBox и атрибуты width/height в мм
 *  - Y инвертируется (SVG: Y вниз → мм: Y вверх)
 *  - всё нормализуется так чтобы min(x)=0, min(y)=0
 *
 * Возвращает контур в порядке CCW (нужен earcut'у).
 */
export function parseSvgContour(svgText: string): Vector2[] {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;

  // ── Масштаб: units/mm из viewBox + width-mm ────────────────────────────────
  const widthAttr  = svg.getAttribute('width')  ?? '';
  const viewBox    = (svg.getAttribute('viewBox') ?? '0 0 1 1').split(/\s+/).map(Number);
  const [, , vbW]  = viewBox;

  const widthMm = parseLengthMm(widthAttr) || vbW;
  const scale   = vbW / widthMm;            // units / mm

  // ── Извлекаем точки ────────────────────────────────────────────────────────
  let raw: { x: number; y: number }[];

  const polygon = svg.querySelector('polygon');
  if (polygon) {
    raw = parsePolygonPoints(polygon.getAttribute('points') ?? '');
  } else {
    const lines: Seg[] = Array.from(svg.querySelectorAll('line')).map(l => ({
      a: { x: +l.getAttribute('x1')!, y: +l.getAttribute('y1')! },
      b: { x: +l.getAttribute('x2')!, y: +l.getAttribute('y2')! },
    }));

    // Дуги/кривые в <path> аппроксимируем полилинией и добавляем сегменты
    for (const path of Array.from(svg.querySelectorAll('path'))) {
      const pts = sampleSvgPath(path.getAttribute('d') ?? '');
      for (let i = 0; i < pts.length - 1; i++) {
        lines.push({ a: pts[i], b: pts[i + 1] });
      }
    }

    raw = chainLines(lines);
  }

  // ── В мм + переворот Y ─────────────────────────────────────────────────────
  let pts = raw.map(p => ({ x: p.x / scale, y: -p.y / scale }));

  // ── Нормализация: min → 0 ──────────────────────────────────────────────────
  const minX = Math.min(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  pts = pts.map(p => ({ x: round2(p.x - minX), y: round2(p.y - minY) }));

  // ── Гарантируем CCW (для earcut) ───────────────────────────────────────────
  if (signedArea(pts) < 0) pts.reverse();

  return pts.map(p => new Vector2(p.x, p.y));
}

// ── Хелперы ────────────────────────────────────────────────────────────────

function parseLengthMm(s: string): number {
  const m = s.match(/^([\d.]+)\s*mm$/i);
  return m ? +m[1] : 0;
}

function parsePolygonPoints(s: string): { x: number; y: number }[] {
  return s.trim().split(/\s+/).map(pair => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
}

type Pt  = { x: number; y: number };
type Seg = { a: Pt; b: Pt };

/**
 * Аппроксимирует SVG-path полилинией. Поддерживает M/m, L/l, C/c, Z/z —
 * этого хватает для Corel Draw (прямые + кубические Безье на скруглениях).
 */
function sampleSvgPath(d: string, samplesPerCurve = 8): Pt[] {
  const tokens = d.match(/[a-zA-Z]|-?[\d.]+/g) ?? [];
  const out: Pt[] = [];
  let i = 0;
  let cx = 0, cy = 0;
  let startX = 0, startY = 0;
  const num = () => +tokens[i++];

  while (i < tokens.length) {
    const t = tokens[i++];

    if (t === 'M' || t === 'm') {
      const rel = t === 'm';
      cx = (rel ? cx : 0) + num();
      cy = (rel ? cy : 0) + num();
      startX = cx; startY = cy;
      out.push({ x: cx, y: cy });

      // После M/m следующие пары — это неявные L/l
      while (i < tokens.length && !isNaN(+tokens[i])) {
        cx = (rel ? cx : 0) + num();
        cy = (rel ? cy : 0) + num();
        out.push({ x: cx, y: cy });
      }
    } else if (t === 'L' || t === 'l') {
      const rel = t === 'l';
      while (i < tokens.length && !isNaN(+tokens[i])) {
        cx = (rel ? cx : 0) + num();
        cy = (rel ? cy : 0) + num();
        out.push({ x: cx, y: cy });
      }
    } else if (t === 'C' || t === 'c') {
      const rel = t === 'c';
      while (i < tokens.length && !isNaN(+tokens[i])) {
        const x1 = (rel ? cx : 0) + num(), y1 = (rel ? cy : 0) + num();
        const x2 = (rel ? cx : 0) + num(), y2 = (rel ? cy : 0) + num();
        const x3 = (rel ? cx : 0) + num(), y3 = (rel ? cy : 0) + num();
        // Сэмплируем кривую (без первой точки — она уже в out)
        for (let s = 1; s <= samplesPerCurve; s++) {
          const u = s / samplesPerCurve;
          out.push(cubic(cx, cy, x1, y1, x2, y2, x3, y3, u));
        }
        cx = x3; cy = y3;
      }
    } else if (t === 'Z' || t === 'z') {
      out.push({ x: startX, y: startY });
    }
    // Прочие команды (H/V/Q/A...) для нашего случая не нужны
  }
  return out;
}

function cubic(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number, t: number,
): Pt {
  const m = 1 - t;
  const a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
  return { x: a*x0 + b*x1 + c*x2 + d*x3, y: a*y0 + b*y1 + c*y2 + d*y3 };
}

// Цепляем отрезки в замкнутый контур, сопоставляя концы
function chainLines(lines: Seg[]): Pt[] {
  if (!lines.length) return [];
  const eps = 0.5;  // допуск на стык концов (в единицах SVG)
  const eq  = (p: any, q: any) => Math.hypot(p.x - q.x, p.y - q.y) < eps;

  const used = new Set<number>();
  const out: { x: number; y: number }[] = [lines[0].a, lines[0].b];
  used.add(0);

  while (used.size < lines.length) {
    const tail = out[out.length - 1];
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const { a, b } = lines[i];
      if (eq(a, tail))      { out.push(b); used.add(i); found = true; break; }
      else if (eq(b, tail)) { out.push(a); used.add(i); found = true; break; }
    }
    if (!found) break;  // обрыв в цепи — берём что есть
  }

  // Первая точка дублирована в конце (замыкание) — убираем
  if (out.length > 1 && eq(out[0], out[out.length - 1])) out.pop();

  return out;
}

function signedArea(pts: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
