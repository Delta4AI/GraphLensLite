/**
 * The modal scaffolding a "fetch something into the graph" dialog needs, shared
 * by the Neo4j import and join-query popups (openNeo4jPopup, openNeo4jJoinPopup).
 *
 * The two used to hand-roll ~55 identical lines each — the
 * settled/dataFetched/controller trio, dismiss, the same four Popup options, the
 * onClose abort, the spinner painter, the detached-error re-route and the
 * lock/controller/finally dance around the fetch. They drifted accordingly:
 * every fix to that scaffolding this release had to be made twice.
 *
 * The dialog owns its form, its ids and its fetch; this owns the lifecycle.
 */
import { Popup } from './popup.js';

const POPUP_WIDTH = '480px';
// The form is in the document but a modal steals focus on open; the delay lets
// Popup finish relocating the footer before the caller's field is focused.
const FOCUS_DELAY_MS = 100;

/**
 * @param {object} opts
 * @param {object} opts.cache                app cache (for the toast fallback)
 * @param {HTMLElement} opts.form            dialog content, footer included
 * @param {string} opts.title
 * @param {HTMLButtonElement} opts.submitBtn
 * @param {HTMLButtonElement} opts.cancelBtn
 * @param {HTMLElement} opts.errorBox        inline error host (`hidden` when idle)
 * @param {string} opts.idleLabel            submit button's resting label
 * @param {HTMLElement} [opts.focusEl]       field to focus on open
 * @param {(err: *) => string} [opts.formatError]  how a thrown error reads to
 *   the user (the connectors pass connectionHint, which names the transport)
 * @param {(ctx: FetchPopupContext) => Promise<*>} opts.onFetch
 * @returns {Promise<*>} whatever `onFetch` resolved with once it closed the
 *   popup, or false when the user dismissed it
 *
 * @typedef {object} FetchPopupContext
 * @property {AbortSignal} signal            aborted by Cancel, × and Escape
 * @property {(message: string|null) => void} setBusy  spinner + label, null = idle
 * @property {(message: string) => void} showError     inline, or a toast once detached
 * @property {() => boolean} isSettled       true once the dialog is done with
 * @property {() => void} close             "the data is in" — closes the dialog
 *   and hands this fetch's return value back as the dialog's result
 */
function openFetchPopup({
  cache,
  form,
  title,
  submitBtn,
  cancelBtn,
  errorBox,
  idleLabel,
  focusEl,
  formatError = (err) => err?.message ?? String(err),
  onFetch,
}) {
  return new Promise((resolve) => {
    // Popup.close() always fires onClose, so guard against double-settling and
    // against the deliberate close after a successful fetch.
    let settled = false;
    let dataFetched = false;
    // Live only while a fetch is in flight. Cancel and × both abort it: a query
    // has a five-minute timeout, and a flow left running after dismissal
    // surfaces later as a surprise property checklist.
    let controller = null;
    // The submit stays dead for the WHOLE flow, not just while a spinner label
    // is up: the fetch drops the label between its gates (size confirm,
    // property checklist), and those are separate modals with no focus trap.
    let submitLocked = false;

    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const setBusy = (message) => {
      submitBtn.disabled = submitLocked || !!message;
      submitBtn.innerHTML = message
        ? `<span class="neo4j-btn-spinner"></span>${message}`
        : idleLabel;
    };

    const showError = (message) => {
      // Failures after close() would write into detached DOM — and those are the
      // worst ones, because the apply has already destroyed the old graph.
      if (!errorBox.isConnected) {
        cache.ui.error(message);
        return;
      }
      errorBox.textContent = message;
      errorBox.hidden = false;
    };

    const popup = new Popup(form, {
      title,
      width: POPUP_WIDTH,
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => {
        if (!dataFetched) {
          controller?.abort();
          settle(false);
        }
      },
    });

    const dismiss = () => {
      controller?.abort();
      popup.close();
      settle(false);
    };

    const run = async () => {
      errorBox.hidden = true;
      controller = new AbortController();
      submitLocked = true;
      try {
        const result = await onFetch({
          signal: controller.signal,
          setBusy,
          showError,
          isSettled: () => settled,
          close: () => {
            dataFetched = true;
            popup.close();
          },
        });
        if (dataFetched) settle(result);
      } catch (err) {
        // An abort is the user closing the dialog — they know.
        if (err?.name !== 'AbortError') {
          // The sentence for the user, the object for whoever has to debug it.
          console.error('[fetch-popup]', err);
          showError(formatError(err));
          // The popup is already closed, so nothing else will ever settle this
          // promise — its caller would wait for a retry that cannot happen.
          if (dataFetched) settle(false);
        }
      } finally {
        controller = null;
        submitLocked = false;
        if (!dataFetched && !settled) setBusy(null);
      }
    };

    submitBtn.addEventListener('click', run);
    cancelBtn.addEventListener('click', dismiss);
    if (focusEl) setTimeout(() => focusEl.focus(), FOCUS_DELAY_MS);
  });
}

export { openFetchPopup };
