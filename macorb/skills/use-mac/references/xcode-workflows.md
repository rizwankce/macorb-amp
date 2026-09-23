# Xcode workflows on a MacOrb runner

The checkout is at the `projectRoot` `macorb_acquire` returned. The runner is already bound to that directory.

## Build and test

Prefer the project's existing scheme. From the checkout:

```sh
xcodebuild -list
xcodebuild test -scheme <scheme> -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -quiet
```

If the destination name is missing, `xcrun simctl list devices available`.

## Simulator screenshot

One PNG, not a recording:

```sh
xcrun simctl io booted screenshot /tmp/macorb-sim.png
```

Return that image in-thread. Do not attach `.xcresult` bundles to the parent.

## Signing

There is no MacOrb-managed signing identity in v1. Unsigned Simulator builds are the default. If a task needs a development team, stop and say so rather than guessing.
