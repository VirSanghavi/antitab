<div align="center">

<img src="icons/icon128.png" width="72" height="72" alt="">

# Antitab

**Make a site think you never left the tab.**

Switch away and a page is told about it: video pauses, timers are throttled,
idle countdowns start, sessions expire. Antitab tells the page you are still
right there, so none of that happens.

[**Install without an extension →**](https://virsanghavi.github.io/antitab/)
&nbsp;·&nbsp;
[Install the extension](#install-the-extension)
&nbsp;·&nbsp;
[How it works](#how-it-works)

</div>

---

## Which version do I want?

|                       | [Bookmark](#the-bookmark-no-installing) | [Extension](#install-the-extension)     |
| --------------------- | --------------------------------------- | --------------------------------------- |
| Anything to install   | No                                      | Yes, a folder you download              |
| Works on a locked-down school or work Chromebook | **Yes**      | Usually not, extensions are blocked      |
| Effort per page       | One click                               | None, it just works                      |
| Survives a page reload| No, click it again                      | Yes                                      |
| Reaches videos embedded from another site | No                  | Yes                                      |

**On a school or work Chromebook, use the bookmark.** Managed Chromebooks
normally block installing extensions and switch off developer tools, and a
bookmark needs neither.

---

## The bookmark (no installing)

The easy way: open **<https://virsanghavi.github.io/antitab/>** and drag the
button onto your bookmarks bar. That page walks you through it with pictures of
nothing to get wrong.

If you would rather not open a link:

1. Open [`bookmarklet/antitab.txt`](bookmarklet/antitab.txt) and copy the whole
   line. It is long, starting with `javascript:`.
2. Press <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>O</kbd> to open Chrome's bookmark
   manager.
3. Three dots in the top right → **Add new bookmark**.
4. Name it `Antitab`, paste the copied line into the **URL** box, save.
5. Drag it onto your bookmarks bar so it is one click away.

**Using it:** open your video, press play, then click the Antitab bookmark once.
A small black bar confirms it is on. Switch tabs freely. Click the bookmark
again to turn it off, and reloading the page clears it too.

<details>
<summary>Chrome will not let me paste <code>javascript:</code> into the address bar</summary>

That is deliberate: Chrome strips `javascript:` when you paste into the address
bar, to protect people from being talked into pasting code they do not
understand. It does not apply to bookmarks, so use the bookmark manager above.
If you truly need the address bar, type `javascript:` by hand first, then paste
the rest after it.

</details>

<details>
<summary>Nothing happens when I click it</summary>

A few pages refuse bookmarks like this one: Chrome's own settings pages, the
Chrome Web Store, and some bank and exam sites. Nothing can be done on those.
On an ordinary site you should always see the black confirmation bar.

</details>

---

## Install the extension

No developer account, no Web Store, no command line.

1. **Download the code.** Green **Code** button at the top of this page →
   **Download ZIP**. Unzip it. You now have a folder called `antitab-main`.
2. **Open** `chrome://extensions` (paste that into the address bar).
3. Turn on **Developer mode**, top right.
4. Click **Load unpacked**, top left, and pick the `antitab-main` folder.
   Pick the folder itself, the one with `manifest.json` inside it.
5. Antitab appears in your toolbar. You may need the puzzle-piece icon to pin it.

**Using it:** open a site that pauses on you, click the Antitab icon, and switch
**Keep playing in the background** on. Chrome asks for permission for that one
site, which is the only access Antitab ever gets. It takes effect immediately,
without reloading, and every later visit to that site is covered automatically.

<kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>K</kbd> toggles the current site, and you
can change that in `chrome://extensions/shortcuts`.

> [!NOTE]
> **If step 3 has no Developer mode switch, or it is greyed out,** your
> Chromebook or laptop is managed and your administrator has turned it off. The
> extension cannot be installed. [Use the bookmark](#the-bookmark-no-installing)
> instead, which does the same job.

---

## How it works

Chrome tells a page four separate things when you switch away, and each one gets
its own switch:

| Switch | What it does |
| ------ | ------------ |
| **Report the tab as open and focused** | `document.hidden` stays `false`, `visibilityState` stays `"visible"`, `hasFocus()` stays `true`, and `navigator.userActivation` keeps reporting an active gesture. `visibilitychange`, `webkitvisibilitychange`, window `blur` and `freeze` are caught in the capture phase on `window` and stopped before any page code hears them. Element-level `blur` is untouched, so forms and focus still behave. |
| **Keep timers and animation running** | A background tab has `requestAnimationFrame` stopped outright and `setTimeout` clamped to once a second, then once a minute after five. Antitab serves both from a `Worker` timer, which Chrome does not throttle. Timers already pending when you switch away are migrated across, so a poll started at page load keeps its real interval. |
| **Look like you are still using it** | Idle timers, session timeouts and "are you still there?" prompts watch for input, not for focus. A single pointer movement is synthesised every 30 seconds, only ever while the tab is genuinely hidden. |
| **Press play if a video pauses** | Some players pause through a path no lie can hide. Antitab presses play again, at most 3 times in 15 seconds per element, and only while the tab is genuinely hidden, so it can never fight you or loop forever. |

It reads the true visibility from the untouched `Document.prototype` getter it
captured before shadowing it, so it always knows the difference between a real
pause and one it caused.

Turning Antitab off restores everything exactly: the shadowing properties are
deleted, the listeners removed, and `requestAnimationFrame`, `setTimeout`,
`setInterval`, `requestIdleCallback` and `HTMLMediaElement.prototype.pause` are
put back as they were. Timers still pending are handed to the browser rather
than dropped.

### Where it cannot help

- **Videos embedded from another site.** The bookmark only reaches the page you
  clicked it on. The extension needs that other site switched on too.
- **Anything enforced on a server.** Some exam, training and time-tracking
  platforms report focus from their own backend on purpose. Nothing running in
  your browser changes that.
- **Chrome's own pages,** the Web Store, and `file://` pages. Chrome blocks all
  extensions there, including this one.
- **Timers, when a page is fully frozen.** Chrome can freeze a long-idle
  background tab outright. Playing audio normally prevents that.

---

## Privacy

Antitab has no servers and makes no network requests of any kind. There are no
accounts, no analytics, no tracking, and nothing is collected. The extension
ships with access to **no sites at all**: each site you switch on is a separate
Chrome permission prompt, the list lives in local extension storage, and
**Revoke all** in settings hands every one of them back.

---

## For developers

Plain JavaScript, no dependencies, no build step for the extension itself.

```
manifest.json              Manifest V3
src/main/antitab.js        the payload, runs in the page's own world
src/content/bridge.js      isolated world, carries settings across the boundary
src/background.js          service worker: registrations, badge, shortcut
src/popup/                 toolbar popup
src/options/               settings page
src/shared/                site keys and stored config, shared by every context
src/bookmarklet/wrapper.js turns the payload into the bookmarklet
dev/                       build scripts, tests, preview harness
docs/                      the installer page, generated, served by GitHub Pages
```

```bash
node dev/make-icons.mjs          # redraw the PNG icons
node dev/build-bookmarklet.mjs   # rebuild bookmarklet/ and docs/ from the payload
node dev/test/check-sources.mjs        # parses, paths resolve, copy rules
node dev/test/icon-check.mjs           # committed PNGs match the drawing code
node dev/test/bookmarklet-check.mjs
node dev/preview/build.mjs       # preview pages for the popup and options UI
node dev/test/serve.mjs 8733     # then open the spec below
```

The bookmarklet and the installer page are **generated from
`src/main/antitab.js`**, so the two versions can never drift apart. Rerun
`dev/build-bookmarklet.mjs` after any change to the payload; CI fails if the
committed output does not match.

### Tests

`npm install --no-save playwright && node dev/test/run-spec.mjs` runs the whole
spec headlessly, which is what CI does. Or open
`http://127.0.0.1:8733/dev/test/spec.html` and press **Run**. 22 assertions
covering the spoofing, the event blocking, the animation-frame keep-alive, the
force-resume limits, and a clean teardown.

A headless browser never actually backgrounds a tab, so the spec drives the real
`Document.prototype.hidden` getter directly. The payload reads that getter and
cannot tell the difference. To confirm against a genuinely hidden tab, use
`dev/test/harness.html?antitab=1` in a real Chrome window: press start, switch
away for ten seconds, come back, and read `window.__testResults`.

---

## License

[MIT](LICENSE). Do what you like with it.
