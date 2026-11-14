'use strict';

(() => {
  const scriptBase = new URL('./assets/quran-reader/', document.currentScript.src);
  const data = window.mihrabQuranReaderData = Object.create(null);
  const loads = new Map();
  const $ = id => document.getElementById('quran-reader-' + id);
  const reader = $('dialog');
  const confirmation = $('exit-confirmation');
  const book = $('book');
  const annotation = $('annotation');
  const annotationSave = $('annotation-save');
  const annotationTranslation = $('annotation-translation');
  const chrome = reader.querySelectorAll('.quran-reader-header, .quran-reader-tools, .quran-reader-footer');
  let actionVerse;
  function showChrome(visible) {
    reader.toggleAttribute('data-hide-chrome', !visible);
    chrome.forEach(element => { element.inert = !visible; });
    if (!visible) {
      $('settings').open = false;
      if ([...chrome].some(element => element.contains(document.activeElement))) {
        viewport.focus({ preventScroll: true });
      }
    }
  }
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const key = 'mihrab.quran-reader.v1';
  const highlightPrefix = 'mihrab-tajweed-';
  const canHighlight = typeof Highlight === 'function' && Boolean(CSS.highlights);
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem(key)) || {}; } catch {}
  if (typeof preferences !== 'object' || Array.isArray(preferences)) preferences = {};
  let session;
  let loading = false;
  let measuredSize = '';
  let updating = false;
  let migration;

  function publish(status) {
    window.dispatchEvent(new CustomEvent('mihrab:quran-state', { detail: status }));
  }

  function removeMigratedBookmarks(status) {
    const bookmarks = { ...preferences.bookmarks };
    let changed = false;
    for (const slot of Object.keys(bookmarks)) {
      if (status.settings[slot.split(':')[0]]?.bookmark === undefined) continue;
      delete bookmarks[slot];
      changed = true;
    }
    if (changed) persist({ ...preferences, bookmarks });
  }

  window.migrateQuranBookmarks = function (status) {
    if (migration) return migration;
    if (!status?.settings || !preferences.bookmarks) return Promise.resolve(status);
    const pending = ['reading', 'hifz'].flatMap(kind => {
      if (status.settings[kind]?.bookmark !== undefined) return [];
      const mark = preferences.bookmarks[kind + ':' + status.riwaya]?.[0];
      return mark ? [[kind, mark]] : [];
    });
    if (!pending.length) {
      try { removeMigratedBookmarks(status); } catch {}
      return Promise.resolve(status);
    }
    migration = (async () => {
      let latest = status;
      for (const [kind, mark] of pending)
        latest = await window.mihrabApi.saveQuranBookmark(kind, { ...mark, riwaya: status.riwaya }, true);
      try { removeMigratedBookmarks(latest); } catch {}
      publish(latest);
      return latest;
    })().finally(() => { migration = null; });
    return migration;
  };

  const numeral = new Intl.NumberFormat('ar', { numberingSystem: 'arab', useGrouping: false });
  const n = value => numeral.format(value);

  function load(name) {
    if (data[name]) return Promise.resolve(data[name]);
    if (loads.has(name)) return loads.get(name);
    const file = name === 'tajweed' ? 'tajweed-hafs' : name;
    const job = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(file + '.js', scriptBase);
      script.onload = () => {
        script.remove();
        if (data[name]) resolve(data[name]);
        else reject(new Error('ملف القراءة غير مكتمل.'));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('تعذر فتح ملف القراءة المحلي.'));
      };
      document.head.append(script);
    }).finally(() => loads.delete(name));
    loads.set(name, job);
    return job;
  }

  function persist(next) {
    localStorage.setItem(key, JSON.stringify(next));
    preferences = next;
  }

  function notify(message = '') {
    $('status').textContent = message;
  }

  const interfaceNumber = value => new Intl.NumberFormat(document.documentElement.lang || 'ar', { useGrouping: false }).format(value);

  function readerSurahName(surah) {
    return ui('surah.name.' + surah.number, surah.name);
  }

  function refText(index) {
    const surah = session.range.surahs.find(row => row.start <= index && index <= row.end);
    const ayah = index - surah.start + 1;
    const locale = window.mihrabLocale;
    return locale.has('reader.verseReference')
      ? locale.t('reader.verseReference', {
          surah: readerSurahName(surah),
          ayah: document.documentElement.lang === 'ar' ? n(ayah) : ayah,
        })
      : surah.name + '، الآية ' + n(ayah);
  }

  function refreshSelection() {
    const selected = session.selected;
    for (const verse of book.querySelectorAll('[data-verse]')) {
      verse.setAttribute('aria-pressed', String(Number(verse.dataset.verse) === selected));
    }
    $('bookmark').textContent = selected === null ? window.mihrabLocale.t('reader.selectVerse')
      : window.mihrabLocale.t(session.drafts.has(session.riwaya) ? 'reader.unsavedPosition' : 'reader.savedPosition',
        { verse: refText(selected) });
  }

  function clearHighlights() {
    if (!canHighlight) return;
    for (let i = 0; i < 7; i++) CSS.highlights.delete(highlightPrefix + i);
  }

  const daylightLabels = [
    '', 'الإدغام والإخفاء', 'النون والتنوين', 'الميم الساكنة',
    'المشددتان', 'المد المتصل والمنفصل واللازم', 'القلقلة',
  ];

  function daylightRule(topic, name) {
    if (topic === 0 || /^الإظهار|^إظهار/u.test(name)) return false;
    return topic !== 5 || /^المد (الواجب|الجائز|اللازم)/u.test(name);
  }

  function applyHighlights() {
    clearHighlights();
    if ($('legend').hidden) return;
    const tajweed = data.tajweed;
    const highlights = tajweed.topics.map(() => new Highlight());
    const daylight = reader.dataset.tajweedTone !== 'bright';
    for (const verse of book.querySelectorAll('[data-verse]')) {
      const text = verse.firstChild;
      const spans = tajweed.verses[Number(verse.dataset.verse)] || [];
      for (const [start, end, id] of spans) {
        const offset = Number(verse.dataset.textOffset || 0);
        const from = Math.max(0, start - offset);
        const to = Math.min(text.length, end - offset);
        if (from >= to) continue;
        const [topic, name] = tajweed.rules[id];
        if (daylight && !daylightRule(topic, name)) continue;
        const span = new Range();
        span.setStart(text, from);
        span.setEnd(text, to);
        highlights[topic].add(span);
      }
    }
    const priority = [0, 1, 4, 3, 5, 2, 6];
    for (const [topic, highlight] of highlights.entries()) {
      highlight.priority = priority[topic];
      CSS.highlights.set(highlightPrefix + topic, highlight);
    }
  }

  const brightRuleKeys = ['tafkheem', 'relations', 'noon', 'meem', 'mushaddadat', 'madd', 'qalqalah'];
  const daylightRuleKeys = ['', 'idgham', 'noon', 'meem', 'mushaddadat', 'maddTypes', 'qalqalah'];

  function syncLegend() {
    const visible = canHighlight && $('tajweed').checked && session?.riwaya === 'hafs' && data.tajweed;
    const legend = $('legend');
    const rules = $('legend-rules');
    legend.hidden = !visible;
    const tone = reader.dataset.tajweedTone;
    const lang = document.documentElement.lang;
    const signature = tone + ':' + lang;
    if (!visible || rules.dataset.tone === signature) return;
    rules.replaceChildren();
    rules.dataset.tone = signature;
    const labels = tone === 'bright' ? data.tajweed.topics : daylightLabels;
    for (const [topic, label] of labels.entries()) {
      if (!label) continue;
      const item = document.createElement('span');
      item.className = 'quran-reader-rule quran-reader-rule-color-' + topic;
      const key = 'tajweed.transliteration.' + (tone === 'bright' ? brightRuleKeys : daylightRuleKeys)[topic];
      item.setAttribute('data-no-ui-translation', '');
      item.dir = lang === 'ar' ? 'rtl' : 'ltr';
      item.textContent = window.mihrabLocale.has(key) ? window.mihrabLocale.t(key) : label;
      rules.append(item);
    }
  }

  window.addEventListener('mihrab:interface-language-changed', syncLegend);

  function renderPage(page, { corpus, range } = session) {
    const paper = document.createElement('section');
    paper.className = 'quran-reader-page';
    const original = corpus.units.page[page.number - 1];
    const opening = page.number <= 2 && page.start === original[0] && page.end === original[1];
    if (opening) paper.classList.add('quran-reader-opening');
    paper.setAttribute('aria-label', window.mihrabLocale.t('reader.mushafPage', { page: interfaceNumber(page.number) }));
    const body = document.createElement('div');
    body.className = 'quran-reader-page-body';
    paper.append(body);
    const flow = document.createElement('div');
    flow.className = 'quran-reader-page-flow';
    body.append(flow);
    const surahs = range.surahs.filter(surah => surah.start <= page.end && surah.end >= page.start);
    const corner = document.createElement('div');
    corner.className = 'quran-reader-running-title';
    corner.textContent = surahs[0].name;
    const content = opening ? document.createElement('div') : flow;
    if (opening) {
      body.append(corner);
      content.className = 'quran-reader-opening-content';
      flow.append(content);
    } else {
      body.insertBefore(corner, flow);
    }
    const text = document.createElement('div');
    text.className = 'quran-reader-verses';
    for (const surah of surahs) {
      const first = Math.max(surah.start, page.start);
      const last = Math.min(surah.end, page.end);
      if (first === surah.start && (first !== page.start || !page.startOffset)) {
        const title = document.createElement(first === page.start ? 'h3' : 'span');
        title.textContent = 'سورة ' + surah.name;
        if (first === page.start) content.append(title);
        else { title.className = 'quran-reader-inline-surah'; text.append(' ', title, ' '); }
        if (surah.basmala) {
          const basmala = document.createElement(first === page.start ? 'p' : 'span');
          basmala.className = 'quran-reader-basmala';
          basmala.textContent = surah.basmala;
          if (first === page.start) content.append(basmala);
          else text.append(basmala, ' ');
        }
      }
      for (let i = first; i <= last; i++) {
        const verse = document.createElement('span');
        verse.setAttribute('role', 'button');
        verse.tabIndex = 0;
        verse.className = 'quran-reader-verse';
        verse.dataset.verse = String(i);
        verse.dataset.surah = String(surah.number);
        verse.textContent = corpus.verses[i];
        verse.setAttribute('aria-label', 'تحديد سورة ' + surah.name + '، الآية ' + n(i - surah.start + 1) + ' · ' + verse.textContent);
        if (i !== first) text.append(' ');
        text.append(verse);
      }
    }
    const baseline = document.createElement('span');
    baseline.className = 'quran-reader-baseline';
    baseline.setAttribute('aria-hidden', 'true');
    text.append(baseline);
    content.append(text);
    const number = document.createElement('footer');
    const clippedAtStart = page.start === range.start && page.start > original[0];
    const endSource = range.pages.find(source => source.end >= page.end);
    const originalEnd = corpus.units.page[endSource.number - 1][1];
    const clippedAtEnd = page.end === range.end && page.end < originalEnd;
    const boundary = [
      clippedAtStart && window.mihrabLocale.t('reader.rangeStartsHere'),
      clippedAtEnd && window.mihrabLocale.t('reader.rangeEndsHere'),
    ].filter(Boolean).join(' · ');
    number.textContent = boundary ? n(page.number) + ' · ' + boundary : n(page.number);
    if (boundary) {
      number.className = 'quran-reader-range-cut';
      paper.classList.add('quran-reader-clipped');
    }
    paper.classList.toggle('quran-reader-cut-start', clippedAtStart);
    paper.classList.toggle('quran-reader-cut-end', clippedAtEnd);
    for (const atStart of [true, false]) {
      if (!(atStart ? clippedAtStart : clippedAtEnd)) continue;
      const divider = document.createElement('div');
      divider.className = 'quran-reader-end-divider';
      divider.setAttribute('aria-hidden', 'true');
      divider.textContent = '* * * *';
      if (atStart) content.insertBefore(divider, content.firstChild === corner ? corner.nextSibling : content.firstChild);
      else content.append(divider);
    }
    paper.append(number);
    return paper;
  }

  function pageCount() { return 1; }

  function paperFits(paper, size, body, frame) {
    paper.style.setProperty('--reader-type-size', size + 'px');
    return body.scrollHeight <= body.clientHeight &&
      body.scrollWidth <= body.clientWidth + 1 &&
      (!frame || frame.offsetHeight <= frame.parentElement.clientHeight * .64);
  }

  function naturalLastLine(block) {
    const rect = block.getBoundingClientRect();
    const left = block.lastElementChild.getBoundingClientRect().left;
    return Math.max(0, Math.min(1, (rect.right - left) / Math.max(1, rect.width)));
  }

  const wordWidths = new Map();
  let wordCanvas;
  let useWordEstimate = false;
  const verseWords = new WeakMap();

  function estimatedLines(page, corpus, width, size, referenceSize, riwaya) {
    if (typeof OffscreenCanvas !== 'function') return null;
    wordCanvas ??= new OffscreenCanvas(1, 1).getContext('2d');
    if (!wordCanvas) return null;
    const font = referenceSize + 'px ' + (riwaya === 'warsh' ? 'MihrabReaderWarsh' : 'MihrabReaderHafs');
    let widths = wordWidths.get(font);
    if (!widths) {
      if (wordWidths.size === 16) wordWidths.delete(wordWidths.keys().next().value);
      wordWidths.set(font, widths = new Map());
    }
    wordCanvas.font = font;
    wordCanvas.direction = 'rtl';
    function widthOf(word) {
      let measured = widths.get(word);
      if (measured === undefined) {
        measured = wordCanvas.measureText(word).width;
        if (widths.size < 4096) widths.set(word, measured);
      }
      return measured;
    }
    let byVerse = verseWords.get(corpus);
    if (!byVerse) verseWords.set(corpus, byVerse = new Map());
    const scale = size / referenceSize;
    const gap = widthOf(' ') * scale;
    let lines = 1, used = 0;
    for (let index = page.start; index <= page.end; index++) {
      let words = byVerse.get(index);
      if (!words) byVerse.set(index, words = corpus.verses[index].split(/\s+/u).filter(Boolean));
      for (const word of words) {
        const advance = widthOf(word) * scale;
        if (used && used + gap + advance > width) {
          ++lines;
          used = 0;
        }
        used += used ? gap + advance : advance;
      }
    }
    return lines;
  }

  function fitPage(page, preferred, context = session, surface = book) {
    const paper = renderPage(page, context);
    const width = surface.clientWidth / pageCount();
    const height = surface.clientHeight;
    const minimum = Math.min(16, width / 18);
    const maximum = Math.min(36, Math.max(22, width / 13));
    // Touch navigation must bound the number of synchronous layouts on a cold page.
    const precision = .5;
    paper.classList.add('quran-reader-probe');
    paper.inert = true;
    paper.style.width = width + 'px';
    paper.style.height = height + 'px';
    const body = paper.firstElementChild;
    const block = body.querySelector('.quran-reader-verses');
    const frame = paper.querySelector('.quran-reader-opening-content');
    const fits = size => paperFits(paper, size, body, frame);
    surface.append(paper);
    try {
      if (preferred != null && fits(preferred))
        return { size: preferred, leading: 0 };
      let low = Math.min(minimum, preferred ?? maximum);
      let high = preferred ?? maximum;
      while (low > 1 && !fits(low)) low /= 2;
      if (high > low && fits(high)) low = high;
      // Estimate a starting bracket without changing the browser's shaping or line breaks.
      if (useWordEstimate && preferred == null && !frame && !paper.classList.contains('quran-reader-clipped')) {
        const textWidth = block.clientWidth;
        const availableHeight = body.clientHeight - (block.offsetTop - body.offsetTop);
        const riwaya = context.riwaya ?? surface.parentElement?.dataset.riwaya ?? reader.dataset.riwaya;
        const referenceSize = 24;
        let floor = low, ceiling = high;
        for (let pass = 0; pass < 4; pass++) {
          const size = Math.round((floor + ceiling) / 2);
          const lines = estimatedLines(page, context.corpus, textWidth, size, referenceSize, riwaya);
          if (lines == null || size <= floor || size >= ceiling) break;
          if (lines * size * 1.75 <= availableHeight) floor = size;
          else ceiling = size;
        }
        for (const size of [floor, Math.min(high, floor + 1)]) {
          if (size > low && size < high) {
            if (fits(size)) low = size;
            else high = size;
          }
        }
      }
      while (high - low > precision) {
        const middle = (low + high) / 2;
        if (fits(middle)) low = middle;
        else high = middle;
      }
      const opening = paper.classList.contains('quran-reader-opening');
      if (preferred != null || opening) return { size: low, leading: 0 };

      // Prefer the largest fitting size whose last line can be justified naturally.
      let best = { size: low, line: 0 };
      const lastCandidate = Math.min(low, Math.max(low * .87, minimum));
      for (let size = low; size >= lastCandidate; size -= 1) {
        if (!fits(size)) continue;
        const line = naturalLastLine(block);
        if (line >= .9) {
          best = { size, line };
          break;
        }
        if (line > best.line) best = { size, line };
      }
      const { size, line } = best;
      paper.style.setProperty('--reader-type-size', size + 'px');
      const leading = parseFloat(getComputedStyle(block).lineHeight);
      const justifyLast = line >= .9;
      if (justifyLast) block.style.textAlignLast = 'justify';
      let extra = 0;
      // Each line consumes at least one increment. Bound the search by its
      // current height and the unused space, allowing for pixel rounding.
      const textHeight = block.getBoundingClientRect().height;
      const lineCount = Math.max(1, Math.round(textHeight / leading));
      const unused = body.getBoundingClientRect().bottom - block.getBoundingClientRect().bottom;
      let limit = paper.classList.contains('quran-reader-clipped') ? body.clientHeight
        : Math.min(body.clientHeight, Math.max(0, unused + 2) / lineCount + 2);
      while (limit - extra > precision) {
        const middle = (extra + limit) / 2;
        paper.style.setProperty('--reader-leading', leading + middle + 'px');
        if (fits(size)) extra = middle;
        else limit = middle;
      }
      return { size, leading: leading + extra, justifyLast };
    } finally {
      paper.remove();
    }
  }

  function pageAt(index) {
    return session.range.pages.find(page => page.start <= index && index <= page.end);
  }

  function adjacentPage(page, direction) {
    const pages = session.range.pages;
    return pages[pages.indexOf(page) + direction];
  }

  function turnTarget(direction) {
    return adjacentPage(session.visiblePage, direction);
  }

  function completePage(page, corpus) {
    const [start, end] = corpus.units.page[page.number - 1];
    return page.start === start && page.end === end;
  }

  let previewGeneration = 0;
  const adjacentPapers = new Map();

  function prepareAdjacentPages(page) {
    const active = session;
    const generation = ++previewGeneration;
    const width = book.clientWidth, height = book.clientHeight;
    adjacentPapers.clear();
    const radius = document.documentElement.dataset.performance === 'eco' ? 2 : 4;
    for (const cached of active.pageSizes.keys()) {
      if (Math.abs(cached.number - page.number) > radius) active.pageSizes.delete(cached);
    }
    if (resizePending || document.documentElement.dataset.performance === 'eco') return;
    const candidates = [adjacentPage(page, 1), adjacentPage(page, -1)].filter(Boolean);

    function step(deadline) {
      if (generation !== previewGeneration || session !== active || !reader.open ||
          resizePending || document.hidden || verticalReading() || document.documentElement.dataset.performance === 'eco') return;
      if (book.classList.contains('reading-swipe-active') ||
          book.getAnimations({ subtree: true }).length ||
          (deadline && deadline.timeRemaining() < 8)) {
        setTimeout(schedule, 70);
        return;
      }
      const next = candidates.shift();
      if (book.clientWidth !== width || book.clientHeight !== height) return;
      adjacentPapers.set(next, { paper: makePaper(next), width, height });
      if (candidates.length) schedule();
    }
    function schedule() {
      if (window.requestIdleCallback) requestIdleCallback(step);
      else setTimeout(step, 100);
    }
    if (candidates.length) schedule();
  }

  function takeAdjacentPaper(page) {
    if (document.documentElement.dataset.performance === 'eco') return null;
    const prepared = adjacentPapers.get(page);
    adjacentPapers.delete(page);
    if (prepared?.width === book.clientWidth && prepared.height === book.clientHeight) return prepared.paper;
    return null;
  }

  function makePaper(page) {
    const metrics = pageMetrics(page);
    const paper = renderPage(page);
    paper.style.setProperty('--reader-type-size', metrics.size + 'px');
    if (metrics.leading) paper.style.setProperty('--reader-leading', metrics.leading + 'px');
    if (metrics.justifyLast) paper.classList.add('quran-reader-fill-last');
    return paper;
  }

  function pageMetrics(page) {
    const { corpus, range, pageSizes } = session;
    if (!pageSizes.has(page)) {
      const neighbor = adjacentPage(page, page === range.pages[0] ? 1 : -1);
      const preferred = completePage(page, corpus) || !neighbor
        ? undefined : pageSizes.get(neighbor)?.size;
      pageSizes.set(page, fitPage(page, preferred));
    }
    return pageSizes.get(page);
  }

  // Measurements are cheap to retain near the reader. Keep the full corpus
  // available as source data, without fitting or serializing all 604 pages.
  try {
    localStorage.removeItem('mihrab.reader.metrics.v2');
    localStorage.removeItem('mihrab.reader.metrics.v3');
  } catch {}

  window.addEventListener('mihrab:performance-profile', () => {
    if (document.documentElement.dataset.performance === 'eco') wordWidths.clear();
    if (reader.open && session?.visiblePage && !loading && !verticalReading())
      prepareAdjacentPages(session.visiblePage);
  });

  function syncPagination() {
    syncLegend();
    const size = [book.clientWidth, book.clientHeight, pageCount()].join(':');
    if (measuredSize !== size) {
      session.pageSizes.clear();
      session.meanTypeSize = null;
    }
    measuredSize = size;
  }

  function render(anchor = null, preparedPaper = null) {
    closeAnnotation();
    closeTranslation();
    updateTranslationControls();
    if (verticalReading()) {
      ++previewGeneration;
      adjacentPapers.clear();
      renderVertical(anchor ?? verticalAnchor());
      return;
    }
    $('previous').hidden = $('next').hidden = false;
    viewport.scrollTop = 0;
    syncPagination();
    const first = pageAt(session.viewStart);
    if (!first) return;
    session.viewStart = first.start;
    session.visiblePage = first;
    session.viewEnd = first.end;
    book.replaceChildren(preparedPaper || makePaper(first));
    $('previous').disabled = !adjacentPage(first, -1);
    $('next').disabled = !adjacentPage(first, 1);
    $('page-number').textContent = window.mihrabLocale.t('reader.mushafPage', { page: interfaceNumber(first.number) });
    $('surah').value = QuranReaderModel.reference(session.range.surahs, anchor ?? first.start)?.surah || '';
    customSelects.get($('surah'))?.sync();
    refreshSelection();
    applyHighlights();
    prepareAdjacentPages(first);
  }

  function goToVerse(index) {
    if (verticalReading() && book.querySelector('.quran-translation-row')) {
      jumpVertical(index);
      return;
    }
    session.viewStart = index;
    render(index);
  }

  function resumeSpread(index) {
    if (verticalReading()) {
      render(index);
      return;
    }
    syncPagination();
    goToVerse(index);
  }

  function currentMark(index) {
    return {
      index,
      rangeStart: session.range.start,
      rangeEnd: session.range.end,
    };
  }

  function turn(direction, dragged = false, preparedPaper = null) {
    if (!session?.range || loading || confirmation.open || verticalReading()) return;
    const target = turnTarget(direction);
    if (!target) return;

    session.viewStart = target.start;
    render(null, preparedPaper || takeAdjacentPaper(target));
    if (!dragged) $('page-number').focus({ preventScroll: true });
    if (dragged || reduceMotion.matches || window.mihrabPerformance?.profile.id === 'eco') return;
    book.firstElementChild.animate([
      { transform: 'translateX(' + (-direction * 16) + 'px)', opacity: .55 },
      { transform: 'none', opacity: 1 },
    ], { duration: 260, easing: 'cubic-bezier(.2,.65,.3,1)' });
  }

  async function setEdition(riwaya) {
    loading = true;
    $('riwaya').disabled = true;
    $('surah').disabled = true;
    notify('جارٍ فتح المصحف…');
    try {
      const active = session;
      const corpus = await load(riwaya);
      if (active !== session) return;
      const range = QuranReaderModel.open(corpus, session.assignment);
      const storedMark = session.bookmark?.riwaya === riwaya ? session.bookmark : null;
      const saved = QuranReaderModel.resume(range, storedMark ? [storedMark] : []);
      const draft = session.drafts.get(riwaya);
      const selected = draft?.index ?? saved;
      Object.assign(session, { corpus, riwaya, range, selected, saved, pageSizes: new Map(), meanTypeSize: null });
      reader.dataset.riwaya = riwaya;
      const font = riwaya === 'hafs' ? 'MihrabReaderHafs' : 'MihrabReaderWarsh';
      await document.fonts.load('20px ' + font);
      if (active !== session) return;
      $('riwaya').value = riwaya;
      $('range').textContent = refText(range.start) + ' — ' + refText(range.end);
      $('surah').replaceChildren(...range.surahs.map(surah => new Option(readerSurahName(surah), surah.number)));
      await refreshTajweed();
      await loadTranslation();
      if (active === session) {
        resumeSpread(selected ?? range.start);
      }
    } finally {
      loading = false;
      $('riwaya').disabled = false;
      $('surah').disabled = false;
    }
  }

  async function refreshTajweed() {
    const active = session;
    const supported = active.riwaya === 'hafs' && canHighlight;
    $('tajweed').disabled = !supported;
    $('tajweed').checked = supported && Boolean(preferences.tajweed);
    $('tajweed-note').textContent = active.riwaya === 'warsh' ? 'تلوين التجويد متاح لحفص حالياً.'
      : !canHighlight ? 'عرض التلوين غير مدعوم في إصدار محرّك العرض هذا.' : '';
    try {
      if ($('tajweed').checked) await load('tajweed');
      if (active === session) notify();
    } catch (error) {
      if (active !== session) return;
      $('tajweed').checked = false;
      notify(error.message);
    }
  }

  async function start(kind, opener) {
    if (session || reader.open) return;
    const active = session = { kind, opener, drafts: new Map() };
    $('title').textContent = kind === 'hifz' ? 'مصحف الحفظ والمراجعة' : 'مصحف الورد';
    $('settings').open = false;
    $('range').textContent = '';
    $('bookmark').textContent = '';
    $('page-number').textContent = '';
    $('previous').disabled = true;
    $('next').disabled = true;
    $('complete').disabled = true;
    $('complete').querySelector('span').textContent = kind === 'hifz' ? 'أتممت ورد الحفظ والمراجعة' : 'أتممت ورد القراءة';
    $('riwaya').disabled = true;
    $('surah').disabled = true;
    $('tajweed').disabled = true;
    book.replaceChildren();
    const theme = ['paper', 'night', 'app'].includes(preferences.theme) ? preferences.theme : 'paper';
    reader.dataset.paper = $('theme').value = theme;
    updateTajweedPalette();
    updateTranslationControls();
    showChrome(true);
    reader.showModal();
    notify('جارٍ فتح الورد…');
    try {
      const status = await window.migrateQuranBookmarks(await window.mihrabApi.getQuranStatus());
      if (active !== session) return;
      active.assignment = status[kind + 'Summary'];
      active.bookmark = status.settings?.[kind]?.bookmark || null;
      await setEdition(status.riwaya);
      if (active === session) $('complete').disabled = false;
    } catch (error) {
      if (active === session) notify(error.message);
    }
  }

  function leave() {
    if (updating) return;
    closeAnnotation();
    $('settings').open = false;
    if (session?.drafts.size) {
      if (!confirmation.open) confirmation.showModal();
    } else reader.close();
  }

  async function saveMark(riwaya, { index, rangeStart, rangeEnd, spreadStart }) {
    const ref = QuranReaderModel.reference(data[riwaya].surahs, index);
    const status = await window.mihrabApi.saveQuranBookmark(session.kind, {
      ...ref, riwaya, rangeStart, rangeEnd, spreadStart,
    });
    session.bookmark = status.settings[session.kind].bookmark;
    publish(status);
  }

  function closeAnnotation() {
    annotation.hidden = true;
    actionVerse = null;
  }

  function showAnnotation(verse, pointer) {
    const rectangles = [...verse.getClientRects()];
    const rect = rectangles.find(box => pointer.clientY >= box.top && pointer.clientY <= box.bottom) || rectangles[0];
    if (!rect) return;
    actionVerse = verse;
    annotationTranslation.hidden = !currentTranslation();
    annotation.hidden = false;
    const width = annotation.offsetWidth;
    const height = annotation.offsetHeight;
    const left = Math.max(8, Math.min(reader.clientWidth - width - 8, (rect.left + rect.right - width) / 2));
    const top = Math.max(8, Math.min(reader.clientHeight - height - 8,
      rect.top >= height + 10 ? rect.top - height - 6 : rect.bottom + 6));
    Object.assign(annotation.style, { left: left + 'px', top: top + 'px' });
    if (pointer.detail === 0) annotationSave.focus({ preventScroll: true });
  }

  function updateTajweedPalette() {
    const rgb = getComputedStyle(reader).color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    const brightInk = rgb?.length === 3 && rgb[0] * .213 + rgb[1] * .715 + rgb[2] * .072 > 138;
    reader.dataset.tajweedTone = brightInk ? 'bright' : 'deep';
  }

  async function saveAndLeave() {
    if (updating) return;
    updating = true;
    try {
      const draft = session.drafts.get(session.riwaya);
      const latest = draft ? [session.riwaya, draft] : [...session.drafts].at(-1);
      if (latest) await saveMark(...latest);
      confirmation.close();
      reader.close();
    } catch {
      $('exit-error').textContent = 'تعذر حفظ الموضع على هذا الجهاز. يمكنك البقاء في المصحف أو الخروج دون حفظ.';
    } finally {
      updating = false;
    }
  }

  $('complete').addEventListener('click', async () => {
    if (updating || loading || !session?.assignment) return;
    updating = true;
    $('complete').disabled = true;
    try {
      const { unit, startNumber, endNumber, riwaya } = session.assignment;
      const updated = await window.mihrabApi.advanceQuranProgress(session.kind, { unit, startNumber, endNumber, riwaya });
      reader.close();
      publish(updated);
      window.showSuccessFeedback?.('تم إتمام الورد وتحديث نطاق المتابعة.');
    } catch (error) {
      notify(error.message || 'تعذّر إتمام الورد.');
    } finally {
      updating = false;
      $('complete').disabled = false;
    }
  });

  const translationCard = $('translation-card');
  const viewport = book.parentElement;
  const translationLanguages = new Set(['en', 'id', 'ur', 'bn', 'fr', 'tr']);
  const translationLanguage = () => translationLanguages.has(preferences.translationLanguage)
    ? preferences.translationLanguage : 'en';
  const translationKey = () => 'translation-' + translationLanguage();
  const ui = (key, fallback) => window.mihrabLocale.has(key) ? window.mihrabLocale.t(key) : fallback;
  let translationRequest = 0;
  let viewChange = 0;
  let hold = null;
  let suppressClick = null;
  let scrollFrame = 0;

  function currentTranslation() {
    return session?.riwaya === 'hafs' && preferences.translationEnabled ? data[translationKey()] : null;
  }

  function verticalReading() {
    return Boolean(currentTranslation() && preferences.translationView === 'vertical');
  }

  function closeTranslation() {
    translationCard.hidden = true;
    translationCard.replaceChildren();
  }

  function updateTranslationControls() {
    const supported = session?.riwaya === 'hafs';
    $('translation-enabled').disabled = !supported;
    $('translation-enabled').checked = supported && Boolean(preferences.translationEnabled);
    $('translation-language').disabled = !supported || !preferences.translationEnabled;
    $('translation-language').value = translationLanguage();
    customSelects.get($('translation-language'))?.sync();
    $('translation-note').hidden = supported || !session?.riwaya;
    const mode = $('view-mode');
    mode.disabled = !currentTranslation();
    mode.setAttribute('aria-pressed', String(verticalReading()));
    const label = verticalReading()
      ? ui('reader.translationPages', 'عرض الصفحات')
      : ui('reader.translationVertical', 'عرض الآيات والترجمة عموديًا');
    mode.title = label;
    mode.setAttribute('aria-label', label);
    reader.dataset.translationView = verticalReading() ? 'vertical' : 'pages';
  }

  async function loadTranslation() {
    const request = ++translationRequest;
    const active = session;
    if (active?.riwaya !== 'hafs' || !preferences.translationEnabled) return;
    try {
      await load(translationKey());
      if (active === session && request === translationRequest) notify();
    } catch {
      if (active === session && request === translationRequest)
        notify(ui('reader.translationLoadFailed', 'تعذر فتح ملف الترجمة المحلي.'));
    }
  }

  function translationContent(index) {
    const pack = currentTranslation();
    const ref = QuranReaderModel.reference(session.range.surahs, index);
    const row = ref && pack?.surahs[ref.surah - 1]?.[ref.ayah - 1];
    if (!row) return document.createDocumentFragment();
    const content = document.createElement('div');
    content.className = 'quran-translation-content';
    const paragraph = document.createElement('p');
    paragraph.lang = translationLanguage();
    paragraph.dir = translationLanguage() === 'ur' ? 'rtl' : 'ltr';
    paragraph.setAttribute('data-no-ui-translation', '');
    paragraph.textContent = row[0];
    content.append(paragraph);
    if (row[1]) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = ui('reader.translationNotes', 'الحواشي');
      const notes = document.createElement('p');
      notes.lang = translationLanguage();
      notes.dir = paragraph.dir;
      notes.setAttribute('data-no-ui-translation', '');
      notes.textContent = row[1];
      details.append(summary, notes);
      content.append(details);
    }
    return content;
  }

  function translationSource(pack) {
    const source = document.createElement('small');
    source.className = 'quran-translation-source';
    source.textContent = ui('reader.translationSourceLabel', 'المصدر') + ' · ';
    const link = document.createElement('a');
    link.href = pack.url;
    link.setAttribute('data-no-ui-translation', '');
    link.textContent = pack.credit + ' · QuranEnc · ' + pack.version;
    link.addEventListener('click', event => {
      event.preventDefault();
      window.mihrabApi.openExternalUrl(pack.url).catch(() => {});
    });
    source.append(link);
    return source;
  }

  function showTranslation(verse) {
    if (!currentTranslation() || !verse.isConnected) return;
    translationCard.replaceChildren(translationContent(Number(verse.dataset.verse)));
    translationCard.hidden = false;
    const rect = verse.getBoundingClientRect();
    const width = translationCard.offsetWidth;
    const height = translationCard.offsetHeight;
    translationCard.style.left = Math.max(8, Math.min(innerWidth - width - 8, rect.left)) + 'px';
    translationCard.style.top = Math.max(8, Math.min(innerHeight - height - 8,
      rect.bottom + height + 8 <= innerHeight ? rect.bottom + 8 : rect.top - height - 8)) + 'px';
  }

  function verticalAnchor() {
    const rows = book.querySelectorAll('.quran-translation-row');
    if (!rows.length) return session?.viewStart;
    const top = viewport.getBoundingClientRect().top + 6;
    let low = 0, high = rows.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (rows[mid].getBoundingClientRect().bottom <= top) low = mid + 1;
      else high = mid;
    }
    return Number(rows[low].dataset.index);
  }

  function renderVertical(anchor) {
    const { start, end, surahs } = session.range;
    const fragment = document.createDocumentFragment();
    fragment.append(translationSource(currentTranslation()));
    for (const surah of surahs) {
      for (let index = Math.max(start, surah.start); index <= Math.min(end, surah.end); index++) {
        const row = document.createElement('article');
        row.className = 'quran-translation-row';
        row.dataset.index = String(index);
        const verse = document.createElement('button');
        verse.type = 'button';
        verse.className = 'quran-reader-verse quran-translation-verse';
        verse.dataset.verse = String(index);
        verse.dataset.surah = String(surah.number);
        verse.dir = 'rtl';
        verse.lang = 'ar';
        verse.setAttribute('data-no-ui-translation', '');
        verse.textContent = session.corpus.verses[index];
        row.append(verse, translationContent(index));
        fragment.append(row);
      }
    }
    book.replaceChildren(fragment);
    session.viewStart = start;
    session.viewEnd = end;
    $('previous').hidden = $('next').hidden = true;
    $('page-number').textContent = '';
    refreshSelection();
    jumpVertical(anchor ?? start);
    applyHighlights();
  }

  function jumpVertical(index) {
    const row = book.querySelector('.quran-translation-row[data-index="' + index + '"]');
    const sourceHeight = book.firstElementChild?.offsetHeight || 0;
    if (row) viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - sourceHeight;
    const ref = QuranReaderModel.reference(session.range.surahs, index);
    if (ref) $('surah').value = ref.surah;
    customSelects.get($('surah'))?.sync();
  }

  async function changeTranslation(patch) {
    if (!session?.range || loading || updating) return;
    const active = session;
    const revision = ++viewChange;
    const anchor = verticalReading() ? verticalAnchor() : session.viewStart;
    closeTranslation();
    try {
      persist({ ...preferences, ...patch });
      await loadTranslation();
      if (active !== session || revision !== viewChange) return;
      session.viewStart = anchor ?? session.range.start;
      render(session.viewStart);
    } catch {
      notify(ui('reader.translationSaveFailed', 'تعذر حفظ إعدادات الترجمة.'));
      updateTranslationControls();
    }
  }

  $('translation-enabled').addEventListener('change', event => {
    changeTranslation({ translationEnabled: event.target.checked });
  });
  $('translation-language').addEventListener('change', event => {
    changeTranslation({ translationLanguage: event.target.value });
  });
  $('view-mode').addEventListener('click', () => {
    changeTranslation({ translationView: verticalReading() ? 'pages' : 'vertical' });
  });
  window.addEventListener('mihrab:interface-language-changed', () => {
    if (!reader.open) return;
    closeTranslation();
    updateTranslationControls();
  });
  viewport.addEventListener('scroll', () => {
    if (!verticalReading() || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!verticalReading()) return;
      const ref = QuranReaderModel.reference(session.range.surahs, verticalAnchor());
      if (ref && $('surah').value !== String(ref.surah)) {
        $('surah').value = ref.surah;
        customSelects.get($('surah'))?.sync();
      }
    });
  }, { passive: true });

  function cancelHold() {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  }
  book.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || loading || updating) return;
    const verse = event.target.closest('[data-verse]');
    if (!verse) return;
    cancelHold();
    suppressClick = null;
    hold = { id: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      if (!verse.isConnected) return;
      suppressClick = { verse, until: performance.now() + 1200 };
      closeTranslation();
      showAnnotation(verse, event);
    }, 520) };
  });
  reader.addEventListener('pointermove', event => {
    if (hold?.id === event.pointerId && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 10)
      cancelHold();
  });
  for (const type of ['pointerup', 'pointercancel']) reader.addEventListener(type, cancelHold);
  book.addEventListener('contextmenu', event => {
    if (hold || suppressClick?.until > performance.now()) event.preventDefault();
  });
  reader.addEventListener('pointerdown', event => {
    if (!translationCard.contains(event.target)) closeTranslation();
  }, true);

  document.querySelectorAll('[data-open-quran-reader]').forEach(button => {
    button.addEventListener('click', () => start(button.dataset.openQuranReader, button));
  });
  viewport.addEventListener('click', event => {
    if (suppressClick?.until > performance.now()) {
      suppressClick = null;
      return;
    }
    closeAnnotation();
    showChrome(reader.hasAttribute('data-hide-chrome'));
  });
  annotationTranslation.addEventListener('click', () => {
    const verse = actionVerse;
    closeAnnotation();
    if (verse) showTranslation(verse);
  });
  annotationSave.addEventListener('click', async () => {
    if (updating || !session?.riwaya || !actionVerse) return;
    session.selected = Number(actionVerse.dataset.verse);
    if (session.selected !== session.saved) session.drafts.set(session.riwaya, currentMark(session.selected));
    refreshSelection();
    updating = true;
    try {
      await saveMark(session.riwaya, currentMark(session.selected));
      session.saved = session.selected;
      session.drafts.delete(session.riwaya);
      closeAnnotation();
      refreshSelection();
      book.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    } catch {
      notify('تعذر حفظ الموضع على هذا الجهاز.');
    } finally {
      updating = false;
    }
  });
  reader.addEventListener('pointerdown', event => {
    if (!event.target.closest('[data-verse], #quran-reader-annotation')) closeAnnotation();
    const settings = $('settings');
    if (!settings.contains(event.target)) settings.open = false;
  });
  book.addEventListener('keydown', event => {
    if (event.repeat || ![' ', 'Enter'].includes(event.key) || !event.target.matches('[data-verse]')) return;
    event.preventDefault();
    showAnnotation(event.target, { detail: 0 });
  });
  if (typeof bindReadingSwipe === 'function') bindReadingSwipe(book, {
    preview: direction => {
      const target = turnTarget(direction);
      if (!target) return null;
      const preview = book.cloneNode(false);
      preview.removeAttribute('id');
      preview.append(takeAdjacentPaper(target) || makePaper(target));
      return preview;
    },
    getPanel: () => reader.open && session?.range && !loading && !verticalReading() ? book : null,
    canTurn: direction => reader.open && !confirmation.open && !loading && !updating &&
      !$(direction > 0 ? 'next' : 'previous').disabled,
    turn: (direction, preview) => turn(direction, true, preview?.firstElementChild),
  });
  $('previous').addEventListener('click', () => turn(-1));
  $('next').addEventListener('click', () => turn(1));
  $('surah').addEventListener('change', event => {
    const surah = session.range.surahs.find(row => row.number === Number(event.target.value));
    if (surah) goToVerse(Math.max(surah.start, session.range.start));
  });
  $('riwaya').addEventListener('change', async event => {
    if (!session?.assignment) return;
    const edition = event.target.value;
    try { await setEdition(edition); }
    catch (error) {
      if (!session) return;
      $('riwaya').value = session.riwaya;
      notify(error.message);
    }
  });
  $('theme').addEventListener('change', event => {
    const theme = event.target.value;
    reader.dataset.paper = theme;
    updateTajweedPalette();
    if (session?.range) { syncLegend(); applyHighlights(); }
    try { persist({ ...preferences, theme }); } catch { notify('تعذر حفظ مظهر المصحف.'); }
  });
  $('tajweed').addEventListener('change', async event => {
    const active = session;
    const tajweed = event.target.checked;
    try {
      if (tajweed) await load('tajweed');
      if (active !== session || active.riwaya !== 'hafs' || event.target.checked !== tajweed) return;
      persist({ ...preferences, tajweed });
      if (session.viewStart != null) render();
      notify();
    } catch {
      if (active !== session) return;
      event.target.checked = Boolean(preferences.tajweed);
      notify('تعذر تغيير إعداد التلوين.');
    }
  });
  let resizeTimer, resizeIdle, resizePending = false;
  const reflow = () => {
    resizePending = false;
    if (!reader.open || !session?.range || loading || session.viewStart == null || verticalReading()) return;
    const size = [book.clientWidth, book.clientHeight].join(':');
    if (size === measuredSize) return;
    measuredSize = size;
    session.pageSizes.clear();
    session.meanTypeSize = null;
    const anchor = session.selected != null && session.selected >= session.viewStart && session.selected <= session.viewEnd
      ? session.selected : session.viewStart;
    if (anchor === session.viewStart) render();
    else resumeSpread(anchor);
  };
  const header = reader.querySelector('.quran-reader-header');
  new ResizeObserver(() => {
    reader.style.setProperty('--reader-header-height', header.offsetHeight + 'px');
  }).observe(header);
  function debounceReflow() {
    if (!reader.open || !session?.range || verticalReading()) return;
    if (!resizePending && [book.clientWidth, book.clientHeight].join(':') === measuredSize) return;
    resizePending = true;
    useWordEstimate = true;
    ++previewGeneration;
    adjacentPapers.clear();
    clearTimeout(resizeTimer);
    if (resizeIdle !== undefined) window.cancelIdleCallback?.(resizeIdle);
    resizeTimer = setTimeout(() => {
      if (window.requestIdleCallback) resizeIdle = requestIdleCallback(reflow);
      else reflow();
    }, 400);
  }
  const observer = new ResizeObserver(debounceReflow);
  observer.observe(book);
  window.addEventListener('resize', debounceReflow);
  $('exit').addEventListener('click', leave);
  reader.addEventListener('cancel', event => { event.preventDefault(); leave(); });
  $('stay').addEventListener('click', () => confirmation.close());
  $('discard').addEventListener('click', () => {
    if (!updating) { confirmation.close(); reader.close(); }
  });
  $('save').addEventListener('click', saveAndLeave);
  confirmation.addEventListener('close', () => { $('exit-error').textContent = ''; });
  reader.addEventListener('close', () => {
    clearHighlights();
    closeTranslation();
    cancelHold();
    suppressClick = null;
    const opener = session?.opener;
    clearTimeout(resizeTimer);
    if (resizeIdle !== undefined) window.cancelIdleCallback?.(resizeIdle);
    resizePending = false;
    ++previewGeneration;
    adjacentPapers.clear();
    session = null;
    useWordEstimate = false;
    measuredSize = '';
    $('legend').hidden = true;
    closeAnnotation();
    book.replaceChildren();
    opener?.focus();
  });
  for (const link of document.querySelectorAll('[data-quran-translation-source]')) {
    link.addEventListener('click', event => {
      event.preventDefault();
      window.mihrabApi.openExternalUrl(link.href).catch(() => {});
    });
  }
})();

