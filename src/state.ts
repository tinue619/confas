// Выбор пользователя в конфигураторе.

import type { ProfileColor, GlassColor, GlassType } from './catalog';
import type { HingesSpec } from './model';

export type HingeMode = 'none' | 'holes' | 'holes+hinges';
export type HingeSide = 'left' | 'right' | 'top' | 'bottom';

export class FacadeState {
  width  = 450;
  height = 800;
  profileColor: ProfileColor = 'inox';
  glassColor:   GlassColor   = 'clear';
  glassType:    GlassType    = 'smooth';
  tempered = false;

  hingeMode: HingeMode = 'none';
  hingeSide: HingeSide = 'left';
  /** Позиции центров присадок вдоль выбранной стороны, мм от начала стороны */
  hingePositions: number[] = [];
}

/** Длина стороны фасада, на которой стоят петли. */
export function sideLength(fs: FacadeState): number {
  return (fs.hingeSide === 'left' || fs.hingeSide === 'right') ? fs.height : fs.width;
}

/** Автоматический расчёт позиций петель по интервалам модели. */
export function autoHingePositions(spec: HingesSpec, length: number): number[] {
  const interval = spec.intervals.find(i => length <= i.maxLength)
                 ?? spec.intervals[spec.intervals.length - 1];
  const n = interval.count;
  if (n <= 0) return [];
  const off = spec.endOffset ?? 100;
  if (n === 1) return [length / 2];
  const first = Math.min(off, length / 2);
  const last  = length - first;
  if (n === 2) return [first, last];
  const step  = (last - first) / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(first + i * step));
}
