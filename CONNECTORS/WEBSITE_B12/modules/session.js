async function detectSession(page) {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

  const loggedOut = /login|welcome back|password|email/i.test(`${url} ${title} ${body}`);
  const loggedIn = /dashboard|website|pages|analytics|publish|editor|site_builder/i.test(`${url} ${title} ${body}`);

  return {
    url,
    title,
    loggedIn: loggedIn && !loggedOut,
    loggedOut,
    evidence: body.slice(0, 500)
  };
}

module.exports = { detectSession };
