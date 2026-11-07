// E10: no serious or critical accessibility problems on the main pages, in
// both themes. FullCalendar's own icon markup is excluded (third-party).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

const adminPages = ['/admin'];
const pages = [
  '/',
  '/authentication',
  '/dashboard',
  '/explore',
  '/schedule',
  '/chat',
  '/settings',
  '/notifications',
  '/welcome',
  '/history',
];

for (const theme of ['dark', 'light']) {
  for (const path of pages) {
    test(`${path} (${theme}) has no serious accessibility problems`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem('theme', t), theme);
      if (!['/', '/authentication', '/privacy', '/terms'].includes(path)) await signInAs(page, 'member@syncronify.dev');
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // Let entrance animations finish: half-faded text isn't what people read.
      await page.waitForTimeout(1500);
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('.fc-icon').analyze();
      const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    });
  }
}

for (const path of adminPages) {
  test(`${path} (admin) has no serious accessibility problems`, async ({ page }) => {
    await signInAs(page, 'admin@syncronify.dev');
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  });
}
