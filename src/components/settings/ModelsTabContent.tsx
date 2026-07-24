import { FreeModelsTabContent } from "./FreeModelsTabContent";
import { ProvidersTabContent } from "./ProvidersTabContent";

/**
 * Объединённый раздел «Модели»: бесплатные (OpenCode Zen) сверху,
 * свои ключи (BYOK) ниже. Оба блока самодостаточны и владеют
 * своим состоянием форм — здесь только композиция.
 */
export function ModelsTabContent() {
  return (
    <div className="space-y-8">
      <FreeModelsTabContent />
      <div className="border-t border-border" />
      <ProvidersTabContent />
    </div>
  );
}
