/**
 * True while an app dialog covers the phone. Phone screens listen for Escape
 * on the document and would otherwise navigate back in addition to the dialog
 * closing. Overlays inside the chat panel belong to the phone itself.
 */
export function appDialogCoversPhone() {
  return Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], .dialog-backdrop'))
    .some((element) => !element.closest('.chat-panel'));
}
