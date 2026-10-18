// Shared pure rules from the initial implementation. No GAS service dependencies.
/* GAS global namespace. Only explicitly exported entry points are callable by clients. */
var Quiz = typeof Quiz === 'undefined' ? {} : Quiz;
Quiz.schemaVersion = 1;
Quiz.schema = {
  bank: {
    Questions: 'questionId title body field unit difficulty puzzleType primaryAnswer hintText hintThresholdSeconds explanation approvalStatus reuseEnabled archived version createdAt updatedAt',
    Answers: 'answerId questionId acceptedText normalizationProfile notes',
    QuestionImages: 'questionImageId questionId driveFileId sortOrder altText licenseNotes archived',
    Sources: 'sourceId title publisher url retrievedAt driveFileId licenseNotes field unit',
    QuestionSources: 'questionSourceId questionId sourceId notes',
    Categories: 'categoryId type label parentId enabled sortOrder'
  },
  records: {
    SchoolYears: 'schoolYearId label startDate endDate active',
    Classes: 'classId schoolYearId name groupCount active',
    Groups: 'groupId classId groupNumber displayName active',
    Games: 'gameId schoolYearId classId status joinCodeHash questionCount filtersJson settingsJson activeQuestionIndex deadlineAt remainingMsOnPause stateVersion createdAt startedAt endedAt isSimulation',
    GameQuestions: 'gameQuestionId gameId questionId questionVersion sortOrder questionSnapshotJson hintShownAt startedAt deadlineAt closedAt',
    Participants: 'participantId gameId groupId sessionTokenHash connectionStatus joinedAt lastSeenAt revokedAt',
    Responses: 'responseId gameId gameQuestionId groupId requestId answerRaw answerNormalized serverReceivedAt accepted isPreHint source createdAt',
    Scores: 'scoreId gameId gameQuestionId groupId finalResponseId isCorrect preHintEligible points manualOverride overrideReason updatedAt',
    GameResults: 'resultId gameId groupId totalPoints rank finalizedAt',
    Settings: 'settingKey valueJson updatedAt',
    AuditLogs: 'auditId actor action entityType entityId beforeJson afterJson reason createdAt',
    BackupRuns: 'backupId status folderId manifestFileId startedAt finishedAt error'
  }
};
Quiz.columns = function (table) {
  var raw = Object.prototype.hasOwnProperty.call(Quiz.schema.bank, table) ? Quiz.schema.bank[table] :
    (Object.prototype.hasOwnProperty.call(Quiz.schema.records, table) ? Quiz.schema.records[table] : null);
  if (!raw) throw new Error('UNKNOWN_TABLE');
  return raw.split(' ');
};
Quiz.defaults = {
  // Proposed defaults, not fixed requirements. All must become editable in Phase 5/6.
  hintRemainingSeconds: {easy: 30, standard: 45, hard: 60},
  openingSeconds: 10, explanationSeconds: 20, transitionSeconds: 5,
  rankingSeconds: 20, pollIntervalMs: 3000,
  joinCodeLifetimeMinutes: 30, backupRetention: 7, backupIntervalHours: 24,
  volume: 0.3, muted: false
};
Quiz.rules = {
  easy: {seconds: 60, full: 10, hinted: 8},
  standard: {seconds: 90, full: 20, hinted: 15},
  hard: {seconds: 120, full: 30, hinted: 20}
};

var Quiz = typeof Quiz === 'undefined' ? {} : Quiz;
Quiz.assert = function (condition, code) { if (!condition) throw new Error(code); };
Quiz.text = function (value, name, max, optional) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  Quiz.assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'INVALID_' + name);
  return value.trim();
};
Quiz.id = function (value) {
  Quiz.assert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value), 'INVALID_ID');
  return value;
};
Quiz.url = function (value) {
  if (!value) return '';
  Quiz.assert(typeof value === 'string' && value.length <= 2048 && /^https:\/\/[A-Za-z0-9.-]+(?::443)?(?:[/?#][^\s]*)?$/.test(value), 'INVALID_URL');
  return value;
};
Quiz.integer = function (value, min, max, code) {
  Quiz.assert(Number.isInteger(value) && value >= min && value <= max, code || 'INVALID_INTEGER');
  return value;
};
Quiz.clone = function (value) { return JSON.parse(JSON.stringify(value)); };
// Each cell is a JSON literal; spreadsheet formula prefixes can never be first.
// This also preserves strings such as 001, bools, arrays and ISO timestamps.
Quiz.cellEncode = function (value) {
  Quiz.assert(value !== undefined && typeof value !== 'function', 'INVALID_CELL');
  var encoded = JSON.stringify(value);
  Quiz.assert(encoded.length <= 45000, 'CELL_TOO_LARGE');
  return encoded;
};
Quiz.cellDecode = function (value) {
  if (value === '') return null;
  Quiz.assert(typeof value === 'string', 'INVALID_CELL_ENCODING');
  try { return JSON.parse(value); } catch (error) { throw new Error('INVALID_CELL_ENCODING'); }
};
Quiz.requireTeacher = function (activeEmail, allowedEmails) {
  Quiz.assert(typeof activeEmail === 'string' && activeEmail.trim() !== '', 'TEACHER_IDENTITY_UNAVAILABLE');
  var normalized = activeEmail.trim().toLowerCase();
  Quiz.assert(Array.isArray(allowedEmails) && allowedEmails.some(function (email) {
    return typeof email === 'string' && email.trim().toLowerCase() === normalized;
  }), 'TEACHER_FORBIDDEN');
  return normalized;
};

Quiz.isoDate = function (value) {
  Quiz.assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID_DATE');
  var d = new Date(value + 'T00:00:00.000Z');
  Quiz.assert(!isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value, 'INVALID_DATE');
  return value;
};
Quiz.hasRule = function (value) { return ['easy', 'standard', 'hard'].indexOf(value) >= 0; };

var Quiz = typeof Quiz === 'undefined' ? {} : Quiz;
Quiz.normalize = function (input, profile) {
  Quiz.assert(typeof input === 'string' && input.length <= 2000, 'INVALID_ANSWER');
  profile = profile || {};
  var result = input.normalize('NFKC').trim().toLowerCase();
  // Units/decimal notation are NOT silently removed. Register exact aliases instead.
  if (profile.numeric === true) {
    Quiz.assert(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(result), 'INVALID_NUMERIC_ANSWER');
    Quiz.assert(Number.isFinite(Number(result)), 'INVALID_NUMERIC_ANSWER');
    result = String(Number(result));
  }
  return result;
};
Quiz.correct = function (answer, question) {
  return [{text: question.primaryAnswer, profile: {}}].concat(question.answers || []).some(function (alias) {
    try { return Quiz.normalize(answer, alias.profile) === Quiz.normalize(alias.text, alias.profile); }
    catch (error) { return false; }
  });
};
Quiz.score = function (question, responses) {
  var accepted = responses.filter(function (r) { return r.accepted; });
  // Input order is server persistence order; stable ties resolve to the later row.
  accepted.sort(function (a, b) { return Date.parse(a.serverReceivedAt) - Date.parse(b.serverReceivedAt); });
  var last = accepted[accepted.length - 1];
  var correct = !!last && Quiz.correct(last.answerRaw, question);
  var eligible = correct && accepted.some(function (r) { return r.isPreHint && Quiz.correct(r.answerRaw, question); });
  var rule = Quiz.rules[question.difficulty];
  Quiz.assert(Quiz.hasRule(question.difficulty), 'INVALID_DIFFICULTY');
  return {finalResponseId: last ? last.responseId : null, isCorrect: correct,
    preHintEligible: !!eligible, points: correct ? (eligible ? rule.full : rule.hinted) : 0};
};
Quiz.rank = function (totals) {
  var sorted = totals.map(Quiz.clone).sort(function (a, b) { return b.totalPoints - a.totalPoints || a.groupId.localeCompare(b.groupId); });
  sorted.forEach(function (entry, i) { entry.rank = i && entry.totalPoints === sorted[i - 1].totalPoints ? sorted[i - 1].rank : i + 1; });
  return sorted;
};
Quiz.estimate = function (questions, settings) {
  var s = Object.assign({}, Quiz.defaults, settings || {});
  ['openingSeconds', 'explanationSeconds', 'transitionSeconds', 'rankingSeconds'].forEach(function (key) {
    Quiz.integer(s[key], 0, 3600, 'INVALID_DURATION');
  });
  var answering = questions.reduce(function (sum, q) {
    Quiz.assert(Quiz.hasRule(q.difficulty), 'INVALID_DIFFICULTY');
    return sum + Quiz.rules[q.difficulty].seconds;
  }, 0);
  var result = {answering: answering, opening: s.openingSeconds,
    explanation: questions.length * s.explanationSeconds,
    transition: Math.max(0, questions.length - 1) * s.transitionSeconds, ranking: s.rankingSeconds};
  result.total = result.answering + result.opening + result.explanation + result.transition + result.ranking;
  return result;
};
Quiz.selectQuestions = function (questions, criteria, usedIds, random) {
  random = random || Math.random;
  usedIds = usedIds || [];
  Quiz.integer(criteria.count, 1, 50, 'INVALID_QUESTION_COUNT');
  var eligible = questions.filter(function (q) { return q.approvalStatus === 'approved' && q.reuseEnabled === true && q.archived === false; });
  var matching = eligible.filter(function (q) {
    return (!criteria.fields || !criteria.fields.length || criteria.fields.indexOf(q.field) >= 0) &&
      (!criteria.units || !criteria.units.length || criteria.units.indexOf(q.unit) >= 0);
  });
  // Shuffle first, then stable sort by class-specific prior use.
  for (var i = matching.length - 1; i > 0; i--) {
    var j = Math.floor(random() * (i + 1));
    var temp = matching[i]; matching[i] = matching[j]; matching[j] = temp;
  }
  matching.sort(function (a, b) { return Number(usedIds.indexOf(a.questionId) >= 0) - Number(usedIds.indexOf(b.questionId) >= 0); });
  var selected = [];
  if (criteria.distribution) {
    Quiz.assert(Object.keys(criteria.distribution).every(function (d) { return Quiz.hasRule(d); }), 'INVALID_DISTRIBUTION');
    var total = 0;
    Object.keys(criteria.distribution).forEach(function (d) {
      var count = Quiz.integer(criteria.distribution[d], 0, 50, 'INVALID_DISTRIBUTION'); total += count;
      selected = selected.concat(matching.filter(function (q) { return q.difficulty === d; }).slice(0, count));
    });
    Quiz.assert(total === criteria.count, 'INVALID_DISTRIBUTION');
  } else { selected = matching.slice(0, criteria.count); }
  var shortage = selected.length < criteria.count;
  return {selected: Quiz.clone(selected), requiresApproval: shortage, shortage: criteria.count - selected.length,
    alternatives: shortage ? Quiz.clone(eligible.filter(function (q) { return !selected.some(function (s) { return s.questionId === q.questionId; }); })) : []};
};
Quiz.statistics = function (rows) {
  var real = rows.filter(function (r) { return !r.isSimulation; });
  var denominator = real.length;
  return {denominator: denominator, finalRate: denominator ? real.filter(function (r) { return r.isCorrect; }).length / denominator : null,
    preHintRate: denominator ? real.filter(function (r) { return r.preHintEligible; }).length / denominator : null,
    smallSample: denominator < 10};
};
// Pure server-time clock. Call under the script lock; never accept now from clients.
Quiz.clock = {
  start: function (difficulty, now, hintRemainingSeconds) {
    var rule = Quiz.rules[difficulty]; Quiz.assert(Quiz.hasRule(difficulty), 'INVALID_DIFFICULTY');
    Quiz.integer(now, 0, Number.MAX_SAFE_INTEGER, 'INVALID_TIME');
    var threshold = hintRemainingSeconds === undefined || hintRemainingSeconds === null ? Quiz.defaults.hintRemainingSeconds[difficulty] : hintRemainingSeconds;
    Quiz.integer(threshold, 0, rule.seconds, 'INVALID_HINT_THRESHOLD');
    return {status: 'question', deadlineAt: now + rule.seconds * 1000,
      hintDueAt: now + (rule.seconds - threshold) * 1000, hintShownAt: null, remainingMsOnPause: null, hintRemainingMsOnPause: null};
  },
  tick: function (state, now) {
    var s = Quiz.clone(state);
    if (s.status !== 'question') return s;
    // Preserve the scheduled hint instant even if polling is delayed.
    if (now >= s.hintDueAt && s.hintShownAt === null) s.hintShownAt = s.hintDueAt;
    if (now >= s.deadlineAt) s.status = 'closed';
    return s;
  },
  pause: function (state, now) {
    var s = Quiz.clock.tick(state, now); Quiz.assert(s.status === 'question', 'INVALID_TRANSITION');
    s.remainingMsOnPause = s.deadlineAt - now;
    s.hintRemainingMsOnPause = Math.max(0, s.hintDueAt - now); s.status = 'paused'; return s;
  },
  resume: function (state, now) {
    var s = Quiz.clone(state); Quiz.assert(s.status === 'paused', 'INVALID_TRANSITION');
    s.deadlineAt = now + s.remainingMsOnPause;
    if (s.hintShownAt === null) s.hintDueAt = now + s.hintRemainingMsOnPause;
    s.remainingMsOnPause = null; s.hintRemainingMsOnPause = null; s.status = 'question'; return s;
  },
  extend: function (state, now, seconds) {
    Quiz.integer(seconds, 1, 600, 'INVALID_EXTENSION');
    var s = Quiz.clock.tick(state, now); Quiz.assert(s.status === 'question' || s.status === 'paused', 'INVALID_TRANSITION');
    if (s.status === 'paused') { s.remainingMsOnPause += seconds * 1000; if (s.hintShownAt === null) s.hintRemainingMsOnPause += seconds * 1000; }
    else { s.deadlineAt += seconds * 1000; if (s.hintShownAt === null) s.hintDueAt += seconds * 1000; }
    return s;
  },
  acceptance: function (state, now) {
    var s = Quiz.clock.tick(state, now);
    return {accepted: s.status === 'question' && now < s.deadlineAt,
      isPreHint: s.status === 'question' && now < s.hintDueAt};
  }
};

var Quiz = typeof Quiz === 'undefined' ? {} : Quiz;
Quiz.validateQuestion = function (input) {
  Quiz.assert(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_QUESTION');
  var q = {};
  ['title', 'body', 'unit', 'puzzleType', 'primaryAnswer', 'hintText', 'explanation'].forEach(function (key) {
    q[key] = Quiz.text(input[key], key.toUpperCase(), key === 'body' || key === 'explanation' ? 10000 : 2000);
  });
  Quiz.assert(['geography', 'history', 'civics'].indexOf(input.field) >= 0, 'INVALID_FIELD'); q.field = input.field;
  Quiz.assert(['easy', 'standard', 'hard'].indexOf(input.difficulty) >= 0, 'INVALID_DIFFICULTY'); q.difficulty = input.difficulty;
  q.hintThresholdSeconds = input.hintThresholdSeconds === undefined || input.hintThresholdSeconds === null ? null :
    Quiz.integer(input.hintThresholdSeconds, 0, Quiz.rules[q.difficulty].seconds, 'INVALID_HINT_THRESHOLD');
  Quiz.assert(input.acceptedAnswers === undefined || Array.isArray(input.acceptedAnswers), 'INVALID_ALIASES');
  q.acceptedAnswers = (input.acceptedAnswers || []).map(function (a) { return Quiz.text(a, 'ALIAS', 2000); });
  Quiz.assert(q.acceptedAnswers.length <= 30, 'TOO_MANY_ALIASES');
  Quiz.assert(Array.isArray(input.sources) && input.sources.length > 0 && input.sources.length <= 30, 'SOURCES_REQUIRED');
  q.sources = input.sources.map(function (s) {
    Quiz.assert(s && typeof s === 'object', 'INVALID_SOURCE');
    Quiz.isoDate(s.retrievedAt);
    Quiz.assert(s.url || s.driveFileId || s.unverified === true, 'SOURCE_LOCATION_REQUIRED');
    return {sourceId: s.sourceId ? Quiz.id(s.sourceId) : null, title: Quiz.text(s.title, 'SOURCE_TITLE', 500), publisher: Quiz.text(s.publisher, 'PUBLISHER', 500),
      url: Quiz.url(s.url), retrievedAt: s.retrievedAt, driveFileId: s.driveFileId ? (/^sources\/[A-Za-z0-9-]+$/.test(s.driveFileId) ? s.driveFileId : Quiz.id(s.driveFileId)) : '',
      unverified: s.unverified === true, licenseNotes: (s.unverified === true ? '[出典未確認] ' : '') + Quiz.text(s.licenseNotes, 'LICENSE', 2000, true).replace(/^(\[出典未確認\] )+/, ''), field: q.field, unit: q.unit};
  });
  return q;
};
Quiz.questionDraft = function (input, runtime) {
  var parsed = Quiz.validateQuestion(input), now = runtime.now();
  var row = Object.assign({}, parsed, {questionId: runtime.uuid(), approvalStatus: 'unreviewed', reuseEnabled: true,
    archived: false, version: 1, createdAt: now, updatedAt: now});
  delete row.acceptedAnswers; delete row.sources;
  return {question: row,
    answers: parsed.acceptedAnswers.map(function (a) { return {answerId: runtime.uuid(), questionId: row.questionId,
      acceptedText: a, normalizationProfile: '{}', notes: ''}; }), sources: parsed.sources};
};
Quiz.similarQuestions = function (input, existing) {
  var text = function (q) { return Quiz.normalize(q.body).replace(/\s/g, ''); };
  var grams = function (s) { var out = new Set(); for (var i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; };
  var a = grams(text(input));
  return existing.map(function (q) {
    var b = grams(text(q)), intersection = 0; a.forEach(function (g) { if (b.has(g)) intersection++; });
    var union = a.size + b.size - intersection;
    var overlap = union ? intersection / union : (text(input) === text(q) ? 1 : 0);
    var sameApproach = input.puzzleType === q.puzzleType && input.unit === q.unit;
    return {questionId: q.questionId, textSimilarity: overlap, sameApproach: sameApproach};
  }).filter(function (r) { return r.textSimilarity >= 0.45 || r.sameApproach; });
};
Quiz.imageDeletionAllowed = function (driveFileId, imageRows, snapshots) {
  Quiz.id(driveFileId);
  // Even archived questions and historical snapshots protect files from physical deletion.
  return !imageRows.some(function (r) { return r.driveFileId === driveFileId; }) &&
    !(snapshots || []).some(function (s) { return (s.images || []).some(function (i) { return i.driveFileId === driveFileId; }); });
};

export default Quiz;
