const { test, expect } = require('@playwright/test');

/**
 * Navigation Consistency Tests
 * 
 * Validates that all frontend pages maintain consistent navigation
 * with the correct order: Overview → Automation Lab → History → Controls → Settings
 */

const EXPECTED_NAV_ORDER = [
  { href: '/', label: 'Overview', emoji: '🏠' },
  { href: '/test.html', label: 'Automation Lab', emoji: '🧪' },
  { href: '/control.html', label: 'Controls', emoji: '🎮' },
  { href: '/history.html', label: 'History', emoji: '📊' },
  { href: '/settings.html', label: 'Settings', emoji: '⚙️' }
];

const FRONTEND_PAGES = [
  '/index.html',
  '/test.html',
  '/control.html',
  '/history.html',
  '/settings.html',
  '/setup.html',
  '/login.html'
];

test.describe('Navigation Consistency', () => {

  test('all pages should have nav-links element', async ({ page }) => {
    for (const pageUrl of FRONTEND_PAGES) {
      try {
        await page.goto('http://localhost:8000' + pageUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
      } catch (e) {
        // Skip server tests if server not running
        test.skip();
      }
      const navLinks = page.locator('.nav-links');
      await expect(navLinks).toBeVisible({ timeout: 5000 });
    }
  });

  test('all pages should have exactly 5 navigation links', async ({ page }) => {
    for (const pageUrl of FRONTEND_PAGES) {
      try {
        await page.goto('http://localhost:8000' + pageUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
      } catch (e) {
        test.skip();
      }
      const navLinks = page.locator('.nav-links a.nav-link');
      const count = await navLinks.count();
      expect(count).toBe(5, `Page ${pageUrl} should have 5 nav links, found ${count}`);
    }
  });

  test('navigation links should be in correct order on all pages', async ({ page }) => {
    for (const pageUrl of FRONTEND_PAGES) {
      try {
        await page.goto('http://localhost:8000' + pageUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
      } catch (e) {
        test.skip();
      }
      const navLinks = page.locator('.nav-links a.nav-link');
      
      for (let i = 0; i < EXPECTED_NAV_ORDER.length; i++) {
        const expected = EXPECTED_NAV_ORDER[i];
        const link = navLinks.nth(i);
        
        const href = await link.getAttribute('href');
        const text = await link.textContent();
        
        expect(href).toBe(expected.href, 
          `Page ${pageUrl} - Nav link ${i} should have href="${expected.href}", got "${href}"`);
        
        expect(text).toContain(expected.emoji,
          `Page ${pageUrl} - Nav link ${i} should contain emoji "${expected.emoji}", got "${text}"`);
        
        expect(text).toContain(expected.label,
          `Page ${pageUrl} - Nav link ${i} should contain label "${expected.label}", got "${text}"`);
      }
    }
  });

  test('Overview link should always navigate to home', async ({ page }) => {
    for (const pageUrl of FRONTEND_PAGES) {
      try {
        await page.goto('http://localhost:8000' + pageUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
      } catch (e) {
        test.skip();
      }
      const overviewLink = page.locator('.nav-links a.nav-link').first();
      const href = await overviewLink.getAttribute('href');
      expect(href).toBe('/');
    }
  });

  test('all navigation links should be clickable', async ({ page }) => {
    try {
      await page.goto('http://localhost:8000/index.html', { waitUntil: 'domcontentloaded', timeout: 5000 });
    } catch (e) {
      test.skip();
    }
    const navLinks = page.locator('.nav-links a.nav-link');
    
    for (let i = 0; i < EXPECTED_NAV_ORDER.length; i++) {
      const link = navLinks.nth(i);
      await expect(link).toBeEnabled();
      const isClickable = await link.isEnabled();
      expect(isClickable).toBeTruthy(`Nav link ${i} should be clickable`);
    }
  });

  test('navigation links should have correct accessibility attributes', async ({ page }) => {
    try {
      await page.goto('http://localhost:8000/index.html', { waitUntil: 'domcontentloaded', timeout: 5000 });
    } catch (e) {
      test.skip();
    }
    const navLinks = page.locator('.nav-links a.nav-link');
    
    for (let i = 0; i < EXPECTED_NAV_ORDER.length; i++) {
      const link = navLinks.nth(i);
      const role = await link.getAttribute('role') || 'link'; // default role for <a>
      expect(['link', 'navigation'].includes(role) || role === null).toBeTruthy(
        `Nav link ${i} should have appropriate role`
      );
    }
  });

  test('emoji icons should be present and correct in all pages', async ({ page }) => {
    for (const pageUrl of FRONTEND_PAGES) {
      try {
        await page.goto('http://localhost:8000' + pageUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
      } catch (e) {
        test.skip();
      }
      const navLinks = page.locator('.nav-links a.nav-link');
      
      const overview = await navLinks.nth(0).textContent();
      expect(overview).toContain('🏠');
      
      const lab = await navLinks.nth(1).textContent();
      expect(lab).toContain('🧪');
      
      const history = await navLinks.nth(2).textContent();
      expect(history).toContain('📊');
      
      const controls = await navLinks.nth(3).textContent();
      expect(controls).toContain('🧭');
      
      const settings = await navLinks.nth(4).textContent();
      expect(settings).toContain('⚙️');
    }
  });

  test('navigation should have consistent styling across all pages', async ({ page }) => {
    // Test that nav-links and nav-link classes are present on all pages
    for (const pageUrl of FRONTEND_PAGES) {
      try {
        await page.goto('http://localhost:8000' + pageUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
      } catch (e) {
        test.skip();
      }
      
      // Check that nav-links container exists
      const navContainer = page.locator('.nav-links');
      await expect(navContainer).toHaveClass(/nav-links/);
      
      // Check that all nav links have the nav-link class
      const navLinks = page.locator('.nav-links a.nav-link');
      const count = await navLinks.count();
      
      for (let i = 0; i < count; i++) {
        const link = navLinks.nth(i);
        await expect(link).toHaveClass(/nav-link/);
      }
    }
  });

});
