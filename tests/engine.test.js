(() => {
  const engine = globalThis.__chromeSeo;
  const checks = [];
  function assert(condition, message) { if (!condition) throw new Error(message); checks.push(message); }
  const data = engine.analyze();
  assert(data.lang === 'ru' && data.headings[0].text === 'Кот café', 'Nested heading and language');
  assert(data.micro.jsonLd.length === 2 && data.micro.jsonLd[1].error && data.micro.jsonLd[0].data.name.includes('<img'), 'JSON-LD raw, parse errors, untrusted strings');
  assert(data.links.length === 3 && data.links[0].restricted && data.links[1].restricted && !data.links[2].restricted, 'External anchor instances and rel tokens');
  assert(data.images[0].hasAlt && !data.images[1].hasAlt, 'Missing versus empty alt');
  const result = engine.keywords('кот КОТ café A+B');
  assert(result.words.length === 3 && result.words[0].body === 5, 'Unicode deduplication, whole words, hidden exclusion');
  assert(result.words[0].h1 === 1 && result.words[0].p === 3 && result.words[0].a === 1 && result.words[0].other === 1, 'Overlapping categories and nearest relevant ancestor');
  assert(result.words[2].body === 1, 'Literal regex metacharacters');
  const breaks = engine.keywords('foo bar foobar').words;
  assert(breaks[0].body === 1 && breaks[1].body === 1 && breaks[2].body === 0, 'BR separates visible words');
  assert(new Set(engine.keywords('one two three four five six seven eight').words.map(word => word.color)).size === 8, 'Eight keyword colors are distinct');
  const before = document.body.innerHTML;
  const highlighted = engine.highlightKeywords('кот café');
  assert(!highlighted.supported || highlighted.count === 7, 'Keyword ranges across nested inline nodes');
  engine.clearHighlights();
  assert(document.body.innerHTML === before, 'Highlight and clear preserve page markup');
  const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex, nofollow'; document.head.append(robots);
  assert(engine.analyze().links.every(link => link.restricted), 'Page robots nofollow restricts all external links'); robots.remove();
  document.querySelector('#results').textContent = `PASS: ${checks.length} checks\n${checks.join('\n')}`;
})();

