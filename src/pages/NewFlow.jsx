import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { NF_SHELL, NF_STATES } from '../data/newFlowHtml.js';
import '../styles/newflow-production.css';
import '../styles/newflow-extra.css';

/**
 * First-part flow on the NEW production chrome (Aug 18 2026 capture,
 * captures/sources-aug18/). Every screen is the captured production DOM;
 * clicks are text-matched and drive a state machine over the captured states.
 * /nf/:screen deep-links any state.
 */

const S = (key) => NF_STATES[key] || null;

// screen id -> capture key (+ special screens handled in the component)
const SCREENS = {
  overview: '01-campaigns-overview',
  'overview-completed': '20-campaigns-overview-completed-tab',
  'overview-after': '26-overview-after-launch',
  step1: '02-create-step1-intro',
  step2: '03-create-step2-setup',
  step3: '04-create-step3-products',
  adv: '05-create-advanced-default',
  'adv-who': '06-create-advanced-whogets-open',
  'adv-set1': '11-advanced-set1-populated',
  'adv-2sets': '13-advanced-2sets-choose-pickcount',
  'm-add': '07-addproducts-modal',
  'm-add2': '08-addproducts-2selected',
  'm-opts': '09-available-options-modal',
  'm-add3': '10-addproducts-3selected-variantpill',
  'm-add-dim': '12-addproducts-alreadyinset',
  brief: '15-brief-review-full',
  'brief-edit-about': '16-brief-about-editing',
  'brief-edit-note': '17-brief-note-editing',
  'draft-resume': '21-draft-resume-92',
  match: '18-find-creators-prefs',
  'match-how': '19-find-creators-howwork-open',
  'launch-t0': '22-launch-t0',
  launched: '23-launch-t1',
  'launched-content': '25-launched-content-tab',
  generating: null, // reconstructed interstitial
};

// Per-screen transition rules, checked in order. m = {txt, aria, el}.
// First match wins; the global rules run after screen rules.
const has = (s, needle) => s.toLowerCase().includes(needle.toLowerCase());
const T = {
  overview: [
    [(m) => m.txt === 'Completed', 'overview-completed'],
    [(m) => m.txt === 'Launch now', 'step1'],
    [(m) => m.txt === 'Finish setup', 'draft-resume'],
  ],
  'overview-completed': [[(m) => m.txt === 'Active', 'overview']],
  'overview-after': [
    [(m) => m.txt === 'Completed', 'overview-completed'],
    [(m) => has(m.aria, 'Cloudveil'), 'launched'],
    [(m) => m.txt === 'Finish setup', 'draft-resume'],
  ],
  step1: [
    [(m) => has(m.txt, 'Get Started'), 'step2'],
    [(m) => has(m.txt, 'Back to Campaigns'), 'overview'],
  ],
  step2: [
    [(m) => has(m.txt, 'Choose Your Product'), 'step3'],
    [(m) => m.txt === 'Back', 'step1'],
  ],
  step3: [
    [(m) => has(m.txt, 'See Advanced Options'), 'adv'],
    [(m) => m.txt === 'Back', 'step2'],
  ],
  adv: [
    [(m) => has(m.txt, 'Creators get all'), 'adv-who'],
    [(m) => m.txt === 'Add Products', 'm-add'],
    [(m) => has(m.txt, 'New Product Set'), 'adv-2sets'],
    [(m) => has(m.txt, 'Create My Campaign'), 'generating'],
    [(m) => m.txt === 'Back', 'step3'],
  ],
  'adv-who': [
    [(m) => has(m.txt, 'Creators get all') && m.el.closest('[role="menu"], .who-gets-menu, [class*="dropdown"]'), 'adv'],
    [(m) => has(m.txt, 'Creators choose'), 'adv'],
    [() => true, 'adv'], // any other click closes the dropdown
  ],
  'm-add': [
    [(m) => has(m.txt, 'Choose options') || has(m.txt, 'Sunlit') || has(m.txt, 'Moonmilk'), 'm-opts'],
    [(m) => m.txt === 'Cancel' || m.aria === 'Close', 'adv'],
    [(m) => has(m.txt, 'Cloudveil') || has(m.txt, 'Dewdrop') || has(m.txt, 'Select all shown'), 'm-add2'],
  ],
  'm-add2': [
    [(m) => has(m.txt, 'Choose options') || has(m.txt, 'Sunlit'), 'm-opts'],
    [(m) => m.txt === 'Add', 'adv-set1'],
    [(m) => m.txt === 'Cancel' || m.aria === 'Close', 'adv'],
    [(m) => m.txt === 'Clear', 'm-add'],
  ],
  'm-opts': [
    [(m) => has(m.txt, 'Add to campaign'), 'm-add3'],
    [(m) => m.txt === 'Cancel' || m.aria === 'Close', 'm-add2'],
  ],
  'm-add3': [
    [(m) => m.txt === 'Add', 'adv-set1'],
    [(m) => m.txt === 'Cancel' || m.aria === 'Close', 'adv'],
    [(m) => has(m.txt, 'Choose options'), 'm-opts'],
  ],
  'adv-set1': [
    [(m) => m.txt === 'Add Products', 'm-add-dim'],
    [(m) => has(m.txt, 'New Product Set'), 'adv-2sets'],
    [(m) => has(m.txt, 'Create My Campaign'), 'generating'],
    [(m) => m.txt === 'Back', 'step3'],
  ],
  'm-add-dim': [
    [(m) => has(m.txt, 'Moonmilk'), 'adv-2sets'],
    [(m) => m.txt === 'Cancel' || m.aria === 'Close' || m.txt === 'Add', 'adv-2sets'],
  ],
  'adv-2sets': [
    [(m) => has(m.txt, 'Create My Campaign'), 'generating'],
    [(m) => m.txt === 'Add Products', 'm-add-dim'],
    [(m) => m.txt === 'Back', 'step3'],
  ],
  brief: [
    [(m) => m.txt === 'Edit' && m.editIndex === 0, 'brief-edit-about'],
    [(m) => m.txt === 'Edit' && m.editIndex === 1, 'brief-edit-note'],
    [(m) => has(m.txt, 'Find Creators'), 'match'], // top CTA + footer button
    [(m) => has(m.txt, 'Back to Product Selection'), 'adv-2sets'],
  ],
  'brief-edit-about': [
    [(m) => m.txt === 'Done', 'brief'],
    [(m) => has(m.txt, 'Find Creators'), 'match'],
  ],
  'brief-edit-note': [
    [(m) => m.txt === 'Done', 'brief'],
    [(m) => has(m.txt, 'Find Creators'), 'match'],
  ],
  'draft-resume': [
    [(m) => has(m.txt, 'Find Creators'), 'match'],
    [(m) => has(m.txt, 'Back to Product Selection'), 'overview'],
  ],
  match: [
    [(m) => has(m.txt, 'How we find your creators'), 'match-how'],
    [(m) => has(m.txt, 'Launch Campaign'), 'launch-t0'],
    [(m) => has(m.txt, 'Back to Campaign Brief'), 'brief'],
  ],
  'match-how': [
    [(m) => has(m.txt, 'How we find your creators'), 'match'],
    [(m) => has(m.txt, 'Launch Campaign'), 'launch-t0'],
    [(m) => has(m.txt, 'Back to Campaign Brief'), 'brief'],
  ],
  launched: [
    [(m) => m.txt === 'Content', 'launched-content'],
    [(m) => m.txt === 'Campaigns' && !m.el.closest('aside'), 'overview-after'],
  ],
  'launched-content': [
    [(m) => m.txt === 'Dashboard', 'launched'],
    [(m) => m.txt === 'Campaigns' && !m.el.closest('aside'), 'overview-after'],
  ],
};

const LAUNCHED_FAMILY = new Set(['launched', 'launched-content', 'overview-after', 'launch-t0']);

function Generating({ onDone }) {
  const [lit, setLit] = useState(1);
  useEffect(() => {
    const t1 = setTimeout(() => setLit(2), 900);
    const t2 = setTimeout(() => setLit(3), 1800);
    const t3 = setTimeout(onDone, 2700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);
  return (
    <div className="nf-generating">
      <div className="nf-dots"><span /><span /><span /></div>
      <p className={'nf-line' + (lit >= 1 ? ' on' : '')}>🔍 Analyzing your products...</p>
      <p className={'nf-line' + (lit >= 2 ? ' on' : '')}>👋 Understanding your brand and category...</p>
      <p className={'nf-line' + (lit >= 3 ? ' on' : '')}>✍️ Drafting your campaign brief...</p>
    </div>
  );
}

export default function NewFlow() {
  const navigate = useNavigate();
  const { screen: screenParam } = useParams();
  const screen = SCREENS[screenParam] !== undefined || screenParam === 'generating' ? screenParam : 'overview';
  const rootRef = useRef(null);

  const go = (next) => navigate('/nf/' + next);

  // launch-t0 is a transition frame: auto-advance to the launched dashboard.
  useEffect(() => {
    if (screen !== 'launch-t0') return;
    const t = setTimeout(() => go('launched'), 900);
    return () => clearTimeout(t);
  }, [screen]);

  const handleClick = (e) => {
    const el = e.target.closest('a, button, [role="tab"], [role="link"]');
    if (!el || !rootRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
    const aria = el.getAttribute('aria-label') || '';
    // index among Edit buttons (brief section editing)
    let editIndex = -1;
    if (txt === 'Edit') {
      const edits = [...rootRef.current.querySelectorAll('button, a')].filter(
        (b) => (b.textContent || '').trim() === 'Edit'
      );
      editIndex = edits.indexOf(el);
    }
    const m = { txt, aria, el, editIndex };
    for (const [pred, target] of T[screen] || []) {
      if (pred(m)) { go(target); return; }
    }
    // Global: sidebar + logo
    if (el.closest('aside') || el.closest('.mobile-header')) {
      if (txt === 'Campaigns' || aria.toLowerCase().includes('home')) {
        go(LAUNCHED_FAMILY.has(screen) ? 'overview-after' : 'overview');
      }
      return; // Settings / Soon items / account: inert
    }
  };

  if (screen === 'generating') {
    return (
      <div className="nf">
        <Generating onDone={() => go('brief')} />
      </div>
    );
  }

  const state = S(SCREENS[screen]);
  if (!state) return <div className="nf" style={{ padding: 40 }}>Unknown screen: {String(screen)}</div>;

  return (
    <div className="nf" ref={rootRef} onClickCapture={handleClick}>
      <div className="brand-dashboard svelte-187rxgr">
        <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: NF_SHELL.header }} />
        <div className="dashboard-body svelte-187rxgr">
          <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: NF_SHELL.sidebar }} />
          <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: state.main }} />
        </div>
        <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: NF_SHELL.backdrop }} />
      </div>
      {state.modal && (
        <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: state.modal }} />
      )}
    </div>
  );
}
