/* global window, document, parent, location */
// Opaque chrome frames are not secure contexts, so Firefox omits randomUUID
// while still exposing the cryptographic getRandomValues primitive.
if (!window.crypto.randomUUID) {
  window.crypto.randomUUID = () => {
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4),
      hex.slice(4, 6),
      hex.slice(6, 8),
      hex.slice(8, 10),
      hex.slice(10),
    ]
      .map((part) => part.join(""))
      .join("-");
  };
}
// Show bundle load/initialization failures instead of an indefinite loading page.
let studioStarted = false;
window.addEventListener("paperpilot-studio-ready", () => {
  studioStarted = true;
});
window.addEventListener(
  "error",
  (event) => {
    if (studioStarted) return;
    const error = String(
      event.message || "A bundled editor asset could not load.",
    ).slice(0, 2000);
    const display = () => {
      const message = document.createElement("p");
      message.setAttribute("role", "alert");
      message.textContent = `Research Studio could not start: ${error}`;
      document.body.replaceChildren(message);
    };
    if (document.body) display();
    else window.addEventListener("DOMContentLoaded", display, { once: true });
  },
  true,
);
