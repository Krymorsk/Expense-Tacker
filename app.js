'use strict';

/* ============================================================
   Daybook — application logic
   ============================================================ */

/* ---------- Constants ---------- */

const MS_DAY = 86400000;
const STORAGE_SETTINGS = 'daybook.settings.v1';
const STORAGE_EXPENSES = 'daybook.expenses.v1';

const DEFAULT_CATEGORIES = [
  { id: 'food', name: 'Food', color: 'var(--cat-food)' },
  { id: 'transport', name: 'Transport', color: 'var(--cat-transport)' },
  { id: 'shopping', name: 'Shopping', color: 'var(--cat-shopping)' },
  { id: 'bills', name: 'Bills', color: 'var(--cat-bills)' },
  { id: 'entertainment', name: 'Entertainment', color: 'var(--cat-entertainment)' },
  { id: 'health', name: 'Health', color: 'var(--cat-health)' },
  { id: 'other', name: 'Other', color: 'var(--cat-other)' },
];

const EXTRA_PALETTE = ['#C2884A', '#5A8FBD', '#9A7BC4', '#7C8AA6', '#D4889C', '#52A399', '#A89E8E', '#BD6B6B', '#6FA3D9'];

const DEFAULT_SETTINGS = {
  budget: 3000,
  resetDay: 25,
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  theme: 'system',
};

/* ---------- Tiny utilities ---------- */

function uid() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function todayMidnight() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatMoney(n, allowDecimals) {
  const value = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: allowDecimals ? 2 : 0,
    minimumFractionDigits: 0,
  }).format(value);
}

function formatDayLabel(d) {
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatShortDate(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/* ---------- Cycle math (unit-tested separately) ---------- */

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getResetDateForMonth(year, monthIndex, resetDay) {
  const d = Math.min(resetDay, daysInMonth(year, monthIndex));
  return new Date(year, monthIndex, d);
}

function getCycleBounds(today, resetDay) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const thisMonthReset = getResetDateForMonth(y, m, resetDay);
  let cycleStart, cycleEnd;
  if (today.getTime() >= thisMonthReset.getTime()) {
    cycleStart = thisMonthReset;
    cycleEnd = getResetDateForMonth(y, m + 1, resetDay);
  } else {
    cycleStart = getResetDateForMonth(y, m - 1, resetDay);
    cycleEnd = thisMonthReset;
  }
  const daysInCycle = Math.round((cycleEnd - cycleStart) / MS_DAY);
  const daysLeft = Math.round((cycleEnd - today) / MS_DAY);
  return { cycleStart, cycleEnd, daysInCycle, daysLeft };
}

/* ---------- State ---------- */

const state = {
  settings: null,
  expenses: [],
  isFirstRun: false,
  filterScope: 'cycle',
  filterCategory: '',
  filterSearch: '',
  editingExpenseId: null,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS);
    if (!raw) {
      state.isFirstRun = true;
      return { ...DEFAULT_SETTINGS, categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })) };
    }
    const parsed = JSON.parse(raw);
    const budget = Number(parsed.budget);
    const resetDay = Number(parsed.resetDay);
    return {
      budget: Number.isFinite(budget) && budget > 0 ? budget : DEFAULT_SETTINGS.budget,
      resetDay: Number.isFinite(resetDay) && resetDay >= 1 && resetDay <= 31 ? Math.round(resetDay) : DEFAULT_SETTINGS.resetDay,
      categories: Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      theme: ['light', 'dark', 'system'].includes(parsed.theme) ? parsed.theme : 'system',
    };
  } catch (err) {
    console.error('Failed to load settings, using defaults.', err);
    state.isFirstRun = true;
    return { ...DEFAULT_SETTINGS, categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })) };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(state.settings));
  } catch (err) {
    console.error('Failed to save settings.', err);
    showToast("Couldn't save settings — your browser storage may be full.");
  }
}

function loadExpenses() {
  try {
    const raw = localStorage.getItem(STORAGE_EXPENSES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) => e && typeof e.id === 'string' && Number.isFinite(Number(e.amount)) && typeof e.date === 'string' && typeof e.categoryId === 'string'
    );
  } catch (err) {
    console.error('Failed to load expenses.', err);
    return [];
  }
}

function saveExpenses() {
  try {
    localStorage.setItem(STORAGE_EXPENSES, JSON.stringify(state.expenses));
  } catch (err) {
    console.error('Failed to save expenses.', err);
    showToast("Couldn't save — your browser storage may be full.");
  }
}

function getCategoryById(id) {
  return state.settings.categories.find((c) => c.id === id) || { id: 'other', name: 'Other', color: 'var(--cat-other)' };
}

/* ---------- Computation ---------- */

function computeStats() {
  const today = todayMidnight();
  const { cycleStart, cycleEnd, daysInCycle, daysLeft } = getCycleBounds(today, state.settings.resetDay);
  const todayISO = toISODate(today);
  const budget = state.settings.budget;

  const cycleExpenses = state.expenses.filter((e) => {
    const d = parseISODate(e.date);
    return d.getTime() >= cycleStart.getTime() && d.getTime() < cycleEnd.getTime();
  });

  const spentThisCycle = cycleExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const spentToday = cycleExpenses.filter((e) => e.date === todayISO).reduce((sum, e) => sum + Number(e.amount), 0);
  const spentBeforeToday = spentThisCycle - spentToday;

  const remainingBudget = budget - spentThisCycle;
  const todaysAllowance = (budget - spentBeforeToday) / daysLeft;
  const leftToSpendToday = todaysAllowance - spentToday;

  let tomorrowAllowance = null;
  let tomorrowIsNewCycle = false;
  let nextCycleDays = null;
  if (daysLeft > 1) {
    tomorrowAllowance = (budget - spentThisCycle) / (daysLeft - 1);
  } else {
    tomorrowIsNewCycle = true;
    const nextBounds = getCycleBounds(cycleEnd, state.settings.resetDay);
    nextCycleDays = nextBounds.daysInCycle;
    tomorrowAllowance = budget / nextBounds.daysInCycle;
  }

  const fairShare = budget / daysInCycle;

  const categoryTotals = {};
  cycleExpenses.forEach((e) => {
    categoryTotals[e.categoryId] = (categoryTotals[e.categoryId] || 0) + Number(e.amount);
  });

  return {
    today,
    todayISO,
    cycleStart,
    cycleEnd,
    daysInCycle,
    daysLeft,
    budget,
    spentThisCycle,
    spentToday,
    spentBeforeToday,
    remainingBudget,
    todaysAllowance,
    leftToSpendToday,
    tomorrowAllowance,
    tomorrowIsNewCycle,
    nextCycleDays,
    fairShare,
    categoryTotals,
    cycleExpenses,
  };
}

/* ---------- DOM refs ---------- */

const dom = {
  todayLabel: document.getElementById('todayLabel'),
  cycleProgressLabel: document.getElementById('cycleProgressLabel'),
  cycleProgressFill: document.getElementById('cycleProgressFill'),
  ringProgress: document.getElementById('ringProgress'),
  ringIcon: document.getElementById('ringIcon'),
  heroAmount: document.getElementById('heroAmount'),
  heroSub: document.getElementById('heroSub'),
  heroStatus: document.getElementById('heroStatus'),

  statBudget: document.getElementById('statBudget'),
  statSpent: document.getElementById('statSpent'),
  statRemaining: document.getElementById('statRemaining'),
  statDaysLeft: document.getElementById('statDaysLeft'),

  outlookToday: document.getElementById('outlookToday'),
  outlookTomorrow: document.getElementById('outlookTomorrow'),
  outlookCaption: document.getElementById('outlookCaption'),

  runwayMeta: document.getElementById('runwayMeta'),
  runwayScroll: document.getElementById('runwayScroll'),

  categoryBreakdown: document.getElementById('categoryBreakdown'),
  categoryEmpty: document.getElementById('categoryEmpty'),

  searchInput: document.getElementById('searchInput'),
  categoryFilter: document.getElementById('categoryFilter'),
  transactionList: document.getElementById('transactionList'),
  transactionsEmpty: document.getElementById('transactionsEmpty'),

  fabAdd: document.getElementById('fabAdd'),

  expenseBackdrop: document.getElementById('expenseBackdrop'),
  expenseForm: document.getElementById('expenseForm'),
  expenseModalTitle: document.getElementById('expenseModalTitle'),
  expenseId: document.getElementById('expenseId'),
  expenseAmount: document.getElementById('expenseAmount'),
  amountError: document.getElementById('amountError'),
  categoryChips: document.getElementById('categoryChips'),
  categoryError: document.getElementById('categoryError'),
  expenseDate: document.getElementById('expenseDate'),
  dateError: document.getElementById('dateError'),
  expenseNote: document.getElementById('expenseNote'),
  deleteExpenseBtn: document.getElementById('deleteExpenseBtn'),
  saveExpenseBtn: document.getElementById('saveExpenseBtn'),

  settingsBtn: document.getElementById('settingsBtn'),
  settingsBackdrop: document.getElementById('settingsBackdrop'),
  settingsForm: document.getElementById('settingsForm'),
  budgetInput: document.getElementById('budgetInput'),
  budgetError: document.getElementById('budgetError'),
  resetDayInput: document.getElementById('resetDayInput'),
  resetDayError: document.getElementById('resetDayError'),
  categoryManageList: document.getElementById('categoryManageList'),
  newCategoryInput: document.getElementById('newCategoryInput'),
  addCategoryBtn: document.getElementById('addCategoryBtn'),
  resetAllBtn: document.getElementById('resetAllBtn'),

  onboardingBackdrop: document.getElementById('onboardingBackdrop'),
  onboardingForm: document.getElementById('onboardingForm'),
  obBudgetInput: document.getElementById('obBudgetInput'),
  obBudgetError: document.getElementById('obBudgetError'),
  obResetDayInput: document.getElementById('obResetDayInput'),
  obResetDayError: document.getElementById('obResetDayError'),

  themeToggleBtn: document.getElementById('themeToggleBtn'),
  toastContainer: document.getElementById('toastContainer'),
};

let selectedCategoryId = null;

/* ---------- Number count-up animation ---------- */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastHeroValue = null;

function animateNumber(el, fromValue, toValue, formatter, duration) {
  if (prefersReducedMotion || fromValue === null || !Number.isFinite(fromValue)) {
    el.textContent = formatter(toValue);
    return;
  }
  const start = performance.now();
  const change = toValue - fromValue;
  function tick(now) {
    const progress = clamp((now - start) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = formatter(fromValue + change * eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ---------- Rendering ---------- */

function refreshAll() {
  const stats = computeStats();
  renderHero(stats);
  renderStatsGrid(stats);
  renderOutlook(stats);
  renderRunway(stats);
  renderCategoryBreakdown(stats);
  renderCategoryFilterOptions();
  renderTransactions(stats);
}

function renderHero(stats) {
  dom.todayLabel.textContent = formatDayLabel(stats.today);

  const cyclePct = clamp(stats.spentThisCycle / stats.budget, 0, 1) * 100;
  dom.cycleProgressLabel.textContent = `${Math.round(clamp(stats.spentThisCycle / stats.budget, 0, 1) * 100)}% of cycle spent`;
  dom.cycleProgressFill.style.width = `${cyclePct}%`;
  dom.cycleProgressFill.classList.toggle('is-danger', stats.remainingBudget < 0);

  const displayAmount = Math.max(0, stats.leftToSpendToday);
  animateNumber(dom.heroAmount, lastHeroValue, displayAmount, (v) => formatMoney(v, false), 500);
  lastHeroValue = displayAmount;

  dom.heroAmount.classList.remove('is-danger', 'is-warning', 'is-positive');
  const ringPct = stats.todaysAllowance > 0 ? clamp(stats.spentToday / stats.todaysAllowance, 0, 1) : stats.spentToday > 0 ? 1 : 0;
  const circumference = 263.9;
  dom.ringProgress.style.strokeDashoffset = String(circumference * (1 - ringPct));

  dom.ringProgress.classList.remove('fill-positive');
  dom.ringProgress.style.stroke = '';
  if (stats.leftToSpendToday < 0) {
    dom.heroAmount.classList.add('is-danger');
    dom.ringProgress.style.stroke = 'var(--danger)';
  } else if (ringPct > 0.8) {
    dom.heroAmount.classList.add('is-warning');
    dom.ringProgress.style.stroke = 'var(--warning)';
  } else {
    dom.heroAmount.classList.add('is-positive');
    dom.ringProgress.style.stroke = 'var(--positive)';
  }

  dom.heroSub.textContent = `of ${formatMoney(Math.max(0, stats.todaysAllowance), false)} planned for today`;
  dom.heroStatus.textContent = buildStatusMessage(stats);
  dom.heroStatus.classList.remove('is-danger', 'is-warning');
  if (stats.remainingBudget < 0 || stats.leftToSpendToday < 0) {
    dom.heroStatus.classList.add(stats.remainingBudget < 0 ? 'is-danger' : 'is-warning');
  }
}

function buildStatusMessage(stats) {
  if (stats.remainingBudget < 0) {
    return `You've exceeded this month's budget by ${formatMoney(Math.abs(stats.remainingBudget), false)}. You can raise it in Settings or ease up for the rest of the cycle.`;
  }
  if (stats.leftToSpendToday < 0) {
    return `You've gone ${formatMoney(Math.abs(stats.leftToSpendToday), false)} over today's plan — tomorrow's allowance adjusts to ${formatMoney(stats.tomorrowAllowance, false)}.`;
  }
  if (stats.spentThisCycle === 0) {
    return `Fresh cycle, fresh start — here's your plan for the next ${stats.daysLeft} day${stats.daysLeft === 1 ? '' : 's'}.`;
  }
  if (stats.spentToday === 0) {
    return `Nothing logged today yet — you're starting the day with the full amount above.`;
  }
  const ratio = stats.todaysAllowance > 0 ? stats.spentToday / stats.todaysAllowance : 0;
  if (ratio >= 0.6) {
    return `Tracking close to today's plan — pace yourself for the rest of the day.`;
  }
  return `You're comfortably within today's plan. Nicely paced.`;
}

function renderStatsGrid(stats) {
  dom.statBudget.textContent = formatMoney(stats.budget, false);
  dom.statSpent.textContent = formatMoney(stats.spentThisCycle, false);
  dom.statRemaining.textContent = formatMoney(stats.remainingBudget, false);
  dom.statRemaining.classList.toggle('is-danger', stats.remainingBudget < 0);
  dom.statDaysLeft.textContent = String(stats.daysLeft);
}

function renderOutlook(stats) {
  dom.outlookToday.textContent = formatMoney(Math.max(0, stats.todaysAllowance), false);
  dom.outlookTomorrow.textContent = formatMoney(Math.max(0, stats.tomorrowAllowance), false);
  if (stats.tomorrowIsNewCycle) {
    dom.outlookCaption.textContent = `Your cycle resets tomorrow — a fresh ${formatMoney(stats.budget, false)} across ${stats.nextCycleDays} days.`;
  } else {
    dom.outlookCaption.textContent = `Recalculated automatically every time you log a spend.`;
  }
}

function renderRunway(stats) {
  dom.runwayMeta.textContent = `${stats.daysLeft} day${stats.daysLeft === 1 ? '' : 's'} left · resets ${formatShortDate(stats.cycleEnd)}`;
  dom.runwayScroll.innerHTML = '';

  const spentByDate = {};
  stats.cycleExpenses.forEach((e) => {
    spentByDate[e.date] = (spentByDate[e.date] || 0) + Number(e.amount);
  });

  let todayEl = null;
  for (let i = 0; i < stats.daysInCycle; i++) {
    const dayDate = new Date(stats.cycleStart.getTime() + i * MS_DAY);
    const iso = toISODate(dayDate);
    const isFuture = dayDate.getTime() > stats.today.getTime();
    const isToday = dayDate.getTime() === stats.today.getTime();
    const spent = spentByDate[iso] || 0;

    const col = document.createElement('div');
    col.className = 'runway-day' + (isFuture ? ' is-future' : '') + (isToday ? ' is-today' : '');
    col.title = `${formatShortDate(dayDate)} — ${formatMoney(spent, true)} spent`;

    const dot = document.createElement('span');
    dot.className = 'runway-day-dot';
    col.appendChild(dot);

    const track = document.createElement('div');
    track.className = 'runway-bar-track';

    if (!isFuture) {
      const fill = document.createElement('div');
      const ratio = stats.fairShare > 0 ? spent / stats.fairShare : 0;
      const heightPct = spent === 0 ? 0 : Math.max(6, Math.min(ratio, 1) * 100);
      fill.className = 'runway-bar-fill ' + (spent > stats.fairShare ? 'fill-danger' : 'fill-positive');
      fill.style.height = `${heightPct}%`;
      track.appendChild(fill);
    }

    col.appendChild(track);
    dom.runwayScroll.appendChild(col);
    if (isToday) todayEl = col;
  }

  if (todayEl) {
    requestAnimationFrame(() => {
      if (typeof todayEl.scrollIntoView === 'function') {
        todayEl.scrollIntoView({ inline: 'center', block: 'nearest' });
      }
    });
  }
}

function renderCategoryBreakdown(stats) {
  const entries = Object.entries(stats.categoryTotals)
    .map(([id, amount]) => ({ id, amount, category: getCategoryById(id) }))
    .sort((a, b) => b.amount - a.amount);

  dom.categoryBreakdown.innerHTML = '';
  dom.categoryEmpty.hidden = entries.length > 0;

  const maxAmount = entries.length ? entries[0].amount : 0;
  entries.forEach(({ amount, category }) => {
    const row = document.createElement('div');
    row.className = 'category-row';

    const top = document.createElement('div');
    top.className = 'category-row-top';
    const nameWrap = document.createElement('span');
    nameWrap.className = 'category-name';
    nameWrap.innerHTML = `<i style="background:${category.color}"></i>${escapeHtml(category.name)}`;
    const amountWrap = document.createElement('span');
    amountWrap.className = 'category-amount';
    const pct = stats.spentThisCycle > 0 ? Math.round((amount / stats.spentThisCycle) * 100) : 0;
    amountWrap.innerHTML = `${formatMoney(amount, false)} <span class="category-pct">· ${pct}%</span>`;
    top.appendChild(nameWrap);
    top.appendChild(amountWrap);

    const track = document.createElement('div');
    track.className = 'category-bar-track';
    const fill = document.createElement('div');
    fill.className = 'category-bar-fill';
    fill.style.width = `${maxAmount > 0 ? (amount / maxAmount) * 100 : 0}%`;
    fill.style.background = category.color;
    track.appendChild(fill);

    row.appendChild(top);
    row.appendChild(track);
    dom.categoryBreakdown.appendChild(row);
  });
}

function renderCategoryFilterOptions() {
  const current = dom.categoryFilter.value;
  dom.categoryFilter.innerHTML = '<option value="">All categories</option>';
  state.settings.categories.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    dom.categoryFilter.appendChild(opt);
  });
  if (state.settings.categories.some((c) => c.id === current)) {
    dom.categoryFilter.value = current;
  }
}

function renderTransactions(stats) {
  const pool = state.filterScope === 'cycle' ? stats.cycleExpenses : state.expenses;

  let filtered = pool.filter((e) => {
    if (state.filterCategory && e.categoryId !== state.filterCategory) return false;
    if (state.filterSearch) {
      const cat = getCategoryById(e.categoryId).name.toLowerCase();
      const note = (e.note || '').toLowerCase();
      if (!cat.includes(state.filterSearch) && !note.includes(state.filterSearch)) return false;
    }
    return true;
  });

  filtered = filtered.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  dom.transactionList.innerHTML = '';

  if (filtered.length === 0) {
    dom.transactionsEmpty.hidden = false;
    dom.transactionsEmpty.textContent =
      state.expenses.length === 0 ? 'No expenses yet. Tap the + button to log your first one.' : 'No transactions match — try a different search or filter.';
    return;
  }
  dom.transactionsEmpty.hidden = true;

  let lastDateHeader = null;
  filtered.forEach((e) => {
    if (e.date !== lastDateHeader) {
      lastDateHeader = e.date;
      const header = document.createElement('div');
      header.className = 'txn-day-header';
      header.textContent = relativeDateLabel(e.date, stats.todayISO);
      dom.transactionList.appendChild(header);
    }

    const category = getCategoryById(e.categoryId);
    const row = document.createElement('div');
    row.className = 'txn-row';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Edit ${category.name} expense of ${formatMoney(Number(e.amount), true)}`);

    const dot = document.createElement('span');
    dot.className = 'txn-dot';
    dot.style.background = category.color;

    const info = document.createElement('div');
    info.className = 'txn-info';
    const catEl = document.createElement('div');
    catEl.className = 'txn-category';
    catEl.textContent = category.name;
    info.appendChild(catEl);
    if (e.note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'txn-note';
      noteEl.textContent = e.note;
      info.appendChild(noteEl);
    }

    const amountEl = document.createElement('div');
    amountEl.className = 'txn-amount';
    amountEl.textContent = formatMoney(Number(e.amount), true);

    const chevron = document.createElement('span');
    chevron.className = 'txn-edit-btn';
    chevron.innerHTML = '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

    row.appendChild(dot);
    row.appendChild(info);
    row.appendChild(amountEl);
    row.appendChild(chevron);

    row.addEventListener('click', () => openExpenseModal(e.id));
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openExpenseModal(e.id);
      }
    });

    dom.transactionList.appendChild(row);
  });
}

function relativeDateLabel(iso, todayISO) {
  if (iso === todayISO) return 'Today';
  const d = parseISODate(iso);
  const yesterday = new Date(parseISODate(todayISO).getTime() - MS_DAY);
  if (toISODate(yesterday) === iso) return 'Yesterday';
  return formatDayLabel(d);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------- Expense modal ---------- */

function renderCategoryChips() {
  dom.categoryChips.innerHTML = '';
  state.settings.categories.forEach((c) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (c.id === selectedCategoryId ? ' is-selected' : '');
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', c.id === selectedCategoryId ? 'true' : 'false');
    chip.innerHTML = `<i style="background:${c.color}"></i>${escapeHtml(c.name)}`;
    chip.addEventListener('click', () => {
      selectedCategoryId = c.id;
      dom.categoryError.hidden = true;
      renderCategoryChips();
    });
    dom.categoryChips.appendChild(chip);
  });
}

function openExpenseModal(expenseId) {
  state.editingExpenseId = expenseId || null;
  const todayISO = toISODate(todayMidnight());
  dom.expenseForm.reset();
  clearExpenseErrors();
  resetDeleteConfirm();

  if (expenseId) {
    const e = state.expenses.find((x) => x.id === expenseId);
    if (!e) return;
    dom.expenseModalTitle.textContent = 'Edit expense';
    dom.expenseId.value = e.id;
    dom.expenseAmount.value = e.amount;
    selectedCategoryId = e.categoryId;
    dom.expenseDate.value = e.date;
    dom.expenseNote.value = e.note || '';
    dom.saveExpenseBtn.textContent = 'Save changes';
    dom.deleteExpenseBtn.hidden = false;
  } else {
    dom.expenseModalTitle.textContent = 'Add expense';
    dom.expenseId.value = '';
    selectedCategoryId = state.settings.categories[0] ? state.settings.categories[0].id : null;
    dom.expenseDate.value = todayISO;
    dom.saveExpenseBtn.textContent = 'Save expense';
    dom.deleteExpenseBtn.hidden = true;
  }

  dom.expenseDate.max = todayISO;
  renderCategoryChips();
  openModal(dom.expenseBackdrop);
  setTimeout(() => dom.expenseAmount.focus(), 50);
}

function clearExpenseErrors() {
  dom.amountError.hidden = true;
  dom.categoryError.hidden = true;
  dom.dateError.hidden = true;
}

function resetDeleteConfirm() {
  dom.deleteExpenseBtn.textContent = 'Delete';
  dom.deleteExpenseBtn.classList.remove('is-confirming');
  dom.deleteExpenseBtn.dataset.armed = '0';
}

function handleExpenseSubmit(ev) {
  ev.preventDefault();
  clearExpenseErrors();

  const amount = parseFloat(dom.expenseAmount.value);
  const date = dom.expenseDate.value;
  const note = dom.expenseNote.value.trim();
  let valid = true;

  if (!Number.isFinite(amount) || amount <= 0) {
    dom.amountError.hidden = false;
    valid = false;
  }
  if (!selectedCategoryId) {
    dom.categoryError.hidden = false;
    valid = false;
  }
  if (!date || Number.isNaN(parseISODate(date).getTime())) {
    dom.dateError.hidden = false;
    valid = false;
  }
  if (!valid) return;

  if (state.editingExpenseId) {
    const e = state.expenses.find((x) => x.id === state.editingExpenseId);
    if (e) {
      e.amount = amount;
      e.categoryId = selectedCategoryId;
      e.date = date;
      e.note = note;
    }
    showToast('Expense updated.');
  } else {
    state.expenses.push({
      id: uid(),
      amount,
      categoryId: selectedCategoryId,
      date,
      note,
      createdAt: Date.now(),
    });
    showToast('Expense added.');
  }

  saveExpenses();
  closeModal(dom.expenseBackdrop);
  refreshAll();
}

function handleDeleteExpense() {
  if (dom.deleteExpenseBtn.dataset.armed !== '1') {
    dom.deleteExpenseBtn.dataset.armed = '1';
    dom.deleteExpenseBtn.textContent = 'Tap again to confirm';
    dom.deleteExpenseBtn.classList.add('is-confirming');
    clearTimeout(dom.deleteExpenseBtn._timeout);
    dom.deleteExpenseBtn._timeout = setTimeout(resetDeleteConfirm, 3000);
    return;
  }
  const id = state.editingExpenseId;
  state.expenses = state.expenses.filter((e) => e.id !== id);
  saveExpenses();
  closeModal(dom.expenseBackdrop);
  showToast('Expense deleted.');
  refreshAll();
}

/* ---------- Settings modal ---------- */

function openSettingsModal() {
  dom.budgetInput.value = state.settings.budget;
  dom.resetDayInput.value = state.settings.resetDay;
  dom.budgetError.hidden = true;
  dom.resetDayError.hidden = true;
  renderCategoryManageList();
  highlightThemeButtons();
  resetResetAllConfirm();
  openModal(dom.settingsBackdrop);
}

function renderCategoryManageList() {
  dom.categoryManageList.innerHTML = '';
  const usage = {};
  state.expenses.forEach((e) => {
    usage[e.categoryId] = (usage[e.categoryId] || 0) + 1;
  });

  state.settings.categories.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'category-manage-row';

    const dot = document.createElement('i');
    dot.style.background = c.color;

    const name = document.createElement('span');
    name.textContent = c.name;

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.setAttribute('aria-label', `Remove ${c.name}`);
    delBtn.innerHTML = '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    const inUse = (usage[c.id] || 0) > 0;
    const isLast = state.settings.categories.length <= 1;
    if (inUse || isLast) {
      delBtn.disabled = true;
      delBtn.title = isLast ? 'Keep at least one category' : 'In use — can\u2019t remove';
    } else {
      delBtn.addEventListener('click', () => {
        if (delBtn.dataset.armed !== '1') {
          delBtn.dataset.armed = '1';
          delBtn.classList.add('is-confirming');
          clearTimeout(delBtn._timeout);
          delBtn._timeout = setTimeout(() => {
            delBtn.dataset.armed = '0';
            delBtn.classList.remove('is-confirming');
          }, 3000);
          return;
        }
        state.settings.categories = state.settings.categories.filter((x) => x.id !== c.id);
        saveSettings();
        renderCategoryManageList();
        renderCategoryFilterOptions();
        showToast('Category removed.');
      });
    }

    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(delBtn);
    dom.categoryManageList.appendChild(row);
  });
}

function handleAddCategory() {
  const name = dom.newCategoryInput.value.trim();
  if (!name) return;
  const exists = state.settings.categories.some((c) => c.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    showToast('That category already exists.');
    return;
  }
  const color = EXTRA_PALETTE[state.settings.categories.length % EXTRA_PALETTE.length];
  state.settings.categories.push({ id: uid(), name, color });
  saveSettings();
  dom.newCategoryInput.value = '';
  renderCategoryManageList();
  renderCategoryFilterOptions();
  showToast('Category added.');
}

function highlightThemeButtons() {
  document.querySelectorAll('[data-theme]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.theme === state.settings.theme);
  });
}

function resetResetAllConfirm() {
  dom.resetAllBtn.textContent = 'Reset all data';
  dom.resetAllBtn.classList.remove('is-confirming');
  dom.resetAllBtn.dataset.armed = '0';
}

function handleSettingsSubmit(ev) {
  ev.preventDefault();
  dom.budgetError.hidden = true;
  dom.resetDayError.hidden = true;

  const budget = parseFloat(dom.budgetInput.value);
  const resetDay = parseInt(dom.resetDayInput.value, 10);
  let valid = true;

  if (!Number.isFinite(budget) || budget <= 0) {
    dom.budgetError.hidden = false;
    valid = false;
  }
  if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 31) {
    dom.resetDayError.hidden = false;
    valid = false;
  }
  if (!valid) return;

  state.settings.budget = budget;
  state.settings.resetDay = resetDay;
  saveSettings();
  closeModal(dom.settingsBackdrop);
  showToast('Settings saved.');
  refreshAll();
}

function handleResetAll() {
  if (dom.resetAllBtn.dataset.armed !== '1') {
    dom.resetAllBtn.dataset.armed = '1';
    dom.resetAllBtn.textContent = 'Tap again to confirm';
    dom.resetAllBtn.classList.add('is-confirming');
    clearTimeout(dom.resetAllBtn._timeout);
    dom.resetAllBtn._timeout = setTimeout(resetResetAllConfirm, 3000);
    return;
  }
  localStorage.removeItem(STORAGE_SETTINGS);
  localStorage.removeItem(STORAGE_EXPENSES);
  state.settings = { ...DEFAULT_SETTINGS, categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })) };
  state.expenses = [];
  saveSettings();
  saveExpenses();
  closeModal(dom.settingsBackdrop);
  lastHeroValue = null;
  refreshAll();
  showToast('All data cleared.');
}

/* ---------- Onboarding ---------- */

function maybeShowOnboarding() {
  if (state.isFirstRun) {
    openModal(dom.onboardingBackdrop);
  }
}

function handleOnboardingSubmit(ev) {
  ev.preventDefault();
  dom.obBudgetError.hidden = true;
  dom.obResetDayError.hidden = true;

  const budget = parseFloat(dom.obBudgetInput.value);
  const resetDay = parseInt(dom.obResetDayInput.value, 10);
  let valid = true;

  if (!Number.isFinite(budget) || budget <= 0) {
    dom.obBudgetError.hidden = false;
    valid = false;
  }
  if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 31) {
    dom.obResetDayError.hidden = false;
    valid = false;
  }
  if (!valid) return;

  state.settings.budget = budget;
  state.settings.resetDay = resetDay;
  state.isFirstRun = false;
  saveSettings();
  closeModal(dom.onboardingBackdrop);
  showToast("You're all set — here's your plan.");
  refreshAll();
}

/* ---------- Modal helpers ---------- */

let lastFocusedEl = null;

function openModal(backdrop) {
  lastFocusedEl = document.activeElement;
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal(backdrop) {
  backdrop.hidden = true;
  document.body.style.overflow = '';
  if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
}

function setupModalDismiss(backdrop) {
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) closeModal(backdrop);
  });
}

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  [dom.expenseBackdrop, dom.settingsBackdrop].forEach((b) => {
    if (!b.hidden) closeModal(b);
  });
});

/* ---------- Toasts ---------- */

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 250);
  }, 2400);
}

/* ---------- Theme ---------- */

function effectiveTheme() {
  if (state.settings.theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return state.settings.theme;
}

function applyTheme() {
  const effective = effectiveTheme();
  document.documentElement.setAttribute('data-theme', effective);
  dom.themeToggleBtn.setAttribute('aria-label', effective === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

function toggleThemeQuick() {
  const current = effectiveTheme();
  state.settings.theme = current === 'dark' ? 'light' : 'dark';
  saveSettings();
  applyTheme();
}

/* ---------- Wiring ---------- */

function init() {
  state.settings = loadSettings();
  state.expenses = loadExpenses();

  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.settings.theme === 'system') applyTheme();
  });

  setupModalDismiss(dom.expenseBackdrop);
  setupModalDismiss(dom.settingsBackdrop);

  dom.themeToggleBtn.addEventListener('click', toggleThemeQuick);
  dom.settingsBtn.addEventListener('click', openSettingsModal);
  dom.fabAdd.addEventListener('click', () => openExpenseModal(null));

  document.querySelectorAll('[data-close="expense"]').forEach((b) => b.addEventListener('click', () => closeModal(dom.expenseBackdrop)));
  document.querySelectorAll('[data-close="settings"]').forEach((b) => b.addEventListener('click', () => closeModal(dom.settingsBackdrop)));

  dom.expenseForm.addEventListener('submit', handleExpenseSubmit);
  dom.deleteExpenseBtn.addEventListener('click', handleDeleteExpense);

  dom.settingsForm.addEventListener('submit', handleSettingsSubmit);
  dom.addCategoryBtn.addEventListener('click', handleAddCategory);
  dom.newCategoryInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      handleAddCategory();
    }
  });
  dom.resetAllBtn.addEventListener('click', handleResetAll);

  document.querySelectorAll('[data-theme]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.settings.theme = btn.dataset.theme;
      saveSettings();
      applyTheme();
      highlightThemeButtons();
    });
  });

  dom.onboardingForm.addEventListener('submit', handleOnboardingSubmit);

  dom.searchInput.addEventListener('input', () => {
    state.filterSearch = dom.searchInput.value.trim().toLowerCase();
    renderTransactions(computeStats());
  });
  dom.categoryFilter.addEventListener('change', () => {
    state.filterCategory = dom.categoryFilter.value;
    renderTransactions(computeStats());
  });
  document.querySelectorAll('.scope-btn[data-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scope-btn[data-scope]').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.filterScope = btn.dataset.scope;
      renderTransactions(computeStats());
    });
  });

  refreshAll();
  maybeShowOnboarding();

  let lastSeenDate = toISODate(todayMidnight());
  setInterval(() => {
    const nowDate = toISODate(todayMidnight());
    if (nowDate !== lastSeenDate) {
      lastSeenDate = nowDate;
      refreshAll();
    }
  }, 60000);
}

document.addEventListener('DOMContentLoaded', init);
