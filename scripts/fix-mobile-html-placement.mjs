import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'index.html');
const github = execSync('git show HEAD:index.html', { cwd: root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

function extract(html, pattern) {
  const m = html.match(pattern);
  return m ? m[0] : null;
}

const mobNav = extract(github, /<nav class="mobile-bottom-nav"[\s\S]*?<\/nav>/);
const overlay = extract(github, /<div class="sidebar-overlay" id="sidebarOverlay"[\s\S]*?<\/div>/);
const toggleBtn = extract(github, /<button type="button" class="sidebar-toggle-btn sidebar-drawer-toggle" id="sidebarToggleBtn"[\s\S]*?<\/button>/);
const wfMobHead = '<div id="wfMobTicketsHead" class="wf-mob-tickets-head" aria-hidden="true"></div>';
const rpMobHead = '<div id="rpMobTicketsHead" aria-hidden="true"></div>';

let html = readFileSync(indexPath, 'utf8');

// إزالة الحقن الخاطئ داخل app-shell
html = html.replace(/\s*<!-- <div[^>]*\(GitHub mobile\) -->[\s\S]*?(?=<header class="topbar unified-banner">)/, '\n\n');

// sidebar overlay قبل الهيدر
if (overlay && !html.includes('id="sidebarOverlay"')) {
  html = html.replace(
    /<header class="topbar unified-banner">/,
    `${overlay}\n\n    <header class="topbar unified-banner">`
  );
}

// زر القائمة على الجوال
if (toggleBtn && !html.includes('id="sidebarToggleBtn"')) {
  html = html.replace(
    /<div class="topbar-brand-zone">/,
    `${toggleBtn}\n        <div class="topbar-brand-zone">`
  );
}

// رأس جدول الجوال داخل التبويبات
if (!html.includes('id="wfMobTicketsHead"')) {
  html = html.replace(
    /(<div class="tab-content" id="tab-workflow">[\s\S]*?<div class="wf-panel-banner">)/,
    (m) => m.replace('<div class="wf-panel-banner">', `${wfMobHead}\n              <div class="wf-panel-banner">`)
  );
}
if (!html.includes('id="rpMobTicketsHead"')) {
  html = html.replace(
    /(<div class="tab-content" id="tab-reports">[\s\S]*?<div class="wf-panel-banner">)/,
    (m) => m.replace('<div class="wf-panel-banner">', `${rpMobHead}\n              <div class="wf-panel-banner">`)
  );
}

// شريط التنقل السفلي قبل إغلاق app-shell
if (mobNav) {
  html = html.replace(/<nav class="mobile-bottom-nav"[\s\S]*?<\/nav>\s*/g, '');
  html = html.replace(
    /(\s*<\/div>\s*<!-- end app-shell|(\s*)<\/div>\s*<div class="app-body)/,
    (full, _g1, g2) => {
      if (full.includes('app-body')) return `\n    ${mobNav}\n${g2}<div class="app-body`;
      return full;
    }
  );
  if (!html.includes('id="mobileBottomNav"')) {
    html = html.replace(
      /(\s*)<div class="app-body"/,
      `\n    ${mobNav}\n$1<div class="app-body"`
    );
  }
}

writeFileSync(indexPath, html, 'utf8');
console.log('fixed mobile HTML placement');
