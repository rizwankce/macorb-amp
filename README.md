# MacOrb for Amp

Give your Amp threads a real Mac — macOS, Xcode and the iOS Simulator — from
desktop, web or your phone.

## Install

In any Amp thread, say:

> Import the MacOrb plugin from github.com/rizwankce/macorb-amp into my personal plugins.

Amp copies the `macorb/` directory into your personal plugins, so it loads in
every thread you start, on every device.

## Sign in

1. Sign in at [console.macorb.dev](https://console.macorb.dev) and add your Amp
   API key.
2. Give the plugin your MacOrb token:
   - **Desktop:** `npx @macorb/cli login`
   - **Web and phone** (threads run in an Amp orb): store the token as an Amp
     secret named `MACORB_TOKEN`:

     ```sh
     amp secrets set --user --secret MACORB_TOKEN
     ```

## Use it

> Use MacOrb: get a Mac and run the tests in this repo on an iPhone simulator.

The plugin starts a Mac, and Amp runs a child thread on it. Say "stop the Mac"
when you're done. Pricing and docs: [macorb.dev](https://macorb.dev).

⚠️ A thread started from the web or phone runs in an Amp orb, which Amp bills
separately from the Mac.
