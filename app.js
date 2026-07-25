import './firebase.js';

// ── STATE ─────────────────────────────────────────────────────────────────────
let teams = [], scores = {}, rankings = [], sponsorAwards = [], judges = [];
// rankings    = [{ judge, ranks: { teamId: rankNumber 1–5 }, rubric: { teamId: score } }]
// sponsorAwards = [{ sponsor, award, project }]
// judges      = [{ id, name, email, tableIds: [] }]  tableIds = team ids assigned

const TRACKS = [
  // Main Theme Tracks
  { id: 'Social Impact',  label: 'Alchemy of the Earth (Social Impact)',  icon: '🌿', cls: 'badge-social',   main: true  },
  { id: 'Health',         label: 'Elixirs of Vitality (Health)',           icon: '🧪', cls: 'badge-health',   main: true  },
  { id: 'Education',      label: "The Scholar's Spellbook (Education)",    icon: '📜', cls: 'badge-edu',      main: true  },
  { id: 'Commerce',       label: 'Enchanted Commerce (Commerce)',           icon: '🪙', cls: 'badge-commerce', main: true  },
  { id: 'Wildcard',       label: "The Rogue's Ritual (Wildcard)",          icon: '✨', cls: 'badge-uiux',     main: true  },
  // Side Tracks
  { id: 'Best Solo Hack',    label: 'Best Solo Hack',    icon: '🦸', cls: 'badge-solo',    main: false },
  { id: 'Best Duo Hack',     label: 'Best Duo Hack',     icon: '👯', cls: 'badge-duo',     main: false },
  { id: 'Best Beginner Hack',label: 'Best Beginner Hack',icon: '🌱', cls: 'badge-social',  main: false },
  { id: 'Best AI/ML',        label: 'Best AI/ML Hack',   icon: '🧠', cls: 'badge-aiml',    main: false },
  { id: 'Best UI/UX',        label: 'Best UI/UX Hack',   icon: '🎨', cls: 'badge-uiux',    main: false },
  { id: 'Best Mobile App',   label: 'Best Mobile Hack',  icon: '📱', cls: 'badge-mobile',  main: false },
];
const TMAP = {}; TRACKS.forEach(t => TMAP[t.id] = t);

const CORNER_CSE_ROOM_LABEL = 'Corner CSE Room';

function isMCACornerTeamByProject(t) {
  return !!(t && (t.project || '').trim().toUpperCase() === 'MCA');
}

function isMCACornerTeam(t) {
  if (!t) return false;
  if (t.specialRoom === CORNER_CSE_ROOM_LABEL) return true;
  return isMCACornerTeamByProject(t);
}

function getRowLabel(tableNum) {
  const n = Number(tableNum);
  if (!Number.isFinite(n) || n < 1) return '';
  const start = Math.floor((n - 1) / 10) * 10 + 1;
  return `<span style="font-size:0.68rem;color:var(--muted);margin-left:6px;white-space:nowrap">(${start}–${start + 9})</span>`;
}

// ── FIREBASE SYNC ─────────────────────────────────────────────────────────────
let _fbConnected = false;
// Bumped on every persist(); embedded in RTDB payload. Listener ignores snapshots with
// a lower _persistGen than local (out-of-order / stale echoes, e.g. empty DB after CSV import).
let _persistGen = 0;

// Firebase set() rejects undefined anywhere in the tree (e.g. team.conflict omitted as undefined).
function stripUndefinedDeep(val) {
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(stripUndefinedDeep);
  const out = {};
  for (const k of Object.keys(val)) {
    const v = val[k];
    if (v === undefined) continue;
    out[k] = stripUndefinedDeep(v);
  }
  return out;
}

function judgingPayload() {
  return stripUndefinedDeep({ teams, scores, rankings, sponsorAwards, judges, _persistGen });
}

function persist() {
  if (!window._fbSet) {
    // Firebase not ready — save to localStorage as fallback
    try {
      localStorage.setItem('dh26_teams',    JSON.stringify(teams));
      localStorage.setItem('dh26_scores',   JSON.stringify(scores));
      localStorage.setItem('dh26_rankings', JSON.stringify(rankings));
      localStorage.setItem('dh26_sponsors', JSON.stringify(sponsorAwards));
      localStorage.setItem('dh26_judges',   JSON.stringify(judges));
    } catch(e) {}
    const el = document.getElementById('autosave-msg');
    if (el) el.textContent = '💾 saved locally';
    renderTeamsTable(); updateStats();
    return;
  }
  _persistGen++;
  window._fbSet('judging', judgingPayload())
    .catch(e => {
      console.error('Firebase write error:', e);
      _persistGen = Math.max(0, _persistGen - 1);
    });
  const el = document.getElementById('autosave-msg');
  if (el) el.textContent = '🔄 syncing...';
}

function startFirebaseSync() {
  window._fbOn('judging', val => {
    const toArray = v => {
      if (!v) return [];
      if (Array.isArray(v)) return v.filter(Boolean);
      return Object.values(v).filter(Boolean);
    };

    if (!val) {
      // Empty database — first time setup
      // Only seed judges if we don't already have local data
      if (!judges.length) {
        judges = DEFAULT_JUDGES.map((name, i) => ({ id: Date.now() + i, name, email: '', tableIds: [] }));
      }
      // Write whatever local state we have (could have just been set by CSV parse)
      if (teams.length || judges.length) {
        window._fbSet('judging', judgingPayload())
          .catch(e => console.error(e));
      }
      _fbConnected = true;
      const el = document.getElementById('autosave-msg');
      if (el) el.textContent = '✅ connected';
      renderTeamsTable(); updateStats(); refreshJudgesTab();
      return;
    }

    // Firebase has data — only overwrite local state if this is the initial load
    // (not a response to our own persist() call)
    if (!_fbConnected) {
      // First load — take Firebase data
      teams         = toArray(val.teams).map(t => ({ ...t, tracks: toArray(t.tracks) }));
      scores        = val.scores  || {};
      rankings      = toArray(val.rankings).map(r => ({ ...r, ranks: r.ranks || {}, rubric: r.rubric || {} }));
      sponsorAwards = toArray(val.sponsorAwards);
      judges        = toArray(val.judges).map(j => ({ ...j, tableIds: toArray(j.tableIds) }));
      if (typeof val._persistGen === 'number') {
        _persistGen = Math.max(_persistGen, val._persistGen);
      }
      if (!judges.length) {
        judges = DEFAULT_JUDGES.map((name, i) => ({ id: Date.now() + i, name, email: '', tableIds: [] }));
        window._fbSet('judging', judgingPayload()).catch(e => console.error(e));
      }
      _fbConnected = true;
    } else {
      const remoteGen = val._persistGen;
      const stale = typeof remoteGen === 'number' && remoteGen < _persistGen;
      if (!stale) {
        teams         = toArray(val.teams).map(t => ({ ...t, tracks: toArray(t.tracks) }));
        scores        = val.scores  || {};
        rankings      = toArray(val.rankings).map(r => ({ ...r, ranks: r.ranks || {}, rubric: r.rubric || {} }));
        sponsorAwards = toArray(val.sponsorAwards);
        judges        = toArray(val.judges).map(j => ({ ...j, tableIds: toArray(j.tableIds) }));
        if (typeof remoteGen === 'number') {
          _persistGen = Math.max(_persistGen, remoteGen);
        }
      }
    }

    setTimeout(() => {
      renderTeamsTable();
      updateProjectSelect();
      updateStats();
      refreshJudgesTab();
      const activePanel = document.querySelector('.panel.active');
      if (activePanel) {
        const id = activePanel.id.replace('panel-', '');
        if (id === 'leaderboard') refreshLeaderboard();
        if (id === 'tracks')      refreshTracks();
        if (id === 'rankings')    refreshRankingsTab();
        if (id === 'judges')      refreshJudgesTab();
      }
    }, 100);
    const el = document.getElementById('autosave-msg');
    if (el) el.textContent = '✅ synced ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  });
}

// ── TABS ──────────────────────────────────────────────────────────────────────
function switchTab(id, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  btn.classList.add('active');
  if (id === 'rankings')    refreshRankingsTab();
  if (id === 'leaderboard') refreshLeaderboard();
  if (id === 'tracks')      refreshTracks();
  if (id === 'judges')      refreshJudgesTab();
}

// ── JUDGES & TABLE ASSIGNMENTS ────────────────────────────────────────────────

function autoAssignTableNumbers() {
  if (!teams.length) return alert('Import teams first.');
  const mcaTeams = teams.filter(isMCACornerTeamByProject);
  const nNum = teams.length - mcaTeams.length;
  const msg = mcaTeams.length
    ? `${teams.length} teams: ${mcaTeams.length} MCA (Hardware) → Corner CSE Room (no table #); the other ${nNum} get numbers 1–${nNum}. Continue?`
    : `Auto-number all ${teams.length} teams with table numbers 1–${teams.length}?`;
  if (!confirm(msg)) return;
  let tableCounter = 1;
  teams = teams.map(t => {
    if (isMCACornerTeamByProject(t))
      return { ...t, tableNum: null, specialRoom: CORNER_CSE_ROOM_LABEL };
    return { ...t, tableNum: tableCounter++, specialRoom: null };
  });
  persist(); renderTeamsTable(); refreshJudgesTab();
}

function clearTableNumbers() {
  if (!confirm('Clear all table numbers?')) return;
  teams = teams.map(t => {
    const o = { ...t, tableNum: null };
    delete o.specialRoom;
    return o;
  });
  persist(); renderTeamsTable(); refreshJudgesTab();
}

function clearAllJudges() {
  if (!confirm('Clear ALL judges and their assignments? Cannot be undone.')) return;
  judges = [];
  persist(); refreshJudgesTab();
}

function loadDefaultJudges() {
  if (judges.length > 0 && !confirm(`This will add the 31 DiamondHacks judges to your existing list of ${judges.length}. Continue?`)) return;
  let added = 0;
  DEFAULT_JUDGES.forEach(name => {
    if (!judges.find(j => j.name.toLowerCase() === name.toLowerCase())) {
      judges.push({ id: Date.now() + Math.random(), name, email: '', tableIds: [] });
      added++;
    }
  });
  persist(); refreshJudgesTab();
  alert(`✅ Added ${added} judges (${DEFAULT_JUDGES.length - added} already existed).`);
}

function addJudge() {
  const name  = document.getElementById('judge-add-name').value.trim();
  const email = document.getElementById('judge-add-email').value.trim();
  if (!name) return alert('Please enter a judge name.');
  if (judges.find(j => j.name.toLowerCase() === name.toLowerCase())) return alert(`${name} is already in the list.`);
  judges.push({ id: Date.now(), name, email, tableIds: [] });
  document.getElementById('judge-add-name').value = '';
  document.getElementById('judge-add-email').value = '';
  persist(); refreshJudgesTab();
}

function importJudgeList() {
  const area  = document.getElementById('judge-paste-area');
  const btn   = document.getElementById('judge-paste-btn');
  area.style.display = area.style.display === 'none' ? 'block' : 'none';
  btn.style.display  = btn.style.display  === 'none' ? 'block' : 'none';
}

function confirmJudgePaste() {
  const lines = document.getElementById('judge-paste-area').value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return alert('No names found.');
  let added = 0;
  lines.forEach(name => {
    if (!judges.find(j => j.name.toLowerCase() === name.toLowerCase())) {
      judges.push({ id: Date.now() + Math.random(), name, email: '', tableIds: [] });
      added++;
    }
  });
  document.getElementById('judge-paste-area').value = '';
  document.getElementById('judge-paste-area').style.display = 'none';
  document.getElementById('judge-paste-btn').style.display = 'none';
  persist(); refreshJudgesTab();
  alert(`✅ Added ${added} judges (${lines.length - added} duplicates skipped).`);
}

function removeJudge(idx) {
  idx = parseInt(idx);
  if (isNaN(idx) || idx < 0 || idx >= judges.length) return;
  const j = judges[idx];
  if (!confirm('Remove ' + j.name + ' from the judge roster?')) return;
  judges.splice(idx, 1);
  persist(); refreshJudgesTab();
}
window.removeJudge = removeJudge;

window.doRemoveJudge = function(idx) {
  idx = parseInt(idx);
  if (isNaN(idx) || idx < 0 || idx >= judges.length) return;
  const j = judges[idx];
  if (!confirm('Remove ' + j.name + ' from the judge roster?')) return;
  judges.splice(idx, 1);
  persist(); refreshJudgesTab();
};

window.doAbsent = function(idx) {
  idx = parseInt(idx);
  if (isNaN(idx) || idx < 0 || idx >= judges.length) return;
  markAbsent(idx);
};

window.doReinstate = function(idx) {
  idx = parseInt(idx);
  if (isNaN(idx) || idx < 0 || idx >= judges.length) return;
  judges[idx].absent = false;
  persist(); refreshJudgesTab();
};

function fisherYatesShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function judgeWithFewestAssignments() {
  const active = judges.filter(j => !j.absent);
  if (!active.length) return null;
  let best = active[0];
  let minL = best.tableIds.length;
  active.forEach(j => {
    if (j.tableIds.length < minL) {
      minL = j.tableIds.length;
      best = j;
    }
  });
  return best;
}

function autoAssignJudges() {
  if (!judges.length) return alert('Add judges first.');
  const assignable = teams.filter(t =>
    (t.tableNum != null && t.tableNum !== '') || isMCACornerTeam(t)
  );
  if (!assignable.length) {
    return alert('Assign table numbers first (Step 1 — Auto-Number All Teams). MCA uses Corner CSE Room without a number.');
  }
  if (!confirm(`Auto-assign ${assignable.length} project(s) to ${judges.length} judges using a random shuffle.\nMCA (Corner CSE Room) goes to the judge with the fewest tables.\n\nThis clears existing assignments. Continue?`)) return;

  judges = judges.map(j => ({ ...j, tableIds: [] }));

  const mcaList = assignable.filter(isMCACornerTeam);
  const numbered = assignable.filter(t => !isMCACornerTeam(t));
  const shuffled = fisherYatesShuffle(numbered);

  shuffled.forEach((team, i) => {
    judges[i % judges.length].tableIds.push(team.id);
  });

  const mcaNotifyNames = [];
  mcaList.forEach(team => {
    const j = judgeWithFewestAssignments();
    if (j) {
      j.tableIds.push(team.id);
      mcaNotifyNames.push(j.name);
    }
  });

  persist(); refreshJudgesTab();

  const lo = Math.floor(assignable.length / judges.length);
  const hi = Math.ceil(assignable.length / judges.length);
  let msg = `✅ Tables assigned randomly! Each judge has about ${lo}–${hi} assignment(s).`;
  if (mcaList.length && mcaNotifyNames.length) {
    const who = [...new Set(mcaNotifyNames)].join(', ');
    msg += `\n\n📍 Corner CSE Room (MCA Hardware) → ${who}\nPlease notify them — they cover the hardware hack.`;
  } else if (mcaList.length && !mcaNotifyNames.length) {
    msg += '\n\n⚠️ MCA could not be assigned (no active judges).';
  }
  alert(msg);
}

function markAbsent(judgeIdx) {
  judgeIdx = parseInt(judgeIdx);
  if (isNaN(judgeIdx) || judgeIdx < 0 || judgeIdx >= judges.length) return;
  const absent = judges[judgeIdx];
  if (!absent.tableIds.length) return alert(absent.name + ' has no tables assigned.');
  const available = judges.filter((j, i) => i !== judgeIdx && !j.absent);
  if (!available.length) return alert('No other judges available to redistribute to.');
  if (!confirm('Mark ' + absent.name + ' as absent and redistribute their ' + absent.tableIds.length + ' tables to other judges?')) return;

  absent.absent = true;
  const reassigned = [];
  absent.tableIds.forEach((tid, i) => {
    const target = available[i % available.length];
    target.tableIds.push(tid);
    const team = teams.find(t => String(t.id) === String(tid));
    reassigned.push({ table: team ? assignmentTableLabelForTeam(team) : '?', project: team?.project || '?', to: target.name });
  });
  absent.tableIds = [];
  persist(); refreshJudgesTab();
  const summary = reassigned.map(r => '  ' + r.table + ' (' + r.project + ') → ' + r.to).join('\n');
  alert('✅ Redistributed ' + reassigned.length + ' tables from ' + absent.name + ':\n\n' + summary + '\n\nPlease notify affected judges of their updated assignments.');
}
window.markAbsent = markAbsent;

function reinstateJudge(judgeIdx) {
  judgeIdx = parseInt(judgeIdx);
  if (isNaN(judgeIdx) || judgeIdx < 0 || judgeIdx >= judges.length) return;
  judges[judgeIdx].absent = false;
  persist(); refreshJudgesTab();
}
window.reinstateJudge = reinstateJudge;

function assignmentTableLabelForTeam(team) {
  if (!team) return '?';
  if (team.specialRoom) return team.specialRoom;
  if (isMCACornerTeamByProject(team)) return CORNER_CSE_ROOM_LABEL;
  const tn = team.tableNum;
  if (tn != null && String(tn).trim().toUpperCase() === 'MCA') return CORNER_CSE_ROOM_LABEL;
  if (tn != null && tn !== '') return String(tn);
  return '?';
}

function compareAssignmentTableLabels(a, b) {
  const rank = (l) => {
    if (l === CORNER_CSE_ROOM_LABEL) return { g: 3, n: 0 };
    if (l === '?') return { g: 2, n: 0 };
    const num = Number(l);
    if (!Number.isNaN(num) && String(num) === String(l).trim()) return { g: 0, n: num };
    return { g: 1, s: String(l) };
  };
  const ra = rank(a), rb = rank(b);
  if (ra.g !== rb.g) return ra.g - rb.g;
  if (ra.g === 0) return ra.n - rb.n;
  if (ra.g === 1) return ra.s.localeCompare(rb.s);
  return 0;
}

/** Labels for CSV/print/judges tab: comma-separated, sorted (numeric table #s ascending; Corner MCA after numbers). */
function judgeAssignedTableLabels(judge) {
  const labels = judge.tableIds.map(tid => {
    const t = teams.find(tm => String(tm.id) === String(tid));
    if (!t) return '?';
    // Prefer human-readable label (table # or Corner CSE Room for MCA); plain tableNum||'?' would hide Corner.
    return assignmentTableLabelForTeam(t);
  });
  labels.sort(compareAssignmentTableLabels);
  return labels;
}

function csvEscapeCell(val) {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportJudgeAssignments() {
  if (!judges.length) return alert('No judges to export.');
  const rows = [['Judge Name', 'Assigned Tables']];
  judges.forEach(j => {
    rows.push([j.name, judgeAssignedTableLabels(j).join(', ')]);
  });
  const csv = rows.map(r => r.map(csvEscapeCell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = 'judge-assignments.csv'; a.click();
}

function escapePrintDoc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function printJudgeAssignmentSheet() {
  if (!judges.length) return alert('No judges to print.');
  const when = new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
  const bodyRows = judges.map(j => {
    const tables = escapePrintDoc(judgeAssignedTableLabels(j).join(', '));
    return `<tr><td>${escapePrintDoc(j.name)}</td><td>${tables}</td></tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Judge Assignments — Print</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; margin: 0; padding: 24px; color: #000; background: #fff; }
  .no-print { font-size: 10pt; color: #444; margin-bottom: 16px; }
  .doc-title { font-size: 14pt; font-weight: bold; margin: 0 0 6px 0; }
  .doc-meta { font-size: 10pt; margin: 0 0 20px 0; color: #222; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #000; padding: 10px 12px; text-align: left; vertical-align: top; word-wrap: break-word; }
  th { background: #f0f0f0; font-weight: bold; }
  tr { page-break-inside: avoid; }
  @media print {
    .no-print { display: none !important; }
    body { padding: 12pt; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table { font-size: 12pt; }
  }
</style></head><body>
<p class="no-print">If the print dialog does not open, use <strong>File → Print</strong>. You can close this tab after printing.</p>
<h1 class="doc-title">DiamondHacks 2026 — Judge Assignments</h1>
<p class="doc-meta">${escapePrintDoc(when)}</p>
<table>
<thead><tr><th style="width:32%">Judge Name</th><th>Assigned Tables</th></tr></thead>
<tbody>${bodyRows}</tbody>
</table>
<script>
(function(){
  function doPrint() {
    window.focus();
    window.print();
  }
  if (document.readyState === 'complete') setTimeout(doPrint, 120);
  else window.addEventListener('load', function() { setTimeout(doPrint, 120); });
})();
<\/script>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return alert('Pop-up blocked — allow pop-ups for this site to print.');
  w.document.write(html);
  w.document.close();
}
window.printJudgeAssignmentSheet = printJudgeAssignmentSheet;

function refreshJudgesTab() {
  document.getElementById('judge-count').textContent = `(${judges.length})`;

  // Update assign stats
  const assigned = judges.filter(j => j.tableIds.length > 0).length;
  const totalAssigned = judges.reduce((s, j) => s + j.tableIds.length, 0);
  document.getElementById('assign-stats').textContent =
    judges.length ? `${assigned}/${judges.length} judges assigned · ${totalAssigned} table assignments` : '';

  // Render judge list
  const el = document.getElementById('judges-list');
  if (!judges.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div><p>No judges added yet.</p></div>';
  } else {
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Judge</th><th>Email</th><th>Status</th><th>Tables</th><th>Projects Assigned</th><th></th></tr></thead>
      <tbody>${judges.map((j, i) => {
        const tableNums = judgeAssignedTableLabels(j).join(', ');
        const statusBadge = j.absent
          ? `<span class="badge badge-health">ABSENT</span>`
          : `<span class="badge badge-scored">Active</span>`;
        return `<tr style="${j.absent ? 'opacity:0.5' : ''}">
          <td style="font-weight:500">${j.name}</td>
          <td style="color:var(--muted);font-size:0.82rem">${j.email||'—'}</td>
          <td>${statusBadge}</td>
          <td style="font-family:'DM Mono',monospace;font-size:0.8rem">${tableNums || '—'}</td>
          <td style="color:var(--muted);font-size:0.82rem">${j.tableIds.length} projects</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap">
            ${j.absent
              ? `<button class="btn btn-secondary" style="padding:4px 10px;font-size:0.72rem" onclick="doReinstate(${i})">↩ Reinstate</button>`
              : `<button class="btn btn-danger" style="padding:4px 10px;font-size:0.72rem" onclick="doAbsent(${i})">⚠️ Absent</button>`}
            <button class="btn btn-danger" style="padding:4px 10px;font-size:0.72rem" onclick="doRemoveJudge(${i})">✕</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  // Render table assignments
  const tbody = document.getElementById('table-assignments-tbody');
  if (!tbody) return;
  const numbered = teams.filter(t => (t.tableNum != null && t.tableNum !== '') || t.specialRoom)
    .sort((a, b) => {
      const am = isMCACornerTeam(a) ? 1 : 0, bm = isMCACornerTeam(b) ? 1 : 0;
      if (am !== bm) return am - bm;
      return (Number(a.tableNum) || 0) - (Number(b.tableNum) || 0);
    });
  if (!numbered.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">🗂️</div><p>No table numbers assigned yet.</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = numbered.map(t => {
    const assignedJudges = judges.filter(j => j.tableIds.some(tid => String(tid) === String(t.id)));
    const judgeNames = assignedJudges.length
      ? assignedJudges.map(j => `<span class="badge ${j.absent ? 'badge-health' : 'badge-scored'}">${j.name}${j.absent ? ' (absent)' : ''}</span>`).join(' ')
      : '<span style="color:var(--muted);font-size:0.8rem">Unassigned</span>';
    const badges = t.tracks.map(trackBadge).join('') || '—';
    return `<tr>
      <td style="font-family:'DM Mono',monospace;font-weight:600;color:var(--accent)">${assignmentTableLabelForTeam(t)}</td>
      <td style="font-weight:500">${t.project}</td>
      <td style="color:var(--muted);font-size:0.85rem">${t.submitter}</td>
      <td>${badges}</td>
      <td>${judgeNames}</td>
    </tr>`;
  }).join('');
}

// ── RANKINGS ──────────────────────────────────────────────────────────────────
function refreshRankingsTab() {
  renderRankInputs();
  renderRankingsList();
  renderGlobalScores();
}

function renderRankInputs() {
  const container = document.getElementById('rank-inputs');
  if (!teams.length) {
    container.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;font-style:italic">Import teams first to see the ranking inputs.</div>';
    return;
  }
  const judgeName = document.getElementById('rank-judge-name').value.trim();
  const existing = judgeName ? rankings.find(r => r.judge === judgeName) : null;

  container.innerHTML = teams.map(t => {
    const rankVal  = existing ? (existing.ranks[t.id]  ?? '') : '';
    const rubricVal = existing ? (existing.rubric?.[t.id] ?? '') : '';
    return `<div style="display:grid;grid-template-columns:1fr 70px 70px;align-items:center;gap:8px;padding:7px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px">
      <span style="font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t.project}">${t.project}</span>
      <div style="display:flex;flex-direction:column;gap:2px;align-items:center">
        <span style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em">Rank</span>
        <input type="number" min="1" max="5" placeholder="1–5" data-teamid="${t.id}" data-type="rank"
          value="${rankVal}"
          style="width:60px;font-family:'DM Mono',monospace;text-align:center;padding:5px 4px;font-size:0.85rem"
          oninput="highlightDuplicateRanks()">
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;align-items:center">
        <span style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em">Score</span>
        <input type="number" min="0" max="40" placeholder="/40" data-teamid="${t.id}" data-type="rubric"
          value="${rubricVal}"
          style="width:60px;font-family:'DM Mono',monospace;text-align:center;padding:5px 4px;font-size:0.85rem;border-color:rgba(108,99,255,0.3)">
      </div>
    </div>`;
  }).join('');
}

function highlightDuplicateRanks() {
  const inputs = document.querySelectorAll('#rank-inputs input[data-type="rank"]');
  const seen = {}, dupes = new Set();
  inputs.forEach(inp => {
    const v = inp.value.trim();
    if (!v) return;
    if (seen[v]) dupes.add(v);
    seen[v] = true;
  });
  inputs.forEach(inp => {
    inp.style.borderColor = (inp.value && dupes.has(inp.value)) ? 'var(--accent2)' : '';
  });
}

function saveRankings() {
  const judgeName = document.getElementById('rank-judge-name').value.trim();
  if (!judgeName) return alert('Please enter the judge name.');

  const rankInputs   = document.querySelectorAll('#rank-inputs input[data-type="rank"]');
  const rubricInputs = document.querySelectorAll('#rank-inputs input[data-type="rubric"]');

  const ranks  = {};
  const rubric = {};
  const usedRanks = new Set();
  let hasAny = false;
  // Partial rankings OK: ≥1 project with a rank; each rank integer 1–5; no duplicate rank numbers for this judge.

  for (const inp of rankInputs) {
    const v = inp.value.trim();
    if (!v) continue;
    const rank = Number(v);
    if (!Number.isInteger(rank) || rank < 1 || rank > 5) {
      return alert(`Rank "${v}" must be a whole number between 1 and 5.`);
    }
    if (usedRanks.has(rank)) return alert(`Rank ${rank} is used more than once. Each rank number can only be used once.`);
    usedRanks.add(rank);
    ranks[inp.getAttribute('data-teamid')] = rank;
    hasAny = true;
  }

  for (const inp of rubricInputs) {
    const v = inp.value.trim();
    if (!v) continue;
    const score = parseFloat(v);
    if (!isNaN(score)) rubric[inp.getAttribute('data-teamid')] = score;
  }

  if (!hasAny) return alert('Please enter at least one rank.');

  const existingIdx = rankings.findIndex(r => r.judge === judgeName);
  const entry = { judge: judgeName, ranks, rubric, _savedAt: Date.now() };
  if (existingIdx >= 0) rankings[existingIdx] = entry;
  else rankings.push(entry);

  persist();
  renderTeamsTable();
  renderRankingsList();
  renderGlobalScores();
  refreshTracks();
  document.getElementById('rank-judge-name').value = '';
  renderRankInputs();
  alert('✅ Rankings saved for ' + judgeName + '!');
}

function deleteRanking(idx) {
  if (!confirm('Remove rankings for ' + rankings[idx].judge + '?')) return;
  rankings.splice(idx, 1);
  persist();
  renderRankingsList();
  renderGlobalScores();
  refreshTracks();
}
window.deleteRanking = deleteRanking;

function loadJudgeRankings() {
  // Called when judge name field changes — pre-fills rank inputs if judge already has data
  renderRankInputs();
}

function renderRankingsList() {
  const el = document.getElementById('rankings-list');
  if (!rankings.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🏅</div><p>No rankings entered yet.</p></div>';
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Judge</th><th>Projects Ranked</th><th>Rankings</th><th></th></tr></thead>
    <tbody>${rankings.map((r, i) => {
      const ranked = Object.entries(r.ranks).sort((a,b) => a[1]-b[1]);
      const summary = ranked.map(([tid, rank]) => {
        const team = teams.find(t => String(t.id) === String(tid));
        return `<span style="font-size:0.75rem;color:var(--muted)">#${rank} <span style="color:var(--text)">${team ? team.project : '?'}</span></span>`;
      }).join(' &nbsp;·&nbsp; ');
      return `<tr>
        <td style="font-weight:500">${r.judge}</td>
        <td style="font-family:'DM Mono',monospace;color:var(--muted)">${ranked.length}</td>
        <td style="font-size:0.82rem;line-height:1.8">${summary}</td>
        <td><button class="btn btn-secondary" style="padding:5px 10px;font-size:0.75rem" onclick="editRanking(${i})">✏️ Edit</button>
            <button class="btn btn-danger" style="padding:5px 10px;font-size:0.75rem" onclick="deleteRanking(${i})">✕</button></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function sumRubricPointsForTeam(teamId) {
  let s = 0;
  const want = String(teamId);
  rankings.forEach(r => {
    const rub = r.rubric || {};
    for (const k of Object.keys(rub)) {
      if (String(k) !== want) continue;
      const v = rub[k];
      if (typeof v === 'number' && !Number.isNaN(v)) s += v;
    }
  });
  return s;
}

function calcGlobalScores() {
  const POINTS = { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1 };
  const teamPoints = {};
  const teamCounts = {};
  rankings.forEach(r => {
    Object.entries(r.ranks || {}).forEach(([tid, rank]) => {
      const rk = parseInt(rank, 10);
      const pts = POINTS[rk] || 0;
      teamPoints[tid] = (teamPoints[tid] || 0) + pts;
      teamCounts[tid] = (teamCounts[tid] || 0) + 1;
    });
  });
  return Object.entries(teamPoints).map(([tid, pts]) => {
    const team = teams.find(t => String(t.id) === String(tid));
    return { tid, team, avg: pts, count: teamCounts[tid] || 0 };
  }).sort((a, b) => {
    if (b.avg !== a.avg) return b.avg - a.avg;
    return sumRubricPointsForTeam(b.tid) - sumRubricPointsForTeam(a.tid);
  });
}

function renderGlobalScores() {
  const el = document.getElementById('global-scores-content');
  const results = calcGlobalScores();
  if (!results.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>Enter rankings above to see total points.</p></div>';
    return;
  }
  const rc = i => i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'';
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Rank</th><th>Project</th><th>Submitter</th><th>Points</th><th>Judges who ranked</th></tr></thead>
    <tbody>${results.map((r, i) => `<tr>
      <td><span class="rank-num ${rc(i)}">${i+1}</span></td>
      <td style="font-weight:500">${r.team ? r.team.project : '(unknown)'}</td>
      <td style="color:var(--muted)">${r.team ? r.team.submitter : '—'}</td>
      <td><span class="score-pill">${Math.round(r.avg)} pts</span></td>
      <td style="font-family:'DM Mono',monospace;color:var(--muted)">${r.count}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ── CSV PARSER (proper RFC 4180 — handles quoted multiline fields) ─────────────
function parseCSVFull(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], nx = text[i+1];
    if (inQ) {
      if (c==='"' && nx==='"') { field+='"'; i++; }
      else if (c==='"')         { inQ=false; }
      else                      { field+=c; }
    } else {
      if      (c==='"')         { inQ=true; }
      else if (c===',')         { row.push(field); field=''; }
      else if (c==='\n' || (c==='\r' && nx==='\n')) {
        if (c==='\r') i++;
        row.push(field); field='';
        if (row.some(x => x.trim())) rows.push(row);
        row=[];
      } else { field+=c; }
    }
  }
  if (field || row.length) { row.push(field); if (row.some(x=>x.trim())) rows.push(row); }
  return rows;
}

function mapTrack(raw) {
  const cleaned = raw.replace(/^Track\s*\d+[:\-]\s*/i, '').trim();

  if (/social|sustain|environ|alchemy|earth/i.test(cleaned))         return 'Social Impact';
  if (/health|medical|patient|hospital|elixir|vital/i.test(cleaned)) return 'Health';
  if (/educ|learn|school|study|scholar|spellbook/i.test(cleaned))    return 'Education';
  if (/commerc|financ|business|enchanted|shop|ecomm/i.test(cleaned)) return 'Commerce';
  if (/wildcard|wild.card|rogue|ritual|anomal/i.test(cleaned))       return 'Wildcard';
  if (/beginner|first.time|starter/i.test(cleaned))                  return 'Best Beginner Hack';
  if (/solo/i.test(cleaned))                                          return 'Best Solo Hack';
  if (/duo/i.test(cleaned))                                           return 'Best Duo Hack';
  if (/ui.?ux|design|interface/i.test(cleaned))                      return 'Best UI/UX';
  if (/\bai\b|\bml\b|machine.?learn|gemini|gpt|llm/i.test(cleaned)) return 'Best AI/ML';
  if (/mobile|ios|android/i.test(cleaned))                           return 'Best Mobile App';

  return null;
}

function setCsvParseDebug(lines) {
  const text = Array.isArray(lines) ? lines.join('\n') : String(lines);
  const el = document.getElementById('csv-parse-debug');
  const wrap = document.getElementById('csv-parse-debug-wrap');
  if (el) el.textContent = text;
  if (wrap) wrap.open = true;
  console.warn('[CSV parse diagnostics]\n' + text);
}

function parseDevpostCSV() {
  const lines = [];
  const log = (s) => { lines.push(s); };

  try {
    log('— ' + new Date().toISOString() + ' —');
    log('1) parseDevpostCSV() was called (button / upload handler ran).');

    const ta = document.getElementById('csv-input');
    if (!ta) {
      log('FAIL: #csv-input not found in the DOM.');
      setCsvParseDebug(lines);
      alert('Internal error: CSV textarea missing. Check the diagnostics box below.');
      return;
    }

    const raw = ta.value.trim();
    log('2) Textarea length (trimmed): ' + raw.length + ' chars.');
    if (!raw) {
      log('STOP: Empty textarea — paste CSV text or use file upload.');
      setCsvParseDebug(lines);
      alert('Please paste or upload a CSV file first.');
      return;
    }

    const preview = raw.slice(0, 200).replace(/\n/g, '\\n');
    log('3) First ~200 chars: ' + preview + (raw.length > 200 ? '…' : ''));

    const rows = parseCSVFull(raw);
    log('4) parseCSVFull → ' + rows.length + ' row(s).');
    if (rows.length < 2) {
      log('STOP: Need a header row + at least one data row.');
      setCsvParseDebug(lines);
      alert('Could not parse CSV — only ' + rows.length + ' row(s) found. Make sure you uploaded the full file.');
      return;
    }

    const headers = rows[0].map(h => h.trim().toLowerCase());
    log('5) Header count: ' + headers.length + '. Columns (first 25):');
    log('   ' + headers.slice(0, 25).map((h, i) => '[' + i + '] ' + JSON.stringify(h)).join(' | '));
    if (headers.length > 25) log('   … +' + (headers.length - 25) + ' more');

    const col = (...names) => names.reduce((f,n) => f!==-1 ? f : headers.findIndex(h => h.includes(n)), -1);

    const titleIdx    = col('project title', 'submission title', 'project name', 'title');
    const tableIdx    = col('table number', 'table #', 'table num');
    const mainTrackIdx    = col('please select a main track', 'select a main track', 'please select a track', 'select a track');
    const sponsorTrackIdx = col('select a sponsor track', 'sponsor track', 'sponsor / special prizes', 'sponsor/special');
    const sideTrackIdx    = col('select a side track', 'side track');
    const prizesIdx       = col('opt-in prizes', 'prizes');
    const firstIdx    = col('submitter first name', 'first name');
    const lastIdx     = col('submitter last name', 'last name');
    const sizeIdx     = col('how many people', 'team size', 'members');

    log('6) Column indices → title:' + titleIdx + ' table:' + tableIdx + ' mainTrack:' + mainTrackIdx +
        ' sponsor:' + sponsorTrackIdx + ' side:' + sideTrackIdx + ' prizes:' + prizesIdx +
        ' first:' + firstIdx + ' last:' + lastIdx + ' size:' + sizeIdx);

    if (titleIdx === -1) {
      log('STOP: No column matched "project title" / "title". Your export may use a different header name.');
      log('    Tip: Devpost sometimes uses "Submission Title" or similar — we can add that match if you confirm the exact header.');
      setCsvParseDebug(lines);
      alert('Could not find "Project Title" column. Is this a Devpost CSV? Open Parse diagnostics below for headers.');
      return;
    }

    const SKIP = new Set(['']);
    const added = [];
    const conflicts = [];
    let skippedRows = 0;

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const title = (r[titleIdx] || '').trim();
      if (!title || SKIP.has(title.toLowerCase())) {
        skippedRows++;
        continue;
      }

      const rawMain    = (r[mainTrackIdx]    || '').trim();
      const rawSponsor = sponsorTrackIdx !== -1 ? (r[sponsorTrackIdx] || '').trim() : '';
      const rawSide    = sideTrackIdx    !== -1 ? (r[sideTrackIdx]    || '').trim() : '';
      const rawPrizes  = (r[prizesIdx]       || '').trim();
      const first      = (r[firstIdx]        || '').trim();
      const last       = (r[lastIdx]         || '').trim();
      const size       = parseInt(r[sizeIdx] || '0') || 0;
      const tableNum   = tableIdx !== -1 ? (parseInt(r[tableIdx]) || null) : null;

      const tset = new Set();

      const m1 = mapTrack(rawMain); if (m1) tset.add(m1);

      if (rawSponsor) rawSponsor.split(',').forEach(p => {
        const m = mapTrack(p.trim()); if (m) tset.add(m);
      });

      if (rawSide) rawSide.split(',').forEach(p => {
        const m = mapTrack(p.trim()); if (m) tset.add(m);
      });

      if (rawPrizes && !rawSponsor && !rawSide) {
        rawPrizes.split(',').forEach(p => {
          p = p.trim();
          if (p.toUpperCase().startsWith('MLH')) return;
          const m = mapTrack(p); if (m) tset.add(m);
        });
      }

      if (size === 1 && !tset.has('Best Solo Hack')) tset.add('Best Solo Hack');
      else if (size === 2 && !tset.has('Best Duo Hack')) tset.add('Best Duo Hack');

      const hasSolo = tset.has('Best Solo Hack');
      const hasDuo  = tset.has('Best Duo Hack');
      const conflict = hasSolo && hasDuo;
      if (conflict) conflicts.push(title);

      const isMCA = title.trim().toUpperCase() === 'MCA';
      const row = {
        id: Date.now() + i,
        project: title,
        submitter: [first, last].filter(Boolean).join(' ') || 'Unknown',
        tracks: [...tset],
        tableNum: isMCA ? null : tableNum,
      };
      if (isMCA) row.specialRoom = CORNER_CSE_ROOM_LABEL;
      if (conflict) row.conflict = true;
      added.push(row);
    }

    log('7) Data rows skipped (empty title): ' + skippedRows + '. Projects parsed: ' + added.length + '.');

    if (!added.length) {
      log('STOP: No rows produced a project title. Check title column and that rows are not all blank.');
      if (rows[1]) log('8) Sample row 1 cells (first 8): ' + rows[1].slice(0, 8).map(c => JSON.stringify((c||'').slice(0, 40))).join(' | '));
      setCsvParseDebug(lines);
      alert('No valid projects found. Open Parse diagnostics below for details.');
      return;
    }

    teams = added;
    scores = {};
    rankings = [];

    const hasTableNums = added.some(t => t.tableNum != null || t.specialRoom);

    log('9) Assigned teams.length = ' + teams.length + ' (in memory).');
    log('10) Firebase: _fbSet ' + (typeof window._fbSet === 'function' ? 'available' : 'NOT READY (will use localStorage only in persist)') + '.');
    log('    _persistGen before persist: ' + (typeof _persistGen !== 'undefined' ? _persistGen : '(n/a)'));

    persist();

    log('    _persistGen after persist: ' + (typeof _persistGen !== 'undefined' ? _persistGen : '(n/a)'));

    const tbody = document.getElementById('teams-tbody');
    log('11) #teams-tbody exists: ' + !!tbody + '. Calling renderTeamsTable()…');
    renderTeamsTable();
    updateProjectSelect();
    updateStats();
    log('12) After render, stat-teams text: "' + (document.getElementById('stat-teams') && document.getElementById('stat-teams').textContent) + '".');
    log('DONE: Success — if the table is still empty, check the Teams tab / scroll; or a script error after this line in console.');

    setCsvParseDebug(lines);

    let msg = '✅ Imported ' + added.length + ' projects!';
    if (hasTableNums) msg += '\n📋 Table numbers / room info imported from CSV.';
    if (conflicts.length) msg += '\n\n⚠️ Solo+Duo conflict detected on ' + conflicts.length + ' project(s):\n' + conflicts.join('\n') + '\n\nThese teams are flagged in red — remove them from one track manually.';
    alert(msg);
  } catch (err) {
    log('EXCEPTION: ' + (err && err.message));
    log((err && err.stack) || '');
    setCsvParseDebug(lines);
    alert('CSV parse crashed — see "Parse diagnostics" below and browser console (F12). Error: ' + (err && err.message));
  }
}
window.parseDevpostCSV = parseDevpostCSV;
// ── MANUAL ADD ────────────────────────────────────────────────────────────────
function addManualTeam() {
  const project   = document.getElementById('manual-project').value.trim();
  const submitter = document.getElementById('manual-team').value.trim();
  const tracks    = Array.from(document.getElementById('manual-tracks').selectedOptions).map(o => o.value);
  if (!project) return alert('Please enter a project name.');
  const row = { id: Date.now(), project, submitter: submitter || 'Unknown', tracks };
  if (project.toUpperCase() === 'MCA') {
    row.tableNum = null;
    row.specialRoom = CORNER_CSE_ROOM_LABEL;
  }
  teams.push(row);
  renderTeamsTable(); updateProjectSelect(); updateStats(); persist();
  document.getElementById('manual-project').value = '';
  document.getElementById('manual-team').value = '';
}

// ── FILE UPLOAD ───────────────────────────────────────────────────────────────
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    // Strip BOM if present, normalize line endings
    let text = e.target.result;
    text = text.replace(/^\uFEFF/, ''); // strip BOM
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); // normalize line endings
    document.getElementById('csv-input').value = text;
    setCsvParseDebug(['(file upload) Read ' + file.name + ', ' + text.length + ' chars — running parse…']);
    parseDevpostCSV();
  };
  reader.onerror = () => {
    setCsvParseDebug(['(file upload) FileReader failed — could not read file.']);
    alert('Could not read the file. See Parse diagnostics below.');
  };
  reader.readAsText(file, 'UTF-8');
}
window.handleFileUpload = handleFileUpload;

function doRemoveTeam(idx) {
  idx = parseInt(idx);
  if (isNaN(idx) || idx < 0 || idx >= teams.length) return;
  const team = teams[idx];
  if (!confirm('Remove "' + team.project + '"?')) return;
  teams.splice(idx, 1);
  persist();
  renderTeamsTable(); updateProjectSelect(); updateStats();
}
window.doRemoveTeam = doRemoveTeam;

// ── EDIT TEAM ─────────────────────────────────────────────────────────────────
window.doEditTeam = function(idx) {
  idx = parseInt(idx);
  if (isNaN(idx) || idx < 0 || idx >= teams.length) return;
  const t = teams[idx];

  const allTracks = [
    'Social Impact','Health','Education','Commerce','Wildcard',
    'Best Solo Hack','Best Duo Hack','Best Beginner Hack',
    'Best AI/ML','Best UI/UX','Best Mobile App'
  ];

  const trackCheckboxes = allTracks.map(tr => {
    const checked = t.tracks.includes(tr) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;margin-bottom:4px;cursor:pointer">
      <input type="checkbox" value="${tr}" ${checked} style="accent-color:var(--accent)"> ${tr}
    </label>`;
  }).join('');

  // Create modal overlay
  const modal = document.createElement('div');
  modal.id = 'edit-team-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;width:100%;max-width:500px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.8)">
      <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:1.1rem;margin-bottom:20px;color:var(--text)">✏️ Edit Team</div>
      <div class="form-group">
        <label>Project Name</label>
        <input type="text" id="edit-project" value="${t.project}" style="width:100%">
      </div>
      <div class="form-group">
        <label>Submitter</label>
        <input type="text" id="edit-submitter" value="${t.submitter}" style="width:100%">
      </div>
      <div class="form-group">
        <label>Table Number</label>
        ${isMCACornerTeam(t)
          ? '<div style="font-size:0.85rem;color:var(--muted);line-height:1.4">📍 <strong>Corner CSE Room</strong> (MCA Hardware). No table number — use <strong>Auto-Number All Teams</strong> if this row lost its room label.</div>'
          : `<input type="number" id="edit-table" value="${t.tableNum != null ? t.tableNum : ''}" style="width:80px">`}
      </div>
      <div class="form-group">
        <label style="margin-bottom:8px;display:block">Tracks</label>
        <div id="edit-track-checks" style="display:grid;grid-template-columns:1fr 1fr;gap:2px">${trackCheckboxes}</div>
      </div>
      <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="document.getElementById('edit-team-modal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="saveEditTeam(${idx})">💾 Save Changes</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
};

window.saveEditTeam = function(idx) {
  idx = parseInt(idx);
  const project   = document.getElementById('edit-project').value.trim();
  const submitter = document.getElementById('edit-submitter').value.trim();
  const tableEl   = document.getElementById('edit-table');
  let tableNum = null;
  if (tableEl) {
    const parsed = parseInt(tableEl.value, 10);
    tableNum = Number.isNaN(parsed) ? null : parsed;
  }
  const tracks    = Array.from(document.querySelectorAll('#edit-track-checks input:checked')).map(c => c.value);

  if (!project) return alert('Project name cannot be empty.');

  const hasSolo = tracks.includes('Best Solo Hack');
  const hasDuo  = tracks.includes('Best Duo Hack');
  const conflict = hasSolo && hasDuo;

  const base = { ...teams[idx], project, submitter: submitter || 'Unknown', tracks };
  if (project.toUpperCase() === 'MCA') {
    base.tableNum = null;
    base.specialRoom = CORNER_CSE_ROOM_LABEL;
  } else {
    base.tableNum = tableNum;
    delete base.specialRoom;
  }
  teams[idx] = base;
  if (conflict) teams[idx].conflict = true;
  else delete teams[idx].conflict;
  persist(); renderTeamsTable(); refreshJudgesTab();
  document.getElementById('edit-team-modal').remove();
  if (conflict) alert('⚠️ This team still has both Solo and Duo hack selected — please remove one.');
};

function clearAllTeams() {
  if (!confirm('Clear ALL teams, scores, rankings, and judge assignments? Cannot be undone.')) return;
  teams = []; scores = {}; rankings = []; judges = [];
  persist();
  renderTeamsTable(); updateProjectSelect(); updateStats();
  document.getElementById('autosave-msg').textContent = '🔄 clearing...';
}

// ── BADGE HELPER ──────────────────────────────────────────────────────────────
function trackBadge(tr) {
  const t = TMAP[tr];
  return t ? `<span class="badge ${t.cls}">${t.icon} ${tr}</span>` : `<span class="badge badge-other">${tr}</span>`;
}

// ── RENDER TEAMS TABLE ────────────────────────────────────────────────────────
function renderTeamsTable() {
  const tbody = document.getElementById('teams-tbody');
  document.getElementById('team-count').textContent = `(${teams.length})`;
  if (!teams.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📂</div><p>No teams imported yet.</p></div></td></tr>';
    return;
  }
  const rankCountMap = {};
  rankings.forEach(r => {
    Object.keys(r.ranks || {}).forEach(tid => {
      rankCountMap[tid] = (rankCountMap[tid] || 0) + 1;
    });
  });

  tbody.innerHTML = teams.map((t, i) => {
    const jc = rankCountMap[String(t.id)] || 0;
    const status = jc > 0
      ? `<span class="badge badge-scored">✓ ${jc} judge${jc>1?'s':''} ranked</span>`
      : `<span class="badge badge-unscored">Pending</span>`;
    const badges = t.tracks.map(trackBadge).join('') || '<span style="color:var(--muted);font-size:0.8rem">—</span>';
    const conflictFlag = t.conflict
      ? `<span class="badge badge-health" title="This team selected both Solo and Duo hack — remove one manually">⚠️ Solo+Duo conflict</span>`
      : '';
    const rowStyle = t.conflict ? 'background:rgba(255,101,132,0.06)' : '';
    const mcaHardware = isMCACornerTeam(t);
    const cornerBadge = `<span style="display:inline-flex;align-items:center;padding:6px 10px;border-radius:8px;background:rgba(108,99,255,0.22);border:1px solid rgba(139,92,246,0.5);color:#d8ccff;font-size:0.78rem;font-weight:600">📍 Corner CSE Room</span>`;
    const tableCell = mcaHardware
      ? cornerBadge
      : `<span style="display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px"><input type="number" min="1" value="${t.tableNum != null ? t.tableNum : ''}" placeholder="—"
        style="width:60px;font-family:'DM Mono',monospace;text-align:center;padding:4px 6px;font-size:0.82rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text)"
        onchange="setTableNum(${i}, this.value)">${getRowLabel(t.tableNum)}</span>`;
    const hwTag = mcaHardware ? '<span title="Hardware hack (MCA)" style="font-size:0.8rem;margin-left:8px;opacity:0.9">🔧</span>' : '';
    return `<tr style="${rowStyle}">
      <td>${tableCell}</td>
      <td style="font-weight:500">${t.project}${hwTag}</td>
      <td style="color:var(--muted);font-size:0.82rem">${t.submitter}</td>
      <td>${badges} ${conflictFlag}</td>
      <td>${status}</td>
      <td><button class="btn btn-secondary" style="padding:4px 10px;font-size:0.72rem" onclick="doEditTeam(${i})">✏️</button></td>
      <td><button class="btn btn-danger" style="padding:4px 10px;font-size:0.72rem" onclick="doRemoveTeam(${i})">✕</button></td>
    </tr>`;
  }).join('');
}

function setTableNum(idx, val) {
  const t = teams[idx];
  if (!t || isMCACornerTeam(t)) return;
  const num = parseInt(val, 10);
  t.tableNum = Number.isNaN(num) ? null : num;
  delete t.specialRoom;
  persist();
}
window.setTableNum = setTableNum;

// ── LEADERBOARD ───────────────────────────────────────────────────────────────
function getAvg(teamId) {
  const e = Object.values(scores[teamId]||{});
  return e.length ? +(e.reduce((s,x)=>s+(x.total||0),0)/e.length).toFixed(2) : null;
}

function refreshLeaderboard() {
  const area = document.getElementById('leaderboard-content');
  if (!teams.length) { area.innerHTML='<div class="empty-state"><div class="empty-icon">🏆</div><p>No teams yet.</p></div>'; return; }

  const globalResults = calcGlobalScores();
  if (!globalResults.length) {
    area.innerHTML='<div class="empty-state"><div class="empty-icon">🏆</div><p>No rankings entered yet. Go to the Rankings tab to enter judge rankings.</p></div>';
    return;
  }

  // merge in teams that have no rankings yet (show at bottom)
  const rankedIds = new Set(globalResults.map(r => String(r.tid)));
  const unranked = teams.filter(t => !rankedIds.has(String(t.id)));

  const rc = i => i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'';
  area.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Rank</th><th>Project</th><th>Submitter</th><th>Points</th><th>Judges who ranked</th><th>Tracks</th></tr></thead>
    <tbody>
    ${globalResults.map((r,i) => `<tr>
      <td><span class="rank-num ${rc(i)}">${i+1}</span></td>
      <td style="font-weight:500">${r.team ? r.team.project : '?'}</td>
      <td style="color:var(--muted)">${r.team ? r.team.submitter : '—'}</td>
      <td><span class="score-pill">⚡ ${Math.round(r.avg)} pts</span></td>
      <td style="font-family:'DM Mono',monospace;color:var(--muted)">${r.count}</td>
      <td>${r.team ? r.team.tracks.map(trackBadge).join('') : '—'}</td>
    </tr>`).join('')}
    ${unranked.map(t => `<tr style="opacity:0.4">
      <td><span class="rank-num">—</span></td>
      <td style="font-weight:500">${t.project}</td>
      <td style="color:var(--muted)">${t.submitter}</td>
      <td style="color:var(--muted);font-size:0.82rem">No rankings yet</td>
      <td style="font-family:'DM Mono',monospace;color:var(--muted)">0</td>
      <td>${t.tracks.map(trackBadge).join('')||'—'}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// ── TRACKS ────────────────────────────────────────────────────────────────────
const MAIN_TRACKS    = TRACKS.filter(t => t.main);
const GENERIC_TRACKS = TRACKS.filter(t => !t.main);

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toggleTrackExpandByDomId(domId) {
  const el = document.getElementById(domId);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
window.toggleTrackExpandByDomId = toggleTrackExpandByDomId;

function refreshTracks() {
  const area = document.getElementById('tracks-content');
  if (!area) return;
  if (!teams.length) {
    area.innerHTML = '<div class="empty-state"><div class="empty-icon">🎯</div><p>No data yet.</p></div>';
    return;
  }

  try {
  const globalResults = calcGlobalScores();
  const globalMap = {};
  globalResults.forEach(r => { globalMap[String(r.tid)] = r; });

  const trackTags = t => (Array.isArray(t.tracks) ? t.tracks : []);
  function teamEligibleForTrack(t, trackId) {
    const tr = trackTags(t);
    if (tr.includes(trackId)) return true;
    if (!tr.length && trackId === 'Wildcard') return true;
    return false;
  }

  function trackTopN(trackId, n = 3) {
    return teams
      .filter(t => teamEligibleForTrack(t, trackId))
      .map(t => ({ ...t, gs: globalMap[String(t.id)] }))
      .filter(t => t.gs && typeof t.gs.avg === 'number' && !Number.isNaN(t.gs.avg))
      .sort((a, b) => {
        if (b.gs.avg !== a.gs.avg) return b.gs.avg - a.gs.avg;
        return sumRubricPointsForTeam(b.id) - sumRubricPointsForTeam(a.id);
      })
      .slice(0, n);
  }

  function trackCard(track) {
    const top = trackTopN(track.id, 10);
    const [winner, ru1, ru2, ...rest] = top;
    const expandId = 'track-expand-' + track.id.replace(/[^a-z0-9]/gi, '_');
    const fullList = top.map((t, i) => {
      const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.82rem">
        <span>${medal} <span style="color:var(--text)">${escapeHtml(t.project)}</span> <span style="color:var(--muted);font-size:0.75rem">· ${escapeHtml(t.submitter)}</span></span>
        <span class="score-pill" style="font-size:0.72rem">${Math.round(t.gs.avg)} pts</span>
      </div>`;
    }).join('');

    const toggleFn = `toggleTrackExpandByDomId('${expandId}')`;
    return `<div class="track-card" onclick="${toggleFn}" style="cursor:pointer">
      <div class="track-name">${track.icon} ${escapeHtml(track.label)} <span style="float:right;font-size:0.65rem;color:var(--muted)">click to expand ▾</span></div>
      ${winner
        ? `<div class="track-winner">${escapeHtml(winner.project)}</div>
           <div class="track-score">${escapeHtml(winner.submitter)} · ${Math.round(winner.gs.avg)} pts</div>
           ${ru1 ? `<div style="margin-top:6px;font-size:0.82rem;color:var(--muted)">🥈 ${escapeHtml(ru1.project)} · ${Math.round(ru1.gs.avg)} pts</div>` : ''}
           ${ru2 ? `<div style="margin-top:6px;font-size:0.82rem;color:var(--muted)">🥉 ${escapeHtml(ru2.project)} · ${Math.round(ru2.gs.avg)} pts</div>` : ''}`
        : `<div class="track-winner" style="color:var(--muted);font-size:0.88rem">No eligible ranked teams</div>`}
      <div id="${expandId}" style="display:none;margin-top:12px;padding-top:12px;border-top:2px solid var(--border)">
        <div style="font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Full Rankings for this Track</div>
        ${top.length ? fullList : '<div style="color:var(--muted);font-size:0.82rem">No ranked teams</div>'}
      </div>
    </div>`;
  }

  const rankedButNoTrack = teams.filter(t => globalMap[String(t.id)] && !trackTags(t).length);
  let html = '';
  if (!globalResults.length) {
    const anyRanks = rankings.some(r => r.ranks && Object.keys(r.ranks).length);
    html += anyRanks
      ? `<div class="notice" style="margin-bottom:16px"><strong>Track tab:</strong> Rankings are saved but no point totals were computed (no valid rank 1–5 entries yet).</div>`
      : `<div class="notice" style="margin-bottom:16px"><strong>Track tab:</strong> Enter and save judge rankings on tab ③ first — winners are derived from those rankings.</div>`;
  } else if (rankedButNoTrack.length) {
    html += `<div class="notice" style="margin-bottom:16px"><strong>${rankedButNoTrack.length} ranked project(s)</strong> have <strong>no track tags</strong> from the CSV (or tracks were cleared). They are listed under <strong>Wildcard</strong> only until you edit the team and assign tracks on tab ①.</div>`;
  }

  // Overall top 5 (with runner-ups)
  html += '<div class="section-title" style="margin-bottom:16px">🏆 Overall Winners</div>';
  html += '<div class="tracks-grid" style="margin-bottom:28px">';
  const medals = ['🥇 1st Place','🥈 2nd Place','🥉 3rd Place','4th Place','5th Place'];
  medals.forEach((lbl,i) => {
    const r = globalResults[i];
    html += `<div class="track-card" style="${i >= 3 ? 'opacity:0.7' : ''}">
      <div class="track-name">${escapeHtml(lbl)}</div>
      ${r ? `<div class="track-winner">${r.team ? escapeHtml(r.team.project) : '?'}</div>
             <div class="track-score">${r.team ? escapeHtml(r.team.submitter) : ''} · ${Math.round(r.avg)} pts</div>`
          : `<div class="track-winner" style="color:var(--muted)">TBD</div>`}
    </div>`;
  });
  html += '</div>';

  // Main theme tracks
  html += '<div class="section-title" style="margin-bottom:16px">🌍 Main Theme Tracks</div>';
  html += '<div class="tracks-grid" style="margin-bottom:28px">';
  MAIN_TRACKS.forEach(track => { html += trackCard(track); });
  html += '</div>';

  // Generic tracks
  html += '<div class="section-title" style="margin-bottom:16px">🛠️ Generic Tracks</div>';
  html += '<div class="tracks-grid" style="margin-bottom:28px">';
  GENERIC_TRACKS.forEach(track => { html += trackCard(track); });
  html += '</div>';

  // Sponsor awards
  html += '<div class="section-title" style="margin-bottom:16px">🏢 Sponsor Awards</div>';
  html += `<div class="card" style="margin-bottom:16px">
    <h3>➕ Add Sponsor Award</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:12px;align-items:end">
      <div class="form-group" style="margin-bottom:0">
        <label>Sponsor Name</label>
        <input type="text" id="sponsor-name" placeholder="e.g. Qualcomm">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label>Award Name</label>
        <input type="text" id="sponsor-award" placeholder="e.g. Best Use of AI">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label>Winning Project</label>
        <select id="sponsor-project">
          <option value="">— Select project —</option>
          ${teams.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.project)}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary" onclick="addSponsorAward()" style="white-space:nowrap">Add Award</button>
    </div>
  </div>`;

  if (sponsorAwards.length) {
    html += '<div class="tracks-grid">';
    sponsorAwards.forEach((sa, i) => {
      html += `<div class="track-card">
        <div class="track-name">🏢 ${escapeHtml(sa.sponsor)}</div>
        <div style="font-size:0.75rem;color:var(--muted);margin-bottom:6px">${escapeHtml(sa.award)}</div>
        <div class="track-winner">${escapeHtml(sa.project)}</div>
        <button class="btn btn-danger" style="padding:4px 10px;font-size:0.72rem;margin-top:10px" onclick="deleteSponsorAward(${i})">✕ Remove</button>
      </div>`;
    });
    html += '</div>';
  } else {
    html += '<div style="color:var(--muted);font-size:0.88rem;font-style:italic;padding:12px 0">No sponsor awards added yet.</div>';
  }

  area.innerHTML = html;
  } catch (err) {
    console.error('refreshTracks:', err);
    area.innerHTML = `<div class="notice" style="border-color:var(--accent2)"><strong>Track tab error:</strong> ${escapeHtml(err.message || err)}<br><br>Open the browser console (F12) for details. This is a bug — not intentional.</div>`;
  }
}

function addSponsorAward() {
  const sponsor = document.getElementById('sponsor-name').value.trim();
  const award   = document.getElementById('sponsor-award').value.trim();
  const projId  = document.getElementById('sponsor-project').value;
  if (!sponsor || !award || !projId) return alert('Please fill in all three fields.');
  const team = teams.find(t => String(t.id) === String(projId));
  if (!team) return alert('Project not found.');
  sponsorAwards.push({ sponsor, award, project: team.project });
  persist();
  refreshTracks();
}
window.addSponsorAward = addSponsorAward;

function deleteSponsorAward(idx) {
  if (!confirm('Remove this sponsor award?')) return;
  sponsorAwards.splice(idx, 1);
  persist();
  refreshTracks();
}
window.deleteSponsorAward = deleteSponsorAward;

// ── EXPORT ────────────────────────────────────────────────────────────────────
function exportResults() {
  const ranked = teams.map(t=>({...t,avg:getAvg(t.id),jc:Object.keys(scores[t.id]||{}).length}))
    .sort((a,b)=>(b.avg??-1)-(a.avg??-1));
  const rows = [['Rank','Project','Submitter','Avg Score','Judges','Tracks']];
  ranked.forEach((t,i) => rows.push([i+1,t.project,t.submitter,t.avg??'',t.jc,t.tracks.join('; ')]));
  rows.push([],['--- Individual Judge Scores ---'],['Project','Submitter','Judge','Idea','Experience','Implementation','Demo','Total']);
  teams.forEach(t => Object.entries(scores[t.id]||{}).forEach(([j,sc]) =>
    rows.push([t.project,t.submitter,j,sc.idea??'',sc.experience??'',sc.implementation??'',sc.demo??'',sc.total??''])));
  const csv = rows.map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = 'diamondhacks-2026-results.csv'; a.click();
}

// ── STATS ─────────────────────────────────────────────────────────────────────
// stub — project select dropdown removed with tiebreaker tab
function updateProjectSelect() {}

function updateStats() {
  document.getElementById('stat-teams').textContent = teams.length;
  // Count unique judges who have submitted rankings
  const jset = new Set(rankings.map(r => r.judge));
  document.getElementById('stat-scores').textContent = rankings.length;
  document.getElementById('stat-judges').textContent = jset.size;
  // % of teams that have at least one ranking
  const rankedTeamIds = new Set(rankings.flatMap(r => Object.keys(r.ranks||{})));
  const pct = teams.length ? Math.round(rankedTeamIds.size / teams.length * 100) : 0;
  document.getElementById('stat-pct').textContent = pct + '%';
}

// ── INIT ──────────────────────────────────────────────────────────────────────
const DEFAULT_JUDGES = [
  "Kulkarni, Shubham","Khurana, Rahul","Srivastava, Kshitij Kumar","Bose, Snigdha",
  "FNU Lovleen Kaur","Aditya Raj","Jasdeep Singh Bhalla","Khandelwal, Sandeep Kumar",
  "Lazor, Yaroslav","Bagmar, Vivek","Vasu Raj Jain","Divyanshu Abhichandani",
  "Verma, Ishita","Gautham Kanekal Guruswamy","Sharma, Saumitra","Nikhil Singhal",
  "Tyagi, Shruti","Patel, Dev","Govindaraj, Sowmiya Narayanan","Bamotra, Abhishek",
  "Gupta, Rajesh","Jing Yao","Gkatzonis, Konstantinos","Sun, Allan",
  "Prasenjit Sinha","Li, Zhuohan","Aneri Shah","Dawane, Anuja",
  "Sharaff, Nitu","Charan Shetty Halli Guruswamy","Jaspreet Singh Riar"
];

renderTeamsTable();
updateProjectSelect();
updateStats();
document.getElementById('autosave-msg').textContent = '🔄 connecting...';

function initFirebase() { startFirebaseSync(); }
if (window._dbReady) { initFirebase(); }
else { window.addEventListener('firebase-ready', initFirebase); }

document.getElementById('rank-judge-name').addEventListener('change', renderRankInputs);

// ── EDIT RANKINGS ─────────────────────────────────────────────────────────────
function editRanking(idx) {
  const r = rankings[idx];
  if (!r) return;
  document.getElementById('rank-judge-name').value = r.judge;
  // Switch to rankings tab
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-rankings').classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b => {
    if (b.textContent.includes('Rankings')) b.classList.add('active');
  });
  renderRankInputs();
  // Scroll to form
  document.getElementById('rank-judge-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
window.editRanking = editRanking;

// ── VALIDATION / CHECKING SYSTEM ──────────────────────────────────────────────
function runValidationCheck() {
  const issues = [];

  // Check 1: teams without table numbers
  const noTable = teams.filter(t => !t.tableNum);
  if (noTable.length) issues.push(`⚠️ ${noTable.length} teams have no table number assigned`);

  // Check 2: teams with no judge assigned
  const assignedTeamIds = new Set(judges.flatMap(j => j.tableIds.map(String)));
  const noJudge = teams.filter(t => !assignedTeamIds.has(String(t.id)));
  if (noJudge.length) issues.push(`⚠️ ${noJudge.length} teams have no judge assigned`);

  // Check 3: rank values must be integers 1–5
  rankings.forEach(r => {
    const entries = Object.entries(r.ranks || {});
    const badVals = entries.filter(([, v]) => {
      const rank = Number(v);
      return !Number.isInteger(rank) || rank < 1 || rank > 5;
    });
    if (badVals.length) {
      issues.push(`⚠️ ${r.judge}: ${badVals.length} rank value(s) out of range (must be integers 1–5)`);
    }
  });

  // Check 4: judges with assignments but no rankings submitted
  const judgesWithRankings = new Set(rankings.map(r => r.judge.toLowerCase()));
  const assignedJudges = judges.filter(j => j.tableIds.length > 0 && !j.absent);
  const missingRankings = assignedJudges.filter(j => !judgesWithRankings.has(j.name.toLowerCase()));
  if (missingRankings.length) issues.push(`⚠️ ${missingRankings.length} judges haven't submitted rankings yet: ${missingRankings.slice(0,3).map(j=>j.name).join(', ')}${missingRankings.length > 3 ? '...' : ''}`);

  // Check 5: teams with fewer than 3 judge rankings
  const teamRankCounts = {};
  rankings.forEach(r => Object.keys(r.ranks||{}).forEach(tid => {
    teamRankCounts[tid] = (teamRankCounts[tid]||0) + 1;
  }));
  const underRanked = teams.filter(t => (teamRankCounts[String(t.id)]||0) < 3);
  if (underRanked.length) issues.push(`⚠️ ${underRanked.length} teams have fewer than 3 judge rankings`);

  const el = document.getElementById('validation-output');
  if (!el) return;
  if (!issues.length) {
    el.innerHTML = '<div style="color:var(--accent3);font-size:0.88rem">✅ All checks passed! Everything looks good.</div>';
  } else {
    el.innerHTML = issues.map(i => `<div style="color:var(--gold);font-size:0.85rem;margin-bottom:6px">${i}</div>`).join('');
  }
}
window.runValidationCheck = runValidationCheck;

// ── CLICKABLE TRACK CARDS (expand runner-up list) ─────────────────────────────
function toggleTrackExpand(trackId) {
  const el = document.getElementById('track-expand-' + trackId.replace(/[^a-z0-9]/gi,'_'));
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
window.toggleTrackExpand = toggleTrackExpand;

Object.assign(window, {
  switchTab,
  autoAssignTableNumbers,
  clearTableNumbers,
  clearAllJudges,
  loadDefaultJudges,
  addJudge,
  importJudgeList,
  confirmJudgePaste,
  autoAssignJudges,
  exportJudgeAssignments,
  printJudgeAssignmentSheet,
  clearAllTeams,
  parseDevpostCSV,
  addManualTeam,
  handleFileUpload,
  doRemoveTeam,
  setTableNum,
  refreshLeaderboard,
  exportResults,
  refreshTracks,
  addSponsorAward,
  deleteSponsorAward,
  saveRankings,
  editRanking,
  runValidationCheck,
  highlightDuplicateRanks,
  toggleTrackExpandByDomId,
  toggleTrackExpand,
  refreshJudgesTab,
  renderRankInputs,
  renderRankingsList,
  renderGlobalScores
});
