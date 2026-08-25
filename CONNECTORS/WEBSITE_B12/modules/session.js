function clean(value) {
  return String(value || '').trim();
}

function classifySessionSnapshot(snapshot = {}) {
  const url = clean(snapshot.url);
  const title = clean(snapshot.title);
  const body = clean(snapshot.body);
  const hasPasswordInput = snapshot.hasPasswordInput === true;
  const text = `${url} ${title} ${body}`;

  // B12's authenticated editor can legitimately contain words such as "email"
  // in the page body. Do not let generic content words override strong editor
  // evidence such as the site_builder route or the B12 Editor title.
  const strongEditor = /\/client\/[^/?#]+\/site_builder(?:\/|[?#]|$)/i.test(url) || /\bB12\s+Editor\b/i.test(title);
  const strongLoginRoute = /\/(?:login|signin|sign-in)(?:\/|[?#]|$)/i.test(url);
  const loginLanguage = /\b(?:log\s*in|sign\s*in|welcome\s+back|forgot\s+password)\b/i.test(`${title} ${body}`);
  const loggedOut = !strongEditor && (strongLoginRoute || (hasPasswordInput && loginLanguage));
  const loggedInSignal = strongEditor || /dashboard|website|pages|analytics|publish|editor|site_builder/i.test(text);

  return {
    url,
    title,
    loggedIn: loggedInSignal && !loggedOut,
    loggedOut,
    evidence: body.slice(0, 500),
    signals: {
      strongEditor,
      strongLoginRoute,
      hasPasswordInput,
      loginLanguage
    }
  };
}

async function detectSession(page) {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const hasPasswordInput = await page.locator('input[type="password"]').count().then(count => count > 0).catch(() => false);
  return classifySessionSnapshot({ url, title, body, hasPasswordInput });
}

module.exports = { detectSession, classifySessionSnapshot };
