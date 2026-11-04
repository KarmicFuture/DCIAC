import { outletHoldHtml } from "../domain/outlet-policy";
import { state } from "../state";
import { esc } from "./format";

export function toastHtml() {
  const hold = outletHoldHtml();
  if (!state.toast) return hold;
  return hold + '<div class="toast"><span>' + esc(state.toast) + '</span><button type="button" data-act="dismiss-toast">Dismiss</button></div>';
}
