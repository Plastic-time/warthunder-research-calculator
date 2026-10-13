const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

async function main() {
  const output = path.resolve('logs/rank-rail-edge');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const mode of ['local', 'pages']) for (const width of [390, 711, 900, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 660 } });
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`);
      await page.waitForSelector('.rank-block:nth-of-type(2) .rank-rail');
      await page.evaluate(() => document.fonts.ready);
      for (const position of ['left', 'middle', 'right']) {
        const geometry = await page.evaluate(async position => {
          const tree = document.getElementById('treeContainer');
          const rank = tree.querySelector('.rank-block:nth-of-type(2)');
          tree.scrollTop += rank.getBoundingClientRect().top - tree.getBoundingClientRect().top;
          tree.scrollLeft = (tree.scrollWidth - tree.clientWidth) * ({ left: 0, middle: 0.5, right: 1 }[position]);
          WTTreeScroll.sync();
          await new Promise(resolve => requestAnimationFrame(resolve));
          const rail = rank.querySelector('.rank-rail').getBoundingClientRect();
          const viewport = tree.getBoundingClientRect();
          const scrollbar = document.getElementById('treeVerticalScrollBar').getBoundingClientRect();
          const nav = document.querySelector('.branch-tabs').getBoundingClientRect();
          return { gap: rail.left - viewport.left, width: rail.width, navRight: nav.height > nav.width ? nav.right : 0,
            viewportLeft: viewport.left, scrollbarRight: scrollbar.right, viewportRight: viewport.right };
        }, position);
        assert.equal(geometry.gap, 0, `${mode} ${width} ${position}: rank rail must touch viewport`);
        // The tree starts at the screen edge, or right after the desktop branch rail; the rank rail is narrower on phones.
        assert.equal(geometry.viewportLeft, geometry.navRight);
        assert.equal(geometry.width, width <= 720 ? 44 : 68);
        assert.equal(geometry.scrollbarRight, geometry.viewportRight);
        if (position === 'right' && width === 711) await page.screenshot({ path: path.join(output, `${mode}-${width}.png`) });
      }
      for (const selector of ['.unit-modifications-launch', '.unit-wiki-launch', '.folder-toggle']) {
      const layering = await page.evaluate(async selector => {
        const tree = document.getElementById('treeContainer');
        const rank = tree.querySelector('.rank-block:nth-of-type(2)');
        const rail = rank.querySelector('.rank-rail');
        const button = rank.querySelector(selector);
        const bounds = tree.getBoundingClientRect();
        const before = button.getBoundingClientRect();
        tree.scrollLeft += before.left + before.width / 2 - bounds.left - 34;
        tree.scrollTop += before.top + before.height / 2 - bounds.top - 90;
        await new Promise(resolve => requestAnimationFrame(resolve));
        const covered = button.getBoundingClientRect();
        const hit = document.elementFromPoint(covered.left + covered.width / 2, covered.top + covered.height / 2);
        const blocked = !!hit?.closest('.rank-rail');
        const material = getComputedStyle(rail);
        const text = getComputedStyle(rail.querySelector('.rank-name'));
        tree.scrollLeft -= 100;
        await new Promise(resolve => requestAnimationFrame(resolve));
        const visible = button.getBoundingClientRect();
        const exposed = document.elementFromPoint(visible.left + visible.width / 2, visible.top + visible.height / 2);
        return { blocked, coveredX: covered.left + covered.width / 2, railRight: rail.getBoundingClientRect().right, maxScroll: tree.scrollWidth - tree.clientWidth, exposed: exposed?.closest(selector) === button,
          background: material.backgroundColor, railOpacity: material.opacity, textOpacity: text.opacity, textColor: text.color };
      }, selector);
      // Only meaningful when the tree can scroll far enough to slide the button under the rail.
      if (layering.coveredX < layering.railRight) assert(layering.blocked, `Rank rail must cover ${selector} and block accidental clicks: ` + JSON.stringify(layering));
      assert(layering.exposed, 'Buttons outside the rail must remain clickable');
      assert.equal(layering.background, 'rgba(29, 34, 36, 0.7)');
      assert.equal(layering.railOpacity, '1');
      assert.equal(layering.textOpacity, '1');
      assert.equal(layering.textColor, 'rgb(177, 189, 190)');
      }
      if (width === 711) {
        await page.evaluate(() => { document.getElementById('treeContainer').scrollLeft += 100; });
        await page.screenshot({ path: path.join(output, `${mode}-${width}-translucent.png`) });
      }
      await page.close();
      console.log(JSON.stringify({ mode, width, leftMiddleRightFlush: true, railWidth: 68, translucentBackground: true, opaqueText: true, buttonsBelowRail: true }));
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
