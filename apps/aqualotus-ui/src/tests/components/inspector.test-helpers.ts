import { vi } from "vitest";
import Inspector from "../../components/Inspector";

export const func = {
  status: "ok" as const,
  id: 0,
  name: "main",
  isMain: true,
  entry: null,
  commandCount: 1,
};

export function inspectorProps(): React.ComponentProps<typeof Inspector> {
  return {
    func,
    entry: func.entry,
    selected: null,
    busy: false,
    onReplace: vi.fn(),
    onDeleteBlock: vi.fn(),
    onDeleteFunction: vi.fn(),
    onClearEntry: vi.fn(),
  };
}
