import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useTheme, type Theme } from "./useTheme";

const seen: Theme[] = [];

function Probe(): React.JSX.Element {
  const { theme, toggle } = useTheme();
  seen.push(theme);
  return (
    <button type="button" onClick={toggle}>
      {theme}
    </button>
  );
}

describe("useTheme", () => {
  it("defaults to night and toggles with persistence", () => {
    window.localStorage.clear();
    seen.length = 0;
    const { unmount } = render(<Probe />);
    expect(screen.getByRole("button").textContent).toBe("night");
    expect(document.documentElement.dataset.theme).toBe("night");
    act(() => {
      screen.getByRole("button").click();
    });
    expect(screen.getByRole("button").textContent).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("aqualotus-theme")).toBe("light");
    unmount();
    const second = render(<Probe />);
    expect(screen.getByRole("button").textContent).toBe("light");
    second.unmount();
    window.localStorage.clear();
    document.documentElement.dataset.theme = "night";
  });
});
