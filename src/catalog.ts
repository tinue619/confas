// Цвета и типы материалов — общие для всех моделей.

export type ProfileColor = 'black' | 'gold' | 'champagne' | 'bronze' | 'inox';
export type GlassColor   = 'clear' | 'gray' | 'bronze';
export type GlassType    = 'smooth' | 'matte' | 'textured';

// Анодированный алюминий: умеренный metallic (0.4–0.7), сатиновая matte-поверхность (roughness 0.55–0.75).
// Высокий metallic превращает поверхность в зеркало и ловит тон HDR-окружения (→ розово-фиолетовые блики).
export const PROFILE_COLORS: Record<ProfileColor, { name: string; hex: string; metal: number; roughness: number }> = {
  black:     { name: 'Чёрный',  hex: '#0e0e0e', metal: 0.25, roughness: 0.75 },
  gold:      { name: 'Золото',  hex: '#c8902a', metal: 0.65, roughness: 0.55 },
  champagne: { name: 'Шампань', hex: '#d8b888', metal: 0.5,  roughness: 0.6  },
  bronze:    { name: 'Бронза',  hex: '#6b4a26', metal: 0.55, roughness: 0.6  },
  inox:      { name: 'Нержа',   hex: '#b5b8bc', metal: 0.55, roughness: 0.65 },
};

export const GLASS_COLORS: Record<GlassColor, { name: string; hex: string }> = {
  clear:  { name: 'Прозрачное', hex: '#c4d8de' },
  gray:   { name: 'Серое',      hex: '#5a5a5a' },
  bronze: { name: 'Бронза',     hex: '#8b6747' },
};

export const GLASS_TYPES: Record<GlassType, { name: string; alpha: number; roughness: number }> = {
  smooth:   { name: 'Гладкое',  alpha: 0.30, roughness: 0.02 },
  matte:    { name: 'Матовое',  alpha: 0.75, roughness: 0.7  },
  textured: { name: 'Рифлёное', alpha: 0.55, roughness: 0.35 },
};
