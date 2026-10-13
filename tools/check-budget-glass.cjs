const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {once} = require('node:events');
const express = require('express');
const {chromium} = require('playwright');

async function main() {
  const output = path.resolve('logs/budget-glass-check');
  fs.mkdirSync(output, {recursive: true});
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({channel: 'chrome', headless: true});
    for (const mode of ['local', 'pages']) for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({viewport: {width, height: 940}, isMobile: width < 720, hasTouch: width < 720});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => document.querySelector('.unit-tile') && window.LocalPlanner);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => [...document.querySelectorAll('.unit-tile img')].slice(0, 3).every(img => img.complete && img.naturalWidth > 0));
      const panel = page.locator('#floatingBudget');
      const button = page.locator('#planButton');
      const box = await button.boundingBox();
      assert(box.width >= 44 && box.height >= 44);
      const geometry = await panel.boundingBox();
      const paintBefore = await panel.screenshot();
      await page.evaluate(() => document.querySelector('link[href*="budget-glass.css"]').disabled = true);
      assert.deepEqual(await panel.boundingBox(), geometry, 'Glass must not resize the toolbar');
      assert(!paintBefore.equals(await panel.screenshot()), 'Material must visibly differ from the previous surface');
      await page.evaluate(() => document.querySelector('link[href*="budget-glass.css"]').disabled = false);
      assert((await panel.evaluate(el => getComputedStyle(el).backdropFilter)).includes('blur(24px)'));
      const point = {x: box.x + box.width / 2, y: box.y + box.height / 2};
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.waitForTimeout(120);
      assert(await button.evaluate(el => el.dataset.pressFeedback === 'pressed'));
      const scale = await button.evaluate(el => parseFloat(getComputedStyle(el).scale));
      assert(scale < 1 && scale > 0.9);
      await page.screenshot({path: path.join(output, `${mode}-${width}-pressed.png`)});
      await page.mouse.move(box.x - 30, box.y - 30);
      await page.mouse.up();
      assert(!(await button.evaluate(el => el.dataset.pressFeedback === 'pressed')));
      assert(await page.evaluate(() => !state.planResult && !state.planned.size));
      // Synthetic visual-only release observes the spring without triggering a click.
      await button.dispatchEvent('pointerdown', {pointerId: 17, isPrimary: true, button: 0});
      await button.dispatchEvent('pointerup', {pointerId: 17, clientX: point.x, clientY: point.y});
      await page.waitForFunction(() => document.getElementById('planButton').dataset.pressFeedback === 'release');
      assert(await button.evaluate(el => el.getAnimations().some(animation => animation.effect?.getTiming().duration === 220)));
      await button.evaluate(el => el.disabled = true);
      assert(await button.evaluate(el => el.getAnimations().some(animation => animation.effect?.getTiming().duration === 220)), 'Busy state must not cut off the release spring');
      await button.evaluate(el => el.disabled = false);
      await page.waitForTimeout(500);
      await page.evaluate(() => toggleUnitMode('us_m18_hellcat', 'target'));
      if (width < 720) await page.touchscreen.tap(point.x, point.y);
      else await button.click();
      await page.waitForFunction(() => state.planResult && !els.planButton.disabled);
      assert(await page.evaluate(() => state.planResult.feasible && state.missing.length > 1));
      assert(!(await button.evaluate(el => el.dataset.pressFeedback === 'pressed')));
      await page.mouse.move(0, 0);
      await button.evaluate(el => el.blur());
      await page.waitForTimeout(500);
      if (width < 720) assert.equal(await page.locator('#floatingPlanHelp').evaluate(el => getComputedStyle(el).visibility), 'hidden');
      await page.screenshot({path: path.join(output, `${mode}-${width}.png`)});
      await panel.screenshot({path: path.join(output, `${mode}-${width}-detail.png`)});
      const within = async () => page.evaluate(() => {
        const panel = document.getElementById('floatingBudget').getBoundingClientRect();
        return panel.left >= 0 && panel.right <= innerWidth && [...document.querySelectorAll('#floatingBudget .budget-summary span, #floatingBudget .budget-summary strong, #planButton')].every(el => {
          const box = el.getBoundingClientRect();
          return box.left >= panel.left && box.right <= panel.right && box.top >= panel.top && box.bottom <= panel.bottom;
        });
      });
      assert(await within(), 'Normal values stay in toolbar');
      await page.evaluate(() => {
        document.getElementById('budgetCount').textContent = '3,235';
        document.getElementById('budgetRp').textContent = '9,999,999,999';
        document.getElementById('budgetSl').textContent = '99,999,999,999';
      });
      assert(await within(), 'Large values stay in toolbar');
      await page.emulateMedia({reducedMotion: 'reduce'});
      await button.dispatchEvent('pointerdown', {pointerId: 18, isPrimary: true, button: 0});
      assert.equal(await button.evaluate(el => getComputedStyle(el).scale), 'none');
      const updatedBox = await button.boundingBox();
      await button.dispatchEvent('pointerup', {pointerId: 18, clientX: updatedBox.x + 20, clientY: updatedBox.y + 20});
      assert(!(await button.evaluate(el => el.getAnimations().some(animation => animation.effect?.getTiming().duration === 220))));
      await button.dispatchEvent('pointerdown', {pointerId: 19, isPrimary: true, button: 0});
      await button.dispatchEvent('pointercancel', {pointerId: 19});
      assert(!(await button.evaluate(el => el.dataset.pressFeedback === 'pressed')));
      await button.evaluate(el => el.disabled = true);
      await button.dispatchEvent('pointerdown', {pointerId: 20, isPrimary: true, button: 0});
      assert(!(await button.evaluate(el => el.dataset.pressFeedback === 'pressed')));
      await button.evaluate(el => el.disabled = false);
      await button.focus();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => !els.planButton.disabled);
      assert(await page.evaluate(() => state.planResult.feasible));
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({mode, width, sameDimensions: true, pressFeedback: true, spring: true, cancel: true, actualPlan: true, reducedMotion: true, largeValues: true, passed: true}));
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {console.error(error.stack); process.exitCode = 1;});
