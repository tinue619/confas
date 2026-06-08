// Аппаратная кнопка «Назад» Android.
//
// Capacitor шлёт событие `backButton`. По дефолту это закрывает приложение,
// что для конфигуратора всегда «не то». Мы приоритезируем закрытие текущего
// видимого слоя:
//   1) Превью long-press   → закрыть превью
//   2) Открытая шторка     → закрыть её (есть свой Esc/tap-out, переиспользуем)
//   3) Кабинет, не корень  → шаг назад по стеку (back-кнопка в шапке)
//   4) Кабинет, корень     → закрыть кабинет (если конфигуратор позади)
//   5) Edit-overlay        → нажать «✓ Готово»
//   6) Иначе               → свернуть приложение (App.minimizeApp / exit)
//
// Все слои находим по DOM: это нулевой импакт и не нужно прокидывать
// состояние через модули.

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

export function installNativeBack() {
  if (!Capacitor.isNativePlatform()) return;

  App.addListener('backButton', () => {
    // 1. Превью long-press
    const preview = document.querySelector('.preview-overlay');
    if (preview) { preview.remove(); return; }

    // 2. Bottom-sheet (есть свой dim-overlay, имитируем тап по нему — он закроет)
    const sheetOverlay = document.querySelector<HTMLElement>('.sheet-overlay.sheet-overlay--open');
    if (sheetOverlay) {
      sheetOverlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return;
    }

    // 3-4. Кабинет: внутренняя кнопка «назад» в шапке. Если на корне — она
    // скрыта (visibility:hidden), значит back должен закрыть весь кабинет.
    const cabinet = document.querySelector('.screen-overlay.screen-overlay--open');
    if (cabinet) {
      const backBtn = cabinet.querySelector<HTMLElement>('#screen-back');
      if (backBtn && backBtn.style.visibility !== 'hidden') {
        backBtn.click(); return;
      }
      // На корне кабинета. Если конфигуратор позади (профиль есть и есть
      // mount) — закрываем кабинет; иначе сворачиваем (регистрация — не уйти).
      const configReady = document.querySelector('#home-btn');
      if (configReady) {
        // Тот же путь, что и tap по фону: переиспользуем close через анимацию.
        cabinet.classList.remove('screen-overlay--open');
        setTimeout(() => cabinet.remove(), 300);
        return;
      }
      // Регистрация — выходим из приложения.
      App.exitApp();
      return;
    }

    // 5. Полноэкранный редактор позиции корзины.
    const editSave = document.querySelector<HTMLElement>('.edit-overlay--open #edit-save');
    if (editSave) { editSave.click(); return; }

    // 6. Конфигуратор без оверлеев → сворачиваем приложение.
    App.minimizeApp();
  });
}
