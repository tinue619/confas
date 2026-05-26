// Тип модели изделия (выгружается утилитой в .json).
// Категория определяется папкой: models/<category>/*.json

export type Category = 'facade' | 'mirror' | 'glass';

export const CATEGORY_LABEL: Record<Category, string> = {
  facade: 'Фасад',
  mirror: 'Зеркало',
  glass:  'Стекло',
};

export interface FacadeModel {
  /** Отображаемое название модели */
  name: string;
  /** Имя SVG-сечения (для справки/отладки) */
  svgName: string;
  /** Сырой текст SVG — модель самодостаточна */
  svgContent: string;
  /** Поворот сечения, градусы */
  rotation: 0 | 90 | 180 | 270;
  /** Смещение контура от origin редактора (мм) */
  offset: { x: number; y: number };
  /** Y-координата края стекла относительно края изделия (мм, обычно отрицат.) */
  glassEdgeY: number;
  /** Толщина стекла, мм */
  glassThickness: number;
  /** Параметры присадки под петли (одинаковые для всех петель этого типа фасада) */
  drilling?: Drilling;
  /** Правила петель: количество в зависимости от длины стороны + .obj-файл */
  hinges?: HingesSpec;
  /** Правила ценообразования: ссылки на ключи материалов */
  pricing?: PricingSpec;
  exportedAt?: string;
}

export interface PricingSpec {
  /** Профиль: ключ материала зависит от выбора цвета. Единица — погонный метр. */
  profile:  PriceRule;
  /** Стекло: ключ зависит от цвета+типа+толщины. Единица — м². */
  glass:    PriceRule;
  /** Присадка: ключ фиксированный, единица — штука. */
  drilling: PriceRule;
  /** Петля: ключ фиксированный, единица — штука. */
  hinge:    PriceRule;
  /** Надбавка за закалённое стекло (0.3 = +30%) */
  temperedMarkup?: number;
}

export interface PriceRule {
  /** Прямой ключ материала, либо... */
  key?: string;
  /** ...шаблон с подстановкой: ${profileColor}, ${glassColor}, ${glassType}, ${glassThickness} */
  keyPattern?: string;
  /** Единица измерения количества */
  unit: 'm' | 'm2' | 'piece';
}

export interface Drilling {
  /** Диаметр отверстия, мм */
  diameter: number;
  /** Глубина отверстия, мм */
  depth: number;
  /** Расстояние от выбранного края фасада до центра отверстия, мм */
  edgeOffset: number;
}

export interface HingesSpec {
  /** Имя .obj-файла в configurator/assets/hinges/ */
  objFile: string;
  /** Интервалы: длина стороны → количество петель.
   *  Берётся первый интервал, у которого maxLength ≥ длины стороны. */
  intervals: { maxLength: number; count: number }[];
  /** Минимальное расстояние от крайней петли до угла, мм */
  endOffset?: number;
}

/** Модель с привязкой к категории и идентификатором файла */
export interface CatalogEntry {
  category: Category;
  /** Имя файла без расширения */
  id: string;
  model: FacadeModel;
}
