import { setDeviceToken } from "../lib/db";
import { claimPairCode } from "../lib/sync-client";

const form = document.querySelector<HTMLFormElement>("#pair-form")!;
const codeInput = document.querySelector<HTMLInputElement>("#pair-code-input")!;
const submitButton = document.querySelector<HTMLButtonElement>("#pair-submit")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#pair-status")!;

async function claim(code: string): Promise<void> {
	const trimmed = code.trim();
	if (!trimmed) return;

	submitButton.disabled = true;
	statusEl.textContent = "Pairing…";
	try {
		const { deviceToken } = await claimPairCode(trimmed);
		await setDeviceToken(deviceToken);
		statusEl.textContent = "Paired! Taking you back…";
		location.href = "/";
	} catch (err) {
		statusEl.textContent =
			err instanceof Error ? err.message : "Couldn't pair this device.";
		submitButton.disabled = false;
	}
}

form.addEventListener("submit", (event) => {
	event.preventDefault();
	void claim(codeInput.value);
});

// The code travels in the URL fragment (never sent to the server, never
// logged) when it arrives via a scanned QR — see the Obsidian decision log.
// Pre-fill and submit immediately so scanning is a single tap, not a
// copy-paste; clear the fragment right away so a refresh doesn't resubmit an
// already-spent code.
const codeFromHash = location.hash.slice(1);
if (codeFromHash) {
	codeInput.value = codeFromHash;
	history.replaceState(null, "", location.pathname);
	void claim(codeFromHash);
}
