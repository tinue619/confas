// Общий реестр bottom-sheet: app.ts реализует openSheet и регистрирует его
// здесь, а внешние модули (checkout, cabinet) берут через getOpenSheet().
// Так избегаем циклических импортов с app.ts.

export interface OpenSheetOpts { id?: string; dim?: boolean; onClose?: () => void }

export interface OpenSheetFn {
  (title: string,
   render: (body: HTMLElement, close: () => void) => void,
   opts?: OpenSheetOpts): void;
}

let _openSheet: OpenSheetFn | null = null;

/** Вызывается из app.ts один раз — регистрирует реальную реализацию. */
export function setOpenSheet(fn: OpenSheetFn) { _openSheet = fn; }

/** Открыть шторку. No-op, если app ещё не зарегистрировал реализацию. */
export function openSheet(
  title: string,
  render: (body: HTMLElement, close: () => void) => void,
  opts?: OpenSheetOpts,
): void {
  _openSheet?.(title, render, opts);
}
