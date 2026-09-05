// The PDF reader owns a separate document; pane styles do not reach its popup.
export function ensureSelectionPopupStyles(doc: Document): void {
  if (doc.getElementById("paperpilot-selection-style")) return;
  const style = doc.createElement("style");
  style.id = "paperpilot-selection-style";
  style.textContent = `
    .pp-selection-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid GrayText;
    }
    .pp-selection-actions > button.pp-selection-action {
      appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      min-height: 28px;
      margin: 0;
      padding: 5px 10px;
      border: 1px solid GrayText;
      border-radius: 6px;
      background: ButtonFace;
      color: ButtonText;
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.3;
      white-space: nowrap;
      cursor: pointer;
    }
    .pp-selection-actions > button.pp-selection-action:hover:not(:disabled) {
      border-color: Highlight;
      box-shadow: inset 0 0 0 1px Highlight;
    }
    .pp-selection-actions > button.pp-selection-action:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .pp-selection-actions > button.pp-selection-action:focus-visible {
      outline: 2px solid Highlight;
      outline-offset: 2px;
    }
    .pp-selection-actions > button.pp-selection-action:active:not(:disabled) {
      background: Highlight;
      color: HighlightText;
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);
}
