import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { NF_SHELL, NF_STATES } from '../data/newFlowHtml.js';
import '../styles/newflow-extra.css';
import '../styles/newflow-production.css';

/**
 * First-part flow on the NEW production chrome (Aug 18 2026 capture).
 *
 * Architecture (round 2, after Julia's interactivity feedback):
 * - Each route renders a BASE PAGE (captured <main>) + optionally a MODAL
 *   overlay (captured body-tail fragment). Opening a modal never swaps the
 *   page behind it.
 * - A live-interaction layer (enhance*) attaches real behavior by mutating
 *   the captured DOM directly: product selection, variant chips, the sets
 *   builder (data-driven from LIVE.sets), who-gets menus, steppers, tier
 *   cards, inline brief editing. Templates are lifted at runtime from the
 *   captured states themselves, so every pixel stays production.
 * - The router click-handler only handles NAVIGATION; interactive elements
 *   stop propagation in their own listeners.
 */

/* ---------------- captured-fragment helpers ---------------- */

const parseCache = new Map();
function frag(stateKey, part = 'main') {
  const cacheKey = stateKey + ':' + part;
  if (!parseCache.has(cacheKey)) {
    const html = (NF_STATES[stateKey] || {})[part] || '';
    const doc = new DOMParser().parseFromString('<div id="__w">' + html + '</div>', 'text/html');
    parseCache.set(cacheKey, doc.getElementById('__w'));
  }
  return parseCache.get(cacheKey);
}
const pick = (stateKey, sel, part = 'main') => frag(stateKey, part).querySelector(sel);
const pickAll = (stateKey, sel, part = 'main') => [...frag(stateKey, part).querySelectorAll(sel)];

/* ---------------- live prototype state (module-level, survives navigation) ---------------- */

function seedProducts(stateKey, setIndex = 0) {
  const cards = pickAll(stateKey, '.product-set-card');
  const card = cards[setIndex];
  if (!card) return [];
  return [...card.querySelectorAll('.product-set-card__product-entry')].map((e) => ({
    name: (e.querySelector('strong, .product-set-card__product-name') || e).textContent.trim().replace(/\$\d+.*/, '').trim(),
    html: e.outerHTML,
  }));
}

const LIVE = {
  sets: null,          // [{mode:'all'|'choose', pick:1, products:[{name, html}]}]
  addTarget: 0,        // which set an open Add Products modal fills
  modalSel: null,      // Map(name -> {variants}) while the add modal is open
  gridSel: new Map(),  // simple-grid selection
  variantSel: {},      // productName -> Set(active values)
  optionsFor: null,    // product ctx while the options modal is open {name, price, img, from}
  tier: 0,
  count: 10,
  briefEdits: {},      // data-edit-section -> edited text (kept across toggles)
};

function ensureSets(alias) {
  if (LIVE.sets) return;
  if (alias === 'adv-set1') {
    LIVE.sets = [{ mode: 'all', pick: 1, products: seedProducts('11-advanced-set1-populated', 0) }];
  } else if (alias === 'adv-2sets') {
    LIVE.sets = [
      { mode: 'all', pick: 1, products: seedProducts('13-advanced-2sets-choose-pickcount', 0) },
      { mode: 'choose', pick: 1, products: seedProducts('13-advanced-2sets-choose-pickcount', 1) },
    ];
  } else {
    LIVE.sets = [{ mode: 'all', pick: 1, products: [] }];
  }
}

/* Variant data. Sunlit + Moonmilk are the real production option sets; the
   rest are plausible demo values (production's demo catalog wasn't walked
   product-by-product — flagged for a later capture pass if needed). */
const VARIANTS = {
  'Sunlit Skin Tint SPF 40': { group: 'Shade', values: ['Fair', 'Light', 'Medium', 'Deep'], unavailable: ['Deep'] },
  'Moonmilk Lip Treatment': { group: 'Tint', values: ['Clear', 'Rose', 'Cocoa'] },
  'Riviera Linen Blazer': { group: 'Size', values: ['XS', 'S', 'M', 'L', 'XL'] },
  'Column Knit Dress': { group: 'Size', values: ['XS', 'S', 'M', 'L'] },
  'Studio Silk Scarf': { group: 'Colorway', values: ['Sage', 'Terracotta', 'Slate'] },
  'Sculpt Mini Shoulder Bag': { group: 'Color', values: ['Butter', 'Espresso', 'Crimson'] },
};
const hasVariants = (name) => !!VARIANTS[name];

/* ---------------- screens ---------------- */

const PAGES = {
  overview: '01-campaigns-overview',
  'overview-completed': '20-campaigns-overview-completed-tab',
  'overview-after': '26-overview-after-launch',
  step1: '02-create-step1-intro',
  step2: '03-create-step2-setup',
  step3: '04-create-step3-products',
  adv: '05-create-advanced-default',
  'adv-set1': '05-create-advanced-default',
  'adv-2sets': '05-create-advanced-default',
  'adv-who': '05-create-advanced-default',
  brief: '15-brief-review-full',
  'brief-edit-about': '15-brief-review-full',
  'brief-edit-note': '15-brief-review-full',
  'draft-resume': '21-draft-resume-92',
  match: '18-find-creators-prefs',
  'match-how': '19-find-creators-howwork-open',
  'launch-t0': '22-launch-t0',
  launched: '23-launch-t1',
  'launched-content': '25-launched-content-tab',
  generating: null,
};
// modal overlay routes -> which captured tail supplies the overlay
const MODALS = {
  'm-add': '07-addproducts-modal',
  'm-add2': '08-addproducts-2selected',
  'm-opts': '09-available-options-modal',
  'm-add3': '10-addproducts-3selected-variantpill',
  'm-add-dim': '12-addproducts-alreadyinset',
};
const ADV_FAMILY = new Set(['adv', 'adv-set1', 'adv-2sets', 'adv-who']);
const LAUNCHED_FAMILY = new Set(['launched', 'launched-content', 'overview-after', 'launch-t0']);

/* ---------------- generic DOM helpers ---------------- */

function on(el, fn) {
  if (!el || el.__nfWired) return;
  el.__nfWired = true;
  el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(e); });
}

const CHECK_ICON = () =>
  pick('08-addproducts-2selected', '.product-selection-indicator--selected', 'modal')?.innerHTML || '';

function setCardSelected(card, selected, summaryText) {
  card.classList.toggle('selected', selected);
  card.setAttribute('aria-pressed', selected ? 'true' : 'false');
  const ind = card.querySelector('.product-selection-indicator');
  if (ind) {
    ind.classList.toggle('product-selection-indicator--selected', selected);
    ind.classList.toggle('product-selection-indicator--idle', !selected);
    ind.innerHTML = selected ? CHECK_ICON() : '';
  }
  const summary = card.querySelector('.product-card-variant-summary');
  if (summary && summaryText !== undefined) summary.textContent = summaryText;
}

function cardInfo(card) {
  return {
    name: card.querySelector('.product-card-copy strong')?.textContent.trim() || '',
    price: card.querySelector('.product-card-price span')?.textContent.trim() || '',
    img: card.querySelector('.product-card-media img')?.getAttribute('src') || '',
  };
}

function variantSummary(name) {
  const v = VARIANTS[name];
  const sel = LIVE.variantSel[name];
  if (!v) return undefined;
  const available = v.values.filter((x) => !(v.unavailable || []).includes(x));
  const n = sel ? sel.size : available.length;
  return n >= available.length ? 'All variants' : `${n} variant${n === 1 ? '' : 's'}`;
}

/* ================= enhancement layers ================= */

/* ---- product pickers (step3 grid + add-products modal) ---- */
function enhancePicker(root, ctx, api) {
  // selection model for this surface
  const sel = ctx.sel;
  root.querySelectorAll('.product-card').forEach((card) => {
    const { name } = cardInfo(card);
    if (ctx.already && ctx.already.has(name)) {
      // production's "Already in another set" treatment, lifted from capture 12
      if (!card.textContent.includes('Already in another set')) {
        const dimTpl = [...frag('12-addproducts-alreadyinset', 'modal').querySelectorAll('.product-card')]
          .find((c) => c.textContent.includes('Already in another set'));
        if (dimTpl) {
          card.className = dimTpl.className;
          const flag = [...dimTpl.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === 'Already in another set');
          const media = card.querySelector('.product-card-media');
          if (flag && media) media.appendChild(flag.cloneNode(true));
          card.setAttribute('disabled', '');
        }
      }
      return;
    }
    setCardSelected(card, sel.has(name), sel.has(name) ? variantSummary(name) : hasVariants(name) ? 'Choose options' : undefined);
    on(card, () => {
      if (hasVariants(name) && !sel.has(name)) {
        api.openOptions(cardInfo(card), ctx.kind);
        return;
      }
      if (sel.has(name)) { sel.delete(name); delete LIVE.variantSel[name]; }
      else sel.set(name, {});
      setCardSelected(card, sel.has(name), sel.has(name) ? variantSummary(name) : hasVariants(name) ? 'Choose options' : undefined);
      syncPickerFooter(root, ctx);
    });
  });
  syncPickerFooter(root, ctx);
}

function syncPickerFooter(root, ctx) {
  const n = ctx.sel.size;
  // footer count ("0 selected") — same markup on grid + modal
  const count = [...root.querySelectorAll('span, strong, div')].find((el) =>
    el.children.length === 0 && /^\d+ selected$/.test(el.textContent.trim())
  );
  if (count) count.textContent = `${n} selected`;
  // Clear link next to the count appears once something is selected in production;
  // keep whatever the capture has and just wire it if present.
  const clear = [...root.querySelectorAll('button, a')].find((el) => el.textContent.trim() === 'Clear');
  if (clear) on(clear, () => { ctx.sel.clear(); enhancePicker(root, ctx, ctx.api); });
  const cta = [...root.querySelectorAll('button')].find((el) => {
    const t = el.textContent.trim();
    return ctx.kind === 'grid' ? t.includes('Create My Campaign') : t === 'Add';
  });
  if (cta) {
    cta.disabled = n === 0;
    if (n > 0) cta.removeAttribute('disabled');
    else cta.setAttribute('disabled', '');
  }
}

/* ---- options modal (variant chips) ---- */
function buildOptionsOverlay(product) {
  // template: the Sunlit "Available options" dialog (the TOP modal of capture 09's stack)
  const wraps = pickAll('09-available-options-modal', '.brand-portal-modal', 'modal');
  const tpl = wraps[wraps.length - 1];
  const node = tpl.cloneNode(true);
  // populate product identity
  const img = node.querySelector('.brand-portal-modal__content img');
  if (img) { img.src = product.img; img.alt = product.name; }
  const title = [...node.querySelectorAll('h1,h2,h3,strong,p')].find((el) => el.textContent.trim() === 'Sunlit Skin Tint SPF 40');
  if (title) title.textContent = product.name;
  const price = [...node.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === '$38');
  if (price) price.textContent = product.price;
  // rebuild the option group
  const v = VARIANTS[product.name] || { group: 'Options', values: ['Default'] };
  const group = node.querySelector('.variant-option-group');
  if (group) {
    const legend = group.querySelector('legend');
    if (legend) legend.textContent = v.group;
    const valuesWrap = group.querySelector('.variant-option-group__values');
    const activeTpl = valuesWrap.querySelector('.variant-option-chip.active');
    const disabledTpl = [...valuesWrap.querySelectorAll('.variant-option-chip')].find((c) => !c.classList.contains('active'));
    valuesWrap.innerHTML = '';
    const current = LIVE.variantSel[product.name];
    v.values.forEach((val) => {
      const un = (v.unavailable || []).includes(val);
      const chip = (un && disabledTpl ? disabledTpl : activeTpl).cloneNode(true);
      const label = [...chip.querySelectorAll('span')].find((s) => !s.className.includes('__check'));
      if (label) label.textContent = val;
      chip.title = val;
      const isActive = !un && (current ? current.has(val) : true);
      chip.classList.toggle('active', isActive);
      chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      let checkSpan = chip.querySelector('.variant-option-chip__check');
      if (!isActive && checkSpan) checkSpan.remove();
      if (isActive && !checkSpan) {
        const src = activeTpl.querySelector('.variant-option-chip__check');
        if (src) chip.insertBefore(src.cloneNode(true), chip.firstChild);
      }
      valuesWrap.appendChild(chip);
    });
  }
  return node;
}

function enhanceOptionsOverlay(node, product, api) {
  const v = VARIANTS[product.name] || { values: [] };
  if (!LIVE.variantSel[product.name]) {
    LIVE.variantSel[product.name] = new Set(v.values.filter((x) => !(v.unavailable || []).includes(x)));
  }
  const set = LIVE.variantSel[product.name];
  node.querySelectorAll('.variant-option-chip').forEach((chip) => {
    const val = chip.title;
    if ((v.unavailable || []).includes(val)) return;
    on(chip, () => {
      const isActive = set.has(val);
      if (isActive && set.size === 1) return; // production keeps ≥1 option
      if (isActive) set.delete(val); else set.add(val);
      chip.classList.toggle('active', !isActive);
      chip.setAttribute('aria-pressed', !isActive ? 'true' : 'false');
      let check = chip.querySelector('.variant-option-chip__check');
      if (isActive && check) check.remove();
      if (!isActive && !check) {
        const src = node.querySelector('.variant-option-chip.active .variant-option-chip__check') || pick('09-available-options-modal', '.variant-option-chip__check', 'modal');
        if (src) chip.insertBefore(src.cloneNode(true), chip.firstChild);
      }
    });
  });
  [...node.querySelectorAll('button')].forEach((b) => {
    const t = b.textContent.trim();
    if (t === 'Add to campaign') on(b, () => api.commitOptions(product));
    else if (t === 'Cancel' || b.getAttribute('aria-label') === 'Close') on(b, () => api.closeOptions());
  });
}

/* ---- advanced options: data-driven sets builder ---- */
function renderSets(root) {
  const list = root.querySelector('.product-set-card')?.parentElement;
  if (!list) return;
  const emptyTpl = pick('05-create-advanced-default', '.product-set-card');
  const fullTpl = pick('11-advanced-set1-populated', '.product-set-card');
  const chooseBtnTpl = pickAll('13-advanced-2sets-choose-pickcount', '.product-set-mode-select')[1];
  const allBtnTpl = pick('05-create-advanced-default', '.product-set-mode-select');
  const ruleTpl = pick('13-advanced-2sets-choose-pickcount', '.product-set-card__choice-rule');
  const menuTpl = pick('06-create-advanced-whogets-open', '.product-set-mode-select__menu');

  // wipe current set cards (keep the "New Product Set" button + siblings after)
  [...list.querySelectorAll(':scope > .product-set-card, :scope > [class*="product-set-card"]')]
    .filter((el) => el.classList.contains('product-set-card'))
    .forEach((el) => el.remove());
  const anchor = [...list.children].find((el) => el.textContent.trim().includes('New Product Set')) || null;

  LIVE.sets.forEach((set, i) => {
    const card = (set.products.length ? fullTpl : emptyTpl).cloneNode(true);
    const title = card.querySelector('h1,h2,h3,strong,[class*="__title"]');
    if (title && /Product Set/.test(title.textContent)) title.textContent = `Product Set ${i + 1}`;

    // mode select button
    const modeHost = card.querySelector('.product-set-mode-select')?.parentElement;
    if (modeHost) {
      const oldBtn = card.querySelector('.product-set-mode-select');
      const btn = (set.mode === 'choose' && chooseBtnTpl ? chooseBtnTpl : allBtnTpl).cloneNode(true);
      btn.querySelector('.product-set-mode-select__chevron')?.classList.remove('product-set-mode-select__chevron--open');
      oldBtn.replaceWith(btn);
      on(btn, () => toggleWhoMenu(root, card, i));
    }

    // choice rule (pick count) for choose mode
    card.querySelector('.product-set-card__choice-rule')?.remove();
    if (set.mode === 'choose' && ruleTpl) {
      const rule = ruleTpl.cloneNode(true);
      const stepSpan = rule.querySelector('.count-stepper > span');
      const [minus, plus] = rule.querySelectorAll('.count-stepper-button');
      const max = Math.max(set.products.length, 1);
      set.pick = Math.min(Math.max(set.pick, 1), max);
      const syncRule = () => {
        stepSpan.textContent = String(set.pick);
        if (set.pick <= 1) minus.setAttribute('disabled', ''); else minus.removeAttribute('disabled');
        if (set.pick >= max) plus.setAttribute('disabled', ''); else plus.removeAttribute('disabled');
      };
      on(minus, () => { if (set.pick > 1) { set.pick--; syncRule(); syncRail(root); } });
      on(plus, () => { if (set.pick < max) { set.pick++; syncRule(); syncRail(root); } });
      syncRule();
      const header = card.querySelector('header') || card.firstElementChild;
      header.after(rule);
    }

    // product entries
    const productsWrap = card.querySelector('.product-set-card__products');
    if (productsWrap) {
      const addTile = [...productsWrap.children].find((el) => el.textContent.trim().includes('Add Products'));
      [...productsWrap.querySelectorAll('.product-set-card__product-entry')].forEach((el) => el.remove());
      set.products.forEach((p) => {
        const tmp = document.createElement('div');
        tmp.innerHTML = p.html;
        const entry = tmp.firstElementChild;
        const x = entry.querySelector('button[aria-label*="Remove"], .product-set-card__product-remove, button');
        if (x) on(x, () => { set.products = set.products.filter((q) => q !== p); renderSets(root); });
        productsWrap.insertBefore(entry, addTile || null);
      });
      const addBtn = addTile?.querySelector('button') || addTile;
      if (addBtn) on(addBtn, () => nfNav.openAddModal(i));
    } else {
      // empty template's Add Products tile
      const addBtn = [...card.querySelectorAll('button, [role="button"], div')].find((el) => el.textContent.trim() === 'Add Products');
      if (addBtn) on(addBtn.closest('button') || addBtn, () => nfNav.openAddModal(i));
    }

    // trash = delete set (keep at least one)
    const trash = card.querySelector('button[aria-label*="elete"], button[aria-label*="emove set"], header button:last-of-type');
    if (trash && trash.textContent.trim() === '') {
      on(trash, () => {
        if (LIVE.sets.length > 1) { LIVE.sets.splice(i, 1); renderSets(root); }
        else { LIVE.sets[0] = { mode: 'all', pick: 1, products: [] }; renderSets(root); }
      });
    }

    list.insertBefore(card, anchor);
  });

  syncRail(root);
}

function toggleWhoMenu(root, card, i) {
  const existing = card.querySelector('.product-set-mode-select__menu');
  root.querySelectorAll('.product-set-mode-select__menu').forEach((m) => m.remove());
  root.querySelectorAll('.product-set-mode-select__chevron--open').forEach((c) => c.classList.remove('product-set-mode-select__chevron--open'));
  if (existing) return; // was open -> now closed
  const menuTpl = pick('06-create-advanced-whogets-open', '.product-set-mode-select__menu');
  if (!menuTpl) return;
  const menu = menuTpl.cloneNode(true);
  const btn = card.querySelector('.product-set-mode-select');
  btn.querySelector('.product-set-mode-select__chevron')?.classList.add('product-set-mode-select__chevron--open');
  btn.parentElement.appendChild(menu);
  // mark the current mode's check
  const items = [...menu.querySelectorAll('[role="menuitem"], button')];
  items.forEach((item) => {
    const isAll = item.textContent.includes('Creators get all');
    const isChoose = item.textContent.includes('Creators choose');
    if (!isAll && !isChoose) return;
    on(item, () => {
      LIVE.sets[i].mode = isChoose ? 'choose' : 'all';
      renderSets(root);
    });
  });
}

function syncRail(root) {
  // Creator's view rail: rebuild rows from LIVE.sets using captured row templates
  const railEmpty = pick('05-create-advanced-default', '[class*="creator-view"], aside, .campaign-creator-view');
  const rowAllTpl = pickAll('11-advanced-set1-populated', '[class*="creator-view"] [class*="row"], [class*="creator-view"] section');
  // Fallback: find the rail container in the live DOM by its heading
  const railHead = [...root.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === "Creator's view");
  if (!railHead) return;
  const rail = railHead.closest('section, aside, div[class*="creator-view"]') || railHead.parentElement;
  // capture templates from states 11 (get-all row) and 13 (choose row)
  const t11 = frag('11-advanced-set1-populated');
  const t13 = frag('13-advanced-2sets-choose-pickcount');
  const findRow = (root2, needle) => [...root2.querySelectorAll('*')].find((el) => el.children.length > 0 && el.querySelector('*') && el.textContent.includes(needle) && el.textContent.length < 400);
  const allRow = findRow(t11, 'Get all');
  const chooseRow = findRow(t13, 'Pick 1 of 1');
  const emptyPreview = pick('05-create-advanced-default', '[class*="empty"], [class*="placeholder"]');

  // container that holds the preview rows = parent of whichever row exists now
  let holder = null;
  const liveRow = [...rail.querySelectorAll('*')].find((el) => /Get all|Pick \d+ of \d+/.test(el.textContent) && el.children.length > 0 && el.textContent.length < 400 && !el.querySelector('h1,h2,h3'));
  if (liveRow) holder = liveRow.parentElement;
  if (!holder) {
    const ph = [...rail.querySelectorAll('*')].find((el) => el.textContent.includes('What creators get will appear here'));
    holder = ph ? ph.parentElement : null;
  }
  if (!holder) return;
  holder.innerHTML = '';
  const anyProducts = LIVE.sets.some((s) => s.products.length);
  if (!anyProducts) {
    if (emptyPreview) holder.appendChild(emptyPreview.cloneNode(true));
    return;
  }
  LIVE.sets.forEach((set) => {
    if (!set.products.length) return;
    const tpl = set.mode === 'choose' ? chooseRow || allRow : allRow;
    if (!tpl) return;
    const row = tpl.cloneNode(true);
    const names = set.products.map((p) => p.name).join(', ');
    const headEl = [...row.querySelectorAll('*')].find((el) => el.children.length === 0 && /Get all|Pick/.test(el.textContent));
    if (headEl) headEl.textContent = set.mode === 'choose' ? `Pick ${set.pick} of ${set.products.length}` : `Get all ${set.products.length}`;
    const nameEl = [...row.querySelectorAll('*')].find((el) => el.children.length === 0 && /Cloudveil|Moonmilk|,/.test(el.textContent));
    if (nameEl) nameEl.textContent = names;
    holder.appendChild(row);
  });
}

/* ---- matching preferences ---- */
function enhanceMatching(root) {
  const tiers = [...root.querySelectorAll('.draft-creator-tier-option')];
  const apply = () => {
    tiers.forEach((b, i) => {
      const selWanted = i === LIVE.tier;
      b.classList.toggle('draft-creator-tier-option--selected', selWanted);
      b.setAttribute('aria-pressed', selWanted ? 'true' : 'false');
      const radio = b.querySelector('.draft-creator-tier-radio');
      if (radio) radio.classList.toggle('draft-creator-tier-radio--selected', selWanted);
    });
  };
  tiers.forEach((b, i) => on(b, () => { LIVE.tier = i; apply(); }));
  apply();

  const stepper = root.querySelector('.count-stepper');
  if (stepper) {
    const span = stepper.querySelector('span');
    const [minus, plus] = stepper.querySelectorAll('.count-stepper-button');
    const helper = root.querySelector('.draft-creator-matching-helper');
    const sync = () => {
      span.textContent = String(LIVE.count);
      if (LIVE.count <= 1) minus.setAttribute('disabled', ''); else minus.removeAttribute('disabled');
      if (LIVE.count >= 10) plus.setAttribute('disabled', ''); else plus.removeAttribute('disabled');
      if (helper) helper.textContent = `We'll recommend up to ${LIVE.count} creators for you to review`;
    };
    on(minus, () => { if (LIVE.count > 1) { LIVE.count--; sync(); } });
    on(plus, () => { if (LIVE.count < 10) { LIVE.count++; sync(); } });
    sync();
  }
}

/* ---- brief inline editing ---- */
function enhanceBrief(root) {
  const editStates = { about: '16-brief-about-editing', note: '17-brief-note-editing' };
  root.querySelectorAll('button').forEach((btn) => {
    const label = btn.textContent.trim();
    if (label !== 'Edit') return;
    on(btn, () => {
      const section = btn.closest('section');
      if (!section) return;
      const key = section.querySelector('[data-edit-section="about"]') ? 'about'
        : section.querySelector('[data-edit-section="note"]') ? 'note' : '';
      const srcState = editStates[key];
      let replacement = null;
      if (srcState) {
        // the edit-state capture has exactly one section carrying a Done button
        replacement = pickAll(srcState, 'section').find((s) =>
          [...s.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Done')
        );
      }
      if (replacement) {
        const node = replacement.cloneNode(true);
        section.replaceWith(node);
        wireEditingSection(root, node, key);
      } else {
        // generic sections: flip the label + make text editable in place
        btn.textContent = 'Done';
        btn.__nfWired = false;
        section.querySelectorAll('p, li, blockquote').forEach((p) => { p.contentEditable = 'true'; });
        on(btn, () => {
          section.querySelectorAll('[contenteditable]').forEach((p) => p.removeAttribute('contenteditable'));
          btn.textContent = 'Edit';
          btn.__nfWired = false;
          enhanceBrief(root);
        });
      }
    });
  });
}

function wireEditingSection(root, node, key) {
  // captured edit-state section: make the editor spans truly editable + wire Done
  node.querySelectorAll('span[style*="font-family"], [contenteditable]').forEach((s) => { s.contentEditable = 'true'; });
  const applyEdits = () => {
    const span = node.querySelector('span[contenteditable]');
    if (span) LIVE.briefEdits[key] = span.textContent;
  };
  [...node.querySelectorAll('button')].forEach((b) => {
    if (b.textContent.trim() === 'Done') {
      on(b, () => {
        applyEdits();
        const viewTpl = pick('15-brief-review-full', `[data-edit-section="${key}"]`);
        if (!viewTpl) return;
        const view = viewTpl.cloneNode(true);
        if (LIVE.briefEdits[key]) {
          const p = view.querySelector('p');
          if (p) p.textContent = LIVE.briefEdits[key];
        }
        node.replaceWith(view);
        enhanceBrief(root);
      });
    }
  });
}

/* ================= the component ================= */

let nfNav = {}; // filled per-render with navigation callbacks (module-level for enhancers)

function Generating({ onDone }) {
  const [lit, setLit] = useState(1);
  useEffect(() => {
    const t1 = setTimeout(() => setLit(2), 900);
    const t2 = setTimeout(() => setLit(3), 1800);
    const t3 = setTimeout(onDone, 2700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);
  return (
    <main className="workspace-content svelte-187rxgr" aria-busy="true" style={{ position: 'relative' }}>
      <div className="nf-generating">
        <div className="nf-dots"><span /><span /><span /></div>
        <p className={'nf-line' + (lit >= 1 ? ' on' : '')}>🔍 Analyzing your products...</p>
        <p className={'nf-line' + (lit >= 2 ? ' on' : '')}>👋 Understanding your brand and category...</p>
        <p className={'nf-line' + (lit >= 3 ? ' on' : '')}>✍️ Drafting your campaign brief...</p>
      </div>
    </main>
  );
}

export default function NewFlow() {
  const navigate = useNavigate();
  const { screen: screenParam } = useParams();
  const screen = PAGES[screenParam] !== undefined || MODALS[screenParam] ? screenParam : 'overview';
  const rootRef = useRef(null);
  const mainRef = useRef(null);
  const overlayRef = useRef(null);
  const [, force] = useState(0);

  const isModal = !!MODALS[screen];
  const pageScreen = isModal ? (LIVE.lastPage && ADV_FAMILY.has(LIVE.lastPage) ? LIVE.lastPage : 'adv') : screen;
  if (!isModal && screen !== 'generating') LIVE.lastPage = screen;
  if (ADV_FAMILY.has(pageScreen)) ensureSets(pageScreen);

  const go = (next) => navigate('/nf/' + next);

  nfNav = {
    go,
    openAddModal: (setIndex) => {
      LIVE.addTarget = setIndex;
      LIVE.modalSel = new Map(LIVE.sets[setIndex].products.map((p) => [p.name, {}]));
      go('m-add');
    },
    openOptions: (product, from) => {
      LIVE.optionsFor = { ...product, from };
      force((x) => x + 1);
    },
    closeOptions: () => { LIVE.optionsFor = null; force((x) => x + 1); },
    commitOptions: (product) => {
      const from = LIVE.optionsFor?.from;
      const sel = from === 'grid' ? LIVE.gridSel : LIVE.modalSel;
      if (sel) sel.set(product.name, { variants: true });
      LIVE.optionsFor = null;
      force((x) => x + 1);
    },
  };

  /* auto-advance transition frame */
  useEffect(() => {
    if (screen !== 'launch-t0') return;
    const t = setTimeout(() => go('launched'), 900);
    return () => clearTimeout(t);
  }, [screen]);

  /* enhancement pass after each render */
  useEffect(() => {
    const rootEl = rootRef.current;
    const mainEl = mainRef.current;
    if (!rootEl || screen === 'generating') return;

    if (ADV_FAMILY.has(pageScreen) && mainEl) renderSets(mainEl);
    if (pageScreen === 'step3' && mainEl) {
      enhancePicker(mainEl, { kind: 'grid', sel: LIVE.gridSel, api: nfNav }, nfNav);
    }
    if ((pageScreen === 'match' || pageScreen === 'match-how') && mainEl) enhanceMatching(mainEl);
    if ((pageScreen === 'brief' || pageScreen === 'draft-resume') && mainEl) enhanceBrief(mainEl);

    const overlayEl = overlayRef.current;
    if (isModal && overlayEl) {
      if (screen.startsWith('m-add')) {
        const already = new Set(
          LIVE.sets.flatMap((s, i) => (i === LIVE.addTarget ? [] : s.products.map((p) => p.name)))
        );
        // strip captured selection state; live layer re-applies from LIVE.modalSel
        enhancePicker(overlayEl, { kind: 'modal', sel: LIVE.modalSel || new Map(), already, api: nfNav }, nfNav);
        [...overlayEl.querySelectorAll('button')].forEach((b) => {
          const t = b.textContent.trim();
          if (t === 'Cancel' || b.getAttribute('aria-label') === 'Cancel adding products') on(b, () => go(pageScreen));
          else if (t === 'Add') on(b, () => {
            const setRef = LIVE.sets[LIVE.addTarget];
            const entryTpl = pick('11-advanced-set1-populated', '.product-set-card__product-entry');
            setRef.products = [...(LIVE.modalSel || new Map()).keys()].map((name) => {
              const kept = setRef.products.find((p) => p.name === name);
              if (kept) return kept;
              // build an entry from the modal card
              const card = [...overlayEl.querySelectorAll('.product-card')].find((c) => cardInfo(c).name === name);
              const info = card ? cardInfo(card) : { name, price: '', img: '' };
              const node = entryTpl.cloneNode(true);
              const nm = node.querySelector('strong, [class*="product-name"]');
              if (nm) nm.textContent = info.name;
              const pr = [...node.querySelectorAll('*')].find((el) => el.children.length === 0 && /^\$\d/.test(el.textContent.trim()));
              if (pr) pr.textContent = info.price;
              const im = node.querySelector('img');
              if (im) { im.src = info.img; im.alt = info.name; }
              const sub = [...node.querySelectorAll('*')].find((el) => el.children.length === 0 && ['Fair', 'Clear'].includes(el.textContent.trim()));
              if (sub) sub.textContent = LIVE.variantSel[name] ? [...LIVE.variantSel[name]][0] || '' : '';
              return { name: info.name, html: node.outerHTML };
            });
            go(pageScreen === 'adv' && setRef.products.length ? 'adv' : pageScreen);
          });
        });
      }
    }
  });

  /* options overlay (built imperatively so it can float over grid OR modal) */
  useEffect(() => {
    const rootEl = rootRef.current;
    if (!rootEl) return;
    rootEl.querySelectorAll('[data-nf-options]').forEach((el) => el.remove());
    if (LIVE.optionsFor) {
      const node = buildOptionsOverlay(LIVE.optionsFor);
      node.setAttribute('data-nf-options', '1');
      rootEl.appendChild(node);
      enhanceOptionsOverlay(node, LIVE.optionsFor, nfNav);
    }
  });

  /* navigation-only click routing */
  const handleClick = (e) => {
    const el = e.target.closest('a, button, [role="tab"], [role="link"]');
    if (!el || !rootRef.current) return;
    if (el.closest('[data-nf-options]')) return; // options overlay handles itself
    e.preventDefault();
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
    const aria = el.getAttribute('aria-label') || '';

    // sidebar / logo
    if (el.closest('aside') || el.closest('.mobile-header')) {
      if (txt === 'Campaigns' || aria.toLowerCase().includes('home')) {
        go(LAUNCHED_FAMILY.has(screen) ? 'overview-after' : 'overview');
      }
      return;
    }

    const NAV = {
      overview: [
        [() => txt === 'Completed', 'overview-completed'],
        [() => txt === 'Launch now', 'step1'],
        [() => txt === 'Finish setup', 'draft-resume'],
        [() => /Open Campaign/i.test(aria), 'launched'],
      ],
      'overview-completed': [[() => txt === 'Active', LIVE.lastPage === 'overview-after' ? 'overview-after' : 'overview']],
      'overview-after': [
        [() => txt === 'Completed', 'overview-completed'],
        [() => /Open Campaign|Cloudveil/i.test(aria), 'launched'],
        [() => txt === 'Finish setup', 'draft-resume'],
      ],
      step1: [
        [() => txt.includes('Get Started'), 'step2'],
        [() => txt.includes('Back to Campaigns'), 'overview'],
      ],
      step2: [
        [() => txt.includes('Choose Your Product'), 'step3'],
        [() => txt === 'Back', 'step1'],
      ],
      step3: [
        [() => txt.includes('See Advanced Options'), 'adv'],
        [() => txt === 'Back', 'step2'],
        [() => txt.includes('Create My Campaign') && !el.disabled, 'generating'],
      ],
      adv: [
        [() => txt.includes('New Product Set'), () => { LIVE.sets.push({ mode: 'all', pick: 1, products: [] }); renderSets(mainRef.current); }],
        [() => txt === 'Clear', () => { LIVE.sets = [{ mode: 'all', pick: 1, products: [] }]; LIVE.variantSel = {}; renderSets(mainRef.current); }],
        [() => txt.includes('Create My Campaign'), 'generating'],
        [() => txt === 'Back', 'step3'],
      ],
      brief: [
        [() => txt.includes('Find Creators'), 'match'],
        [() => txt.includes('Back to Product Selection'), 'adv'],
      ],
      'draft-resume': [
        [() => txt.includes('Find Creators'), 'match'],
        [() => txt.includes('Back to Product Selection'), 'overview'],
      ],
      match: [
        [() => txt.includes('How we find your creators'), 'match-how'],
        [() => txt.includes('Launch Campaign'), 'launch-t0'],
        [() => txt.includes('Back to Campaign Brief'), 'brief'],
      ],
      'match-how': [
        [() => txt.includes('How we find your creators'), 'match'],
        [() => txt.includes('Launch Campaign'), 'launch-t0'],
        [() => txt.includes('Back to Campaign Brief'), 'brief'],
      ],
      launched: [
        [() => txt === 'Content', 'launched-content'],
        [() => txt === 'Campaigns', 'overview-after'],
      ],
      'launched-content': [
        [() => txt === 'Dashboard', 'launched'],
        [() => txt === 'Campaigns', 'overview-after'],
      ],
    };
    NAV['adv-set1'] = NAV.adv;
    NAV['adv-2sets'] = NAV.adv;
    NAV['adv-who'] = NAV.adv;
    NAV['brief-edit-about'] = NAV.brief;
    NAV['brief-edit-note'] = NAV.brief;

    for (const [pred, target] of NAV[isModal ? pageScreen : screen] || []) {
      if (pred()) {
        if (typeof target === 'function') target();
        else go(target);
        return;
      }
    }
  };

  const pageKey = PAGES[pageScreen];
  const state = pageKey ? NF_STATES[pageKey] : null;
  const modalHtml = isModal ? (NF_STATES[MODALS[screen]] || {}).modal : null;

  return (
    <div className="nf" ref={rootRef} onClick={handleClick}>
      <div className="brand-dashboard svelte-187rxgr">
        <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: NF_SHELL.header }} />
        <div className="dashboard-body svelte-187rxgr">
          <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: NF_SHELL.sidebar }} />
          {screen === 'generating' ? (
            <Generating onDone={() => go('brief')} />
          ) : state ? (
            <div ref={mainRef} style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: state.main }} />
          ) : (
            <main className="workspace-content svelte-187rxgr" style={{ padding: 40 }}>Unknown screen: {String(screen)}</main>
          )}
        </div>
        <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: NF_SHELL.backdrop }} />
      </div>
      {modalHtml && (
        <div ref={overlayRef} style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: modalHtml }} />
      )}
    </div>
  );
}
