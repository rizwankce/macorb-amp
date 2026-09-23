# MacOrb for Amp

**Give Amp a Mac.** This plugin lets any Amp thread borrow a real macOS machine,
with Xcode and the iOS Simulator, and hand the Apple-only work to it. It works
from Amp on your desktop, on the web and on your phone, even with the laptop lid
shut.

```
you: Use MacOrb: build this app and run its tests on an iPhone simulator.

amp: Mac is up (registered in 34 s). Running on it now…
     ✓ xcodebuild test — 8 passed, 0 failed (iPhone 17 Pro, iOS 26)
     Stopping the Mac.
```

## What you get

- **A clean Mac for each job.** macOS 26, Xcode 26 and the iOS Simulator, with
  your repository cloned onto it.
- **It works from anywhere you use Amp.** Start on your laptop, check in from
  your phone. The work runs on the Mac, not on your device.
- **It pauses itself.** A Mac that has been idle for five minutes is paused and
  keeps your uncommitted work. It resumes in about 20 seconds when you need it
  again.
- **Nothing starts by accident.** The tools only switch on when a thread uses
  the `use-mac` skill, so ordinary threads never start a Mac.

## Before you start

1. **A MacOrb account.** Sign in at [console.macorb.dev](https://console.macorb.dev)
   with GitHub.
2. **Your Amp API key**, saved in the console under **Settings**. Your Mac uses
   it to run Amp.
3. **Optional: a GitHub token**, saved in the same place, if the Mac should
   clone a private repository or push a branch.

## Install

In any Amp thread, say:

> Import the MacOrb plugin from github.com/rizwankce/macorb-amp into my personal plugins.

Amp copies the `macorb/` folder into your personal plugins. From then on it
loads in every new thread, on every device.

## Sign in

Where a thread runs decides how the plugin finds your MacOrb token.

**Desktop threads** run on your computer:

```sh
npx @macorb/cli login
```

**Web and phone threads** run in an Amp orb, a cloud machine. Store your token
as an Amp secret, and every orb you start will receive it:

```sh
amp secrets set --user --secret MACORB_TOKEN
```

Paste the token when asked. Secrets reach an orb when it starts, so begin a new
thread afterwards.

## Use it

Ask for a Mac in plain words:

> Use MacOrb: clone github.com/acme/ios-app and run the unit tests.

> Use MacOrb: build the app and show me a Simulator screenshot of the login screen.

> Stop the Mac.

Behind the scenes, `macorb_acquire` starts a Mac and waits for its Amp runner to
register. Your thread then starts a child thread **on that Mac**, and you can
watch or steer it at ampcode.com. When you're done, `macorb_stop` destroys the
Mac.

There are also three palette commands: **MacOrb: Run on the Mac**, **MacOrb:
Open active Mac** and **MacOrb: Stop Mac**.

## Pricing

You pay per minute while a Mac runs, from prepaid credit. A paused Mac costs
almost nothing. Current rates are at [macorb.dev/pricing](https://macorb.dev/pricing/).

⚠️ A thread started from the web or phone runs in an Amp orb, which Amp bills
separately from the Mac.

## Troubleshooting

| You see | What to do |
|---|---|
| `UNAUTHENTICATED` | Sign in again: `npx @macorb/cli login` on desktop, or update the `MACORB_TOKEN` secret for web and phone |
| `AMP_KEY_NOT_SET` | Save your Amp API key under **Settings** in the console |
| `GITHUB_TOKEN_NOT_SET` | You named a repository but haven't saved a GitHub token |
| `CAPACITY_REACHED` | You already have a Mac for another project. Stop it first |
| The plugin doesn't load | Start a new thread. Plugins load when a thread starts |

## Updating

A plugin imported from GitHub doesn't update itself. To get a newer version,
say:

> Re-import the MacOrb plugin from github.com/rizwankce/macorb-amp into my personal plugins, replacing the old one.

## Links

- Docs and quickstart: [macorb.dev/docs](https://macorb.dev/docs/quickstart/)
- Console: [console.macorb.dev](https://console.macorb.dev)
- Help: [support@macorb.dev](mailto:support@macorb.dev)
- Security: [macorb.dev/security](https://macorb.dev/security/)
