/**
 * Индикатор работы агента: «дышащая» аура вокруг знака >_
 * и переливающийся текст текущей фазы.
 * Стили — в src/index.css (блок «agent work indicator»).
 */
export function AgentIndicator({ label = "думает…" }: { label?: string }) {
  return (
    <div className="oc-thinking">
      <div className="oc-aura">
        <div className="oc-aura-glow" />
        <div className="oc-aura-mark">&gt;_</div>
      </div>
      <span className="oc-sheen-text">{label}</span>
    </div>
  );
}

export default AgentIndicator;
