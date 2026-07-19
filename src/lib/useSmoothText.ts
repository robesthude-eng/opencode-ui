import { useEffect, useRef, useState } from "react";

/**
 * Плавный «typewriter»-стрим. Сетевые дельты приходят пачками, из-за чего
 * текст в чате и карточках COMMAND/STDOUT прыгает крупными кусками.
 * Хук постепенно догоняет целевой текст через requestAnimationFrame;
 * скорость пропорциональна отставанию — при больших пачках вывод
 * ускоряется и никогда не отстаёт от реального стрима надолго.
 */
export function useSmoothStreamingText(
  text: string,
  streaming: boolean,
  opts?: {
    /** За сколько мс догонять накопившееся отставание. */
    catchUpMs?: number;
    /** Минимум символов за кадр. */
    minStep?: number;
    /** Минимальный интервал между обновлениями, мс (~30fps по умолчанию). */
    frameMs?: number;
    /** Тексты длиннее лимита не анимируем посимвольно (защита от фризов). */
    hardLimit?: number;
  },
): string {
  const catchUpMs = opts?.catchUpMs ?? 320;
  const minStep = opts?.minStep ?? 2;
  const frameMs = opts?.frameMs ?? 33;
  const hardLimit = opts?.hardLimit ?? 24000;

  const [shown, setShown] = useState(text);
  const targetRef = useRef(text);
  targetRef.current = text;
  const lenRef = useRef(text.length);

  useEffect(() => {
    if (!streaming) {
      lenRef.current = targetRef.current.length;
      setShown(targetRef.current);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < frameMs) return;
      const dt = now - last;
      last = now;
      const target = targetRef.current;
      // Очень длинные тексты применяем сразу — посимвольная анимация
      // здесь дороже, чем польза от неё.
      if (target.length > hardLimit) {
        if (lenRef.current !== target.length) {
          lenRef.current = target.length;
          setShown(target);
        }
        return;
      }
      // Текст заменился на более короткий — синхронизируемся мгновенно.
      if (lenRef.current > target.length) {
        lenRef.current = target.length;
        setShown(target);
        return;
      }
      if (lenRef.current < target.length) {
        const backlog = target.length - lenRef.current;
        const step = Math.max(minStep, Math.ceil((backlog * dt) / catchUpMs));
        lenRef.current = Math.min(target.length, lenRef.current + step);
        setShown(target.slice(0, lenRef.current));
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [streaming, catchUpMs, minStep, frameMs, hardLimit]);

  return streaming ? shown : text;
}
