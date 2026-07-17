// P1.6: конечный автомат состояния сессии (busy/idle) + idle-резолверы.
// Вынесено из messagesSlice.ts механически, поведение сохранено 1:1:
//   - markBusy/markIdle/isBusy — бывший const __locallyBusy = new Set<string>()
//   - onIdle/resolveIdle/clearIdleResolver — бывшая __idleResolvers Map
// Чистый класс без React и сети — легко тестировать (см. sessionFsm.test.ts).

export class SessionFsm {
  /**
   * Сессии, для которых клиент активно ждёт ответа на свой send().
   * Пока сессия busy, промежуточные события (finish:"stop" на
   * reasoning-стадии, session.idle между tool-calls) не сбрасывают busy.
   */
  private busy = new Set<string>();
  /** Колбэки, ждущие настоящего завершения сессии (session.idle от сервера). */
  private idleResolvers = new Map<string, () => void>();

  /** true, если send() для этой сессии ещё не завершился. */
  isBusy(sessionId: string): boolean {
    return this.busy.has(sessionId);
  }

  /** Пометить сессию активной (вызывается в начале send()). */
  markBusy(sessionId: string): void {
    this.busy.add(sessionId);
  }

  /**
   * Снять пометку активности (конец send() или ошибка). Резолвер не трогаем:
   * его снимает та ветка, которая реально завершила ожидание —
   * прежняя семантика __locallyBusy.delete().
   */
  markIdle(sessionId: string): void {
    this.busy.delete(sessionId);
  }

  /**
   * Зарегистрировать резолвер завершения. Если резолвер уже есть
   * (пользователь быстро отправил дважды), он не теряется — новый
   * вызывает предыдущий цепочкой (прежняя семантика __idleResolvers.set).
   */
  onIdle(sessionId: string, resolver: () => void): void {
    const prev = this.idleResolvers.get(sessionId);
    this.idleResolvers.set(sessionId, () => {
      if (prev) {
        try {
          prev();
        } catch {
          /* прежнее поведение: ошибка предыдущего резолвера глотается */
        }
      }
      resolver();
    });
  }

  /** Снять резолвер без вызова (финал подтверждён другим каналом). */
  clearIdleResolver(sessionId: string): void {
    this.idleResolvers.delete(sessionId);
  }

  /** Вызвать и снять резолвер, если он есть. Возвращает true, если вызван. */
  resolveIdle(sessionId: string): boolean {
    const resolve = this.idleResolvers.get(sessionId);
    if (!resolve) return false;
    this.idleResolvers.delete(sessionId);
    resolve();
    return true;
  }

  /** Полный сброс (для тестов). */
  reset(): void {
    this.busy.clear();
    this.idleResolvers.clear();
  }
}

/** Единственный экземпляр на приложение — как прежние модульные переменные. */
export const sessionFsm = new SessionFsm();
