# Browser release checks

`npm run test:browser` runs the real-browser interaction, warm-cache upgrade and
seven-language suites against both backend and static versions. The interaction
check uses 1440, 900 and 390 px; language checks add 320 px touch emulation.

Install dependencies with `npm ci --ignore-scripts`. Locally the tests use installed
Chrome; `CHROME_PATH` can select an executable. CI installs the pinned Playwright
Chromium build. Tests only start isolated loopback services and browser profiles.
No production server, account, saved plan or browser profile is modified.
Playwright is development-only. Release preparation prunes development dependencies;
the packager refuses to ship a local tree that still contains Playwright.

Application Checks runs the reusable Browser Checks workflow for pushes and PRs.
Pages also requires that workflow to pass before uploading/deploying its artifact.
Screenshots are retained for seven days on failures and successes. Upload paths
explicitly exclude browser profiles, cookies, unrelated logs and source caches.

Assertions cover both scroll axes in the tree, current bottom-docked budget,
main-card and folded-card status labels, planning totals, context menu, translated
folder search, modification targets/prerequisites/tier fillers, real modification
icons, all five branches, and special/unknown-cost vehicle handling. Separate
warm-cache tests retain real HTTP cache and verify plans/RP progress survive an
upgrade; the multilingual suite covers 42 version/size/language combinations.

These are browser-emulated phone sizes, not physical-device or Safari acceptance.
External Wiki image failures remain failures; they are not replaced by test images.
