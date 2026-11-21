# Before You Pay

**Know what you're agreeing to before you click "Start free trial".**

Before You Pay is a Chrome extension that reads the checkout or signup page you're on and tells you, in the page's own words, what it will actually cost you: when the free trial turns into a paid plan and for how much, which add-ons are already ticked, extra fees, automatic renewal, and how to cancel. One click saves a reminder for two days before the first charge, along with a proof of what the page promised.

The checkout page has your name, email, address and card ending on it, so it is read by the AI model on your own computer and never sent anywhere. The company's public terms page is long and has nothing about you in it, so that part goes to Gemini in the cloud.

> Status: work in progress for #BuildHybridAI 2026. Built from scratch during the submission period (started Nov 21, 2026).

## How it uses Firebase AI Logic

Two models, two inference modes, each picked for a reason:

| Job | Data | Mode | Why |
|---|---|---|---|
| Read the checkout page | Private (name, address, card ending) | `ONLY_ON_DEVICE` | It must never fall back to the cloud. `PREFER_ON_DEVICE` would silently do that. |
| Read the public terms or cancellation page | Public, often too long for the on-device model | `ONLY_IN_CLOUD` | Needs a long context, carries nothing about the user. |
| No on-device model on this computer | Private | Basic pattern check, or a redacted copy to the cloud only if the user says yes | Privacy stays the user's choice. |

Every card shows where it came from (ON DEVICE, IN CLOUD or BASIC CHECK), using `response.inferenceSource`.

The model is never trusted with numbers. It returns quotes, amounts and trial lengths as structured JSON. Our code then:
- checks that every quote appears word for word on the page, and that every amount is printed on the page,
- works out dates itself (a 14-day trial started today ends on a date the code computes, not the model),
- marks anything that fails as "check this line" instead of showing a confident wrong answer.

Code: [`web/src/ai.ts`](web/src/ai.ts) (models and modes), [`web/src/verify.ts`](web/src/verify.ts) (quote and amount checks), [`web/src/rules.ts`](web/src/rules.ts) (basic check).

## Architecture

```
Chrome side panel (extension page)
  └─ iframe: hosted web app /panel.html   allow="language-model"
        ├─ Firebase App Check (reCAPTCHA v3 on the hosted domain, debug provider on localhost)
        ├─ Firebase AI Logic
        │     ├─ ONLY_ON_DEVICE  -> Chrome Prompt API (Gemini Nano)   checkout page
        │     └─ ONLY_IN_CLOUD   -> Gemini (gemini-3.5-flash-lite)    public terms page
        ├─ Firebase Auth (anonymous) + Firestore: saved offers and reminders
        └─ Remote Config: prompt version and patterns (planned)
content script (on click only, activeTab): page snapshot, highlight a quote, fetch the terms page
```

Why an iframe: extension pages can't load reCAPTCHA, which App Check needs on the web. Running the checker on a real web origin keeps App Check standard, and Chrome lets the extension hand the on-device Prompt API to the frame with `allow="language-model"`.

## Run it locally

Requirements: Node 20+, Chrome desktop 139 or newer. For on-device inference, a computer that meets Chrome's built-in AI hardware requirements, with `chrome://flags/#prompt-api` and `chrome://flags/#gemma4-for-built-in-ai` enabled.

```bash
cd web
cp .env.example .env.local   # fill in your Firebase web app config
npm install
npm run dev                  # http://127.0.0.1:5173/panel.html
npm test
```

Load the extension: open `chrome://extensions`, turn on Developer mode, click Load unpacked, pick the `extension/` folder. Copy `extension/app-url.example.js` to `extension/app-url.js` if you want to point it at a hosted copy.

No checkout page handy? The panel has a "Try the demo store" link, and `web/demo-store/` is a made-up store for testing.

## Privacy

- The extension only runs when you open it (activeTab). It does not watch your browsing.
- The checkout page is read on your computer. With no on-device model, nothing is sent unless you agree, and then only a copy with emails, card numbers, phone numbers and addresses removed.
- Saved offers keep only the site name, the verified quotes, the time and a SHA-256 fingerprint. No names, card data or page copies.

## License

Apache 2.0. See [LICENSE](LICENSE).
