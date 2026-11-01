export type ModalSheetSize = "page" | "full" | "compact";

const wideWindow = 700;

export function modalSheetLayout(size: ModalSheetSize, largeText: boolean, width: number) {
  const compact = size === "compact" && !largeText;
  const overlay = compact || (size !== "page" && width >= wideWindow);
  return {
    compact,
    overlay,
    bottom: compact && width < wideWindow,
    presentationStyle: modalPresentationStyle(overlay, size),
  };
}

function modalPresentationStyle(
  overlay: boolean,
  size: ModalSheetSize,
): "overFullScreen" | "pageSheet" | "fullScreen" {
  if (overlay) return "overFullScreen";
  return size === "page" ? "pageSheet" : "fullScreen";
}
