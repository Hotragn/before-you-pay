# Before You Pay

A Chrome side panel that reads a checkout page before you click the button, and tells you what you are really agreeing to: when the free trial turns into a charge, which paid add-ons were already ticked for you, what fees sit in the small print, whether it renews on its own, and how to cancel.

**The page you are about to pay on has your name, email and card on it, so it never leaves your laptop.** Gemini Nano reads it on the device. You can turn Wi-Fi off and it still works. The store's public terms page has nothing about you on it, so that one goes to Gemini in the cloud. Both run through Firebase AI Logic, and the app picks the mode for each request based on how private the text is.

![Where your text goes](docs/architecture.png)

Live app: https://before-you-pay-9b8c6.web.app
Demo store (fake, made for this project): https://before-you-pay-9b8c6.web.app/demo-store/

## The Wi-Fi off test

This is the test I care about most. Open the side panel on a checkout page, turn Wi-Fi off, and press **Check this page**. The status line says "Read on this computer in N s with no internet connection. The page was not sent anywhere." Every card is marked ON DEVICE. Then press **Read the cancellation terms** and the panel tells you that part needs the cloud and will wait until you are back online.

![Wi-Fi off check](docs/offline-stub.png)

How that screenshot was made, honestly: the machine I built this on has Gemini Nano blocked by policy. So [scripts/offline-check.mjs](scripts/offline-check.mjs) loads the live panel page, swaps in a stand-in for Chrome's `LanguageModel` that answers like the model would, goes offline and presses Check. It shows that once the panel is open, the app and the Firebase AI Logic SDK run the whole read with `ONLY_ON_DEVICE` and send nothing over the network. (The only request Chrome logged while offline was Firestore closing its idle connection.) It does not test the real model, and the 1.2 seconds in the screenshot is the stand-in's fixed delay, not a real timing. Real Gemini Nano runs and numbers are coming from a laptop that supports it.

## Try it in two minutes

1. Open https://before-you-pay-9b8c6.web.app/panel.html and press **No checkout page open? Try the demo store**, then **Check this page**.
2. The chip under the title tells you if Gemini Nano is ready on your computer.
3. Without it, you get the basic check plus a consent box. Press **Send a redacted copy** to see the cloud read, then **Read the cancellation terms**.
4. With Chrome 139+ and the Prompt API turned on (steps below), the same button reads the page on your device and the cards say ON DEVICE.

| No on-device model: it asks first | After a cloud read of a redacted copy |
|---|---|
| ![Consent box](docs/extension-consent.png) | ![Cards](docs/extension-panel.png) |

These two are the real extension running against the live app.

## Why

Free trials that quietly convert, add-ons that are ticked by default and fees in grey 10px text are old tricks. In the US, the FTC's 2024 click-to-cancel rule was vacated by a federal appeals court in July 2025, and as of November 2026 nothing has replaced it, so the burden is still mostly on the person paying. Reading every checkout page carefully takes time most people do not spend, and pasting a page full of your own card and address details into a chatbot is not a good habit either. Running the model on the device is what makes this tool reasonable to use on exactly the pages where it matters.

## What it does

1. You open a checkout page and press **Check this page**.
2. A fast basic check (plain pattern matching, no model) shows cards right away.
3. Gemini Nano reads the page on your device and returns structured findings: due today, trial length and the price after it, recurring charges, pre-ticked paid add-ons, fees, auto-renewal and cancel links. A one line summary sits on top.
4. Every finding has to quote the page word for word. The code checks that the quote and the amount really appear on the page, and anything that does not match is marked "check this line". This catches made-up text and numbers. It does not catch a real sentence that the model reads wrong, so a few readings are also checked in code. For example, a "trial" only counts as a free trial if the text around it says free, $0 or no charge, or says trial without a paid intro price nearby. Otherwise "$1 for your first month" is shown as the regular price after an intro offer, with a note. Dates are worked out in code, never by the model.
5. Click a card and the sentence it came from is highlighted on the page.
6. **Read the cancellation terms** sends the public terms page (not your checkout page) to Gemini in the cloud and returns the steps to cancel, the notice period and the refund policy.
7. **Save** keeps a short record of the offer: the verified quotes, the site, the date and a SHA-256 fingerprint of them. When there is a free trial with a known end date, the same button also sets a browser reminder two days before the first charge. Clicking the reminder opens the site, where you can cancel.

If the on-device model is not available (older Chrome, unsupported hardware, or turned off by policy), the panel says so and asks before anything leaves the machine. If you agree, it sends a copy with emails, card details, phone numbers and street addresses removed first. Names are not reliably removed, and the panel says that too. Or you can stay with the basic check.

## How hybrid inference is used

| Page | Has personal details? | Firebase AI Logic mode | Why |
|---|---|---|---|
| Checkout or signup page | Yes | `ONLY_ON_DEVICE` (Gemini Nano through the Chrome Prompt API) | Card, email and address should not leave the laptop |
| Same page, after you agree | Redacted | `ONLY_IN_CLOUD` | Fallback when Nano is not available, only with consent |
| Public terms page | No | `ONLY_IN_CLOUD` | Long legal text, nothing private, the cloud model does it better |

The modes are picked on purpose for each request instead of using one `PREFER_ON_DEVICE` setting for everything, because the right choice depends on what is in the text, not only on what the device can run. `PREFER_ON_DEVICE` would quietly send the checkout page to the cloud on any machine without Nano, which is the one thing this app must not do. On device, the output is held to a JSON schema through `responseConstraint`. The redacted cloud read uses the same schema through `responseJsonSchema`, and the terms read uses its own smaller schema for steps, notice and refunds. The panel shows where each card came from (ON DEVICE, IN CLOUD or BASIC CHECK) using the `inferenceSource` that Firebase AI Logic returns.

Other Firebase pieces:

- **App Check** with reCAPTCHA Enterprise protects the AI Logic calls, using limited-use tokens. Localhost uses the debug provider.
- **Anonymous Auth** and **Firestore** store saved offers under `users/{uid}/proofs`. The rules allow only the owner to read or delete, never allow edits, and check every field's type and size, including each quote.
- **Remote Config** holds the cloud model name, a kill switch for on-device use, the page size limit, how many days before the charge to remind you, the spacing between cloud calls, and a prompt version that is written into every eval result.
- **Hosting** serves the panel, the demo store and the eval page.

### Staying inside the free plan

The demo runs on the free Firebase plan, which allows only a few cloud requests a minute. So:

- Cloud answers are kept in your browser, keyed by a hash of the exact text sent. Pressing the same button twice on the same page costs nothing.
- For our own demo store and its terms page only, the app ships saved answers from real cloud reads (`web/public/demo-cache.json`, built by `scripts/build-demo-cache.mjs`). When the panel shows one it says so, with the date, and the next press does a fresh read. Saved answers still go through the same quote check against the page.
- Cloud calls are spaced a few seconds apart (Remote Config), and if the quota says "busy" the panel waits 15 seconds and tries once more, then explains in plain words.

None of this applies to the on-device read, which has no quota.

## Architecture

```
Chrome side panel (extension, MV3)
  └─ iframe: https://before-you-pay-9b8c6.web.app/panel.html   allow="language-model"
        ├─ Gemini Nano on device  ── checkout page text, links, ticked boxes
        ├─ Gemini in the cloud    ── public terms page, or a redacted copy with consent
        ├─ App Check, Auth, Firestore, Remote Config
  ├─ content script: reads the page, highlights quotes
  └─ background: reminder alarms and notifications
```

Extension pages cannot load reCAPTCHA, which App Check needs. So the side panel hosts the web app in an iframe and the two talk over `postMessage`. Both sides check the exact origin: the hosted page only accepts messages from this extension's ID, and the hosting server only lets the panel be framed by this extension (`frame-ancestors`). The Prompt API is passed into the iframe with `allow="language-model"`.

## Does it work? The eval

There are 16 made-up checkout and signup pages for fictional businesses (streaming, meal kits, gym, VPN, hotel, concert tickets and more). The pages and a first draft of the labels were written with help from Claude, and every label was then checked by hand. Four pages have no subscription at all, to catch false alarms. How they were labeled: [web/public/eval/LABELING.md](web/public/eval/LABELING.md). Anyone can run it at https://before-you-pay-9b8c6.web.app/eval.html.

After adding the free trial rule I wrote 6 more pages by hand that the rule was not built from (free trials worded without "trial", a cheap first 3 months, 60% off a first box, a $5 paid trial, a cheaper first year). Their labels were committed before any model saw them ([commit a965066](https://github.com/Hotragn/before-you-pay/commit/a965066)). Run them with `/eval.html?set=heldout`.

Amounts are scored as sets per page (recurring prices, ticked paid add-ons, fees), so precision and recall are over dollar amounts. All runs below are in Chrome on the live site, with cloud calls spaced 5 seconds apart.

**Main set, 16 pages**

| Run | Amount precision | Amount recall | Trial right | Auto-renew right | Cancel link right | Model findings that failed the quote check |
|---|---|---|---|---|---|---|
| Basic check (no model) | 1.00 | 0.79 | 2 of 3 | 13 of 16 | 16 of 16 | n/a |
| Cloud, redacted copy | 0.92 | 1.00 | 3 of 3 | 14 of 16 | 15 of 16 | 0 of 71 |
| On device (Gemini Nano) | coming from a supported laptop | | | | | |

**Held-out set, 6 pages**

| Run | Amount precision | Amount recall | Trial right | Auto-renew right | Model findings that failed the quote check |
|---|---|---|---|---|---|
| Basic check (no model) | 1.00 | 0.67 | 0 of 2 | 5 of 6 | n/a |
| Cloud, redacted copy | 1.00 | 0.87 | 2 of 2 | 6 of 6 | 2 of 27 |

Notes, so the numbers are read fairly:

- "Trial right" counts pages where a trial was labeled or reported. On the main set, the trial rule exists because of two mistakes the model kept making there (f05 "$1 for your first month" and f07 "50% off your first week"), so its 3 of 3 is not a fair test of the rule. The held-out set is: the model reported no false trials on the four intro price pages, and the rule caught one, turning h05's "$5 trial for 14 days" into a regular $29/month charge. The basic check misses both held-out free trials because they never say "N-day free trial".
- Cancel links are left out of the held-out table because I used `href="#"` on those pages, and the app correctly ignores links that point back at the same page. That is my mistake in the test pages, not something the app does wrong.
- The basic check numbers are higher than in earlier versions of this README (0.68 precision, 0.39 recall). Those came from a unit test that runs in jsdom, which joins page text differently from Chrome, and I had not noticed. The Chrome run is what people actually get.
- Earlier cloud runs are kept in [eval/](eval/) with notes in git history: v1 had a scorer bug, v2 came before duplicate cards were merged, and three v3 runs showed normal run-to-run variation (amount precision 0.85 to 0.97) plus some pages lost to the free plan's rate limit.
- 16 plus 6 synthetic pages is small. This is a sanity check, not a benchmark.

## Privacy

- The checkout page is only read by the on-device model, unless you agree to send a redacted copy.
- The page's content is not sent anywhere until you press a button. When the panel opens it does load its settings, sign in anonymously and run App Check, but none of that includes the page.
- Saved offers keep verified quotes only, after the same redaction, capped at 10 quotes of 500 characters, with repeats removed.
- Remote Config has a switch to turn off on-device use without shipping a new version.
- There are no analytics.

## Run it yourself

You need Node 20+, the Firebase CLI and Chrome 139 or newer on desktop.

```bash
cd web
npm install
npm run dev        # http://localhost:5173/panel.html
npm test           # unit tests and the basic-check eval
```

On localhost, App Check uses a debug token. The first run prints one in the browser console. Add it in the Firebase console under App Check, Apps, Manage debug tokens. Do not commit it.

To use your own Firebase project, change the values in `web/src/config.ts` (the web config is public by design) and the project ID in `scripts/deploy.sh`, then:

```bash
./scripts/deploy.sh                 # Hosting, Firestore rules, Remote Config
cd rules-test && npm install && npm test   # Firestore rules tests (needs Java for the emulator)
```

### Load the extension

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick the `extension` folder.
2. Open any checkout page (or the demo store) and click the Before You Pay icon.

The extension points at the hosted app. For local work, copy `extension/app-url.example.js` to `extension/app-url.js` and change the URL.

### Turn on Gemini Nano

1. Chrome 139+ on Windows, macOS or Linux with enough memory and a GPU (see [Chrome's hardware requirements](https://developer.chrome.com/docs/ai/get-started)).
2. In `chrome://flags`, search for "Prompt API", enable it, and restart Chrome.
3. In DevTools on any page, `await LanguageModel.availability()` should say `available` or `downloadable`. The first **Check this page** click starts the download.

## Repo layout

```
extension/     Chrome extension: side panel shell, content script, reminders
web/           Hosted app (Vite + TypeScript): panel, demo store, eval page
  src/ai.ts        Firebase AI Logic models and prompts
  src/verify.ts    quote and amount checks, date math
  src/rules.ts     the basic check
  src/redact.ts    redaction before anything goes to the cloud
  src/store.ts     saved offers (Auth + Firestore)
  public/eval/     16 labeled test pages
firestore.rules    owner-only, create-only, size-checked
rules-test/        emulator tests for the rules
eval/              eval results
scripts/           deploy, live check and eval runners
```

## Limits

- Gemini Nano on the web is single-turn and text only, so the page is turned into plain text plus a list of links and ticked boxes. Prices drawn as images are missed.
- Redaction is pattern based. It will miss some things, which is why the consent message says so.
- The basic check is English only.
- Reminders live in the browser. Saved offers are kept in Firestore under an anonymous account. Chrome keeps the side panel's storage separate from a normal tab, so the same saved offers do not show up when you open the website directly, and there is no sign in to move them to another device yet.
- The saved record is a fingerprint the app computes, not a signed timestamp from a third party. It helps you remember what the page said. It is not legal proof.
- The free Firebase plan has a low cloud rate limit, so when many people use the demo at once the cloud read may ask you to wait a minute.

## License

Apache 2.0. See [LICENSE](LICENSE).
