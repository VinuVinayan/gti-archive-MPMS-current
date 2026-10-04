export const archiveSearchMatchKindValues = [
  "ARCHIVE_NAME", "PROJECT_NAME", "PROJECT_METADATA", "ARCHIVE_CATEGORY",
  "ARCHIVED_FILE_NAME", "FILE_METADATA", "ARTWORK_ID", "ARTWORK_METADATA",
  "ASSET_TAG", "ARCHIVED_BY", "ARCHIVED_DATE",
] as const;

export type ArchiveSearchMatchKind = (typeof archiveSearchMatchKindValues)[number];

export type ArchiveSearchEntry = {
  field: string;
  value: string;
  kind: ArchiveSearchMatchKind;
  matchedFileName?: string | null;
  aliases?: string[];
};

export type ArchiveSearchCandidate = {
  archiveName: string;
  projectName?: string | null;
  archiveCategory?: string | null;
  archivedFileNames?: string[];
  artworkIds?: string[];
  assetTags?: string[];
  entries?: ArchiveSearchEntry[];
};

export type ArchiveSearchMatch = {
  rank: number;
  kind: ArchiveSearchMatchKind;
  matchedFileName: string | null;
  matchedField: string;
  matchedValue: string;
};

export type ParsedArchiveSearchQuery = { query: string; recent: boolean };

export type ArchiveSearchDateField =
  | "ANY" | "ARCHIVED" | "CREATED" | "MODIFIED" | "APPROVED"
  | "GO_LIVE" | "EXPIRY" | "PROJECT";

export type ArchiveSearchDateFilter = {
  field: ArchiveSearchDateField;
  start: Date;
  end: Date;
};

export type ArchiveSearchPlan = {
  terms: string[];
  date: ArchiveSearchDateFilter | null;
  fileSize: {
    min: number;
    max: number;
    tokens: string[];
  } | null;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeArchiveSearchText(value: string | null | undefined) {
  return normalizeWhitespace(value ?? "").toLocaleLowerCase();
}

function normalizeComparableArchiveSearchText(value: string | null | undefined) {
  return normalizeArchiveSearchText(value)
    .normalize("NFKC")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const archiveSearchRequestPrefixes = [
  /^(?:hey\s+)?flux\s+ai\s*[,.:;-]\s+/i,
  /^where\s+can\s+i\s+(?:find|locate|get)(?:\s+the)?\s+/i,
  /^where\s+(?:is|are)(?:\s+the)?\s+/i,
  /^(?:(?:can|could|would|will)\s+(?:you|u)|(?:can|could|would)\s+i)\s+/i,
  /^(?:i\s+(?:would|'d)\s+like|i\s+(?:want|need))(?:\s+you)?(?:\s+to)?\s+/i,
  /^(?:do\s+you\s+have|have\s+you\s+got)\s+/i,
  /^please\s+/i,
  /^(?:find|locate|look\s+up|search(?:\s+for)?|show|view|display|list|open|fetch|retrieve|get|give|send)(?:\s+(?:to\s+)?me)?(?:\s+(?:all|any|the))?\s+/i,
];

const archiveSearchSubjectPrefixes = [
  /^(?:(?:an?|the)\s+)?(?:(?:archive|archived)\s+)?files?\s+(?:for|of|from)\s+(?:(?:an?|the)\s+)?projects?(?:\s+(?:named|called))?\s+/i,
  /^(?:(?:an?|the)\s+)?archives?\s+(?:for|of|from)\s+(?:(?:an?|the)\s+)?projects?(?:\s+(?:named|called))?\s+/i,
  /^(?:(?:an?|the)\s+)?(?:files?|archives?)\s+(?:in|under|from)\s+(?:(?:an?|the)\s+)?(?:archive\s+)?categor(?:y|ies)\s+/i,
  /^(?:(?:an?|the)\s+)?(?:files?|archives?)\s+(?:tagged(?:\s+with)?|with\s+(?:(?:an?|the)\s+)?(?:asset\s+)?tags?)\s+/i,
  /^(?:(?:an?|the)\s+)?archives?\s+(?:for|of|from)\s+/i,
  /^(?:by\s+|with\s+)?(?:(?:an?|the)\s+)?(?:original\s+file\s*names?|original\s+filenames?|archive(?:d)?\s+file\s*names?|archive(?:d)?\s+filenames?|file\s*names?|filenames?)(?:(?:\s+(?:named|called|is|equals?))?\s+|\s*[:=]\s*)/i,
  /^(?:by\s+|with\s+)?(?:(?:an?|the)\s+)?artworks?\s*(?:ids?|identifiers?)(?:(?:\s+(?:named|called|is|equals?))?\s+|\s*[:=]\s*)/i,
  /^(?:by\s+|with\s+)?(?:(?:an?|the)\s+)?(?:asset\s+)?tags?(?:(?:\s+(?:named|called|is|equals?))?\s+|\s*[:=]\s*)/i,
  /^(?:by\s+|in\s+|under\s+)?(?:(?:an?|the)\s+)?(?:archive\s+)?categor(?:y|ies)(?:(?:\s+(?:named|called|is|equals?))?\s+|\s*[:=]\s*)/i,
  /^(?:by\s+|for\s+|of\s+)?(?:(?:an?|the)\s+)?(?:archive(?:d)?\s+)?projects?(?:\s+names?)?(?:(?:\s+(?:named|called|is|equals?))?\s+|\s*[:=]\s*)/i,
  /^(?:by\s+|for\s+|of\s+)?(?:(?:an?|the)\s+)?archives?(?:\s+names?)?(?:(?:\s+(?:named|called|is|equals?))?\s+|\s*[:=]\s*)/i,
  /^(?:(?:an?|the)\s+)?(?:(?:archive|archived)\s+)?files?\s+(?:named|called)\s+/i,
  /^(?:(?:an?|the)\s+)?(?:(?:archive|archived)\s+)?files?\s+(?:for|of|from)\s+/i,
  /^(?:(?:an?|the)\s+)?(?:(?:archive|archived)\s+)?files?\s+/i,
];

const archiveSearchSubjectSuffixes = [
  /\s+please$/i,
  /(?:['’]s)\s+(?:(?:archive|archived)\s+)?files?$/i,
  /\s+(?:archive\s+categor(?:y|ies)|categor(?:y|ies))$/i,
  /\s+(?:asset\s+)?tags?$/i,
  /\s+artworks?\s*(?:ids?|identifiers?)$/i,
  /\s+(?:archives?|archived\s+projects?|projects?)$/i,
  /\s+(?:(?:archive|archived)\s+)?files?$/i,
];

function trimArchiveSearchQuery(value: string) {
  return normalizeWhitespace(value.replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’.?!]+$/g, ""));
}

function removeArchiveSearchFraming(value: string) {
  let query = trimArchiveSearchQuery(value);
  for (let pass = 0; pass < 8; pass += 1) {
    const previousQuery = query;
    for (const prefix of [...archiveSearchRequestPrefixes, ...archiveSearchSubjectPrefixes]) {
      const strippedQuery = trimArchiveSearchQuery(query.replace(prefix, ""));
      if (strippedQuery && strippedQuery !== query) {
        query = strippedQuery;
        break;
      }
    }
    for (const suffix of archiveSearchSubjectSuffixes) {
      const strippedQuery = trimArchiveSearchQuery(query.replace(suffix, ""));
      if (strippedQuery && strippedQuery !== query) {
        query = strippedQuery;
        break;
      }
    }
    if (query === previousQuery) break;
  }
  return query;
}

export function parseArchiveSearchQuery(value: string | null | undefined): ParsedArchiveSearchQuery {
  const rawQuery = normalizeWhitespace(value ?? "");
  if (!rawQuery) return { query: "", recent: false };
  const normalizedRawQuery = normalizeArchiveSearchText(rawQuery);
  const recent =
    /^(?:please\s+)?(?:show|find|list|view|display|search)(?:\s+me)?(?:\s+the)?\s+(?:most\s+)?(?:recent|latest)\s+archives?$/.test(normalizedRawQuery) ||
    /^(?:recent|latest)\s+archives?$/.test(normalizedRawQuery);
  return recent
    ? { query: "", recent: true }
    : { query: removeArchiveSearchFraming(rawQuery), recent: false };
}

const monthIndexes = new Map<string, number>([
  ["jan", 0], ["january", 0], ["feb", 1], ["february", 1], ["mar", 2], ["march", 2],
  ["apr", 3], ["april", 3], ["may", 4], ["jun", 5], ["june", 5], ["jul", 6],
  ["july", 6], ["aug", 7], ["august", 7], ["sep", 8], ["sept", 8], ["september", 8],
  ["oct", 9], ["october", 9], ["nov", 10], ["november", 10], ["dec", 11], ["december", 11],
]);
const monthPattern = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

function inferArchiveSearchDateField(query: string): ArchiveSearchDateField {
  if (/\b(?:expiry|sunset)\b/i.test(query)) return "EXPIRY";
  if (/\b(?:go[ -]?live|on[ -]?shelf)\b/i.test(query)) return "GO_LIVE";
  if (/\b(?:last\s+modified|modified|updated)\b/i.test(query)) return "MODIFIED";
  if (/\bapproved(?:\s+(?:at|on|in)|\s+date)?\b/i.test(query)) return "APPROVED";
  if (/\b(?:creation\s+date|created\s+(?:at|on|in)|created\s+date)\b/i.test(query)) return "CREATED";
  if (/\bproject\s+date\b/i.test(query)) return "PROJECT";
  if (/\b(?:archived|uploaded)(?:\s+(?:at|on|in)|\s+date)?\b/i.test(query)) return "ARCHIVED";
  return "ANY";
}

function hasArchiveDateIntent(query: string) {
  return /\b(?:archived|uploaded)(?:\s+(?:at|on|in|date))|\barchives?\s+(?:from|in|on)|\b(?:creation\s+date|created\s+(?:at|on|in)|created\s+date|last\s+modified|modified\s+(?:at|on|in)|approved\s+(?:at|on|in)|approved\s+date|go[ -]?live|on[ -]?shelf|expiry|sunset|project\s+date)\b/i.test(query);
}

function makeArchiveSearchDateFilter(input: { year: number; month?: number; day?: number; field: ArchiveSearchDateField }): ArchiveSearchDateFilter | null {
  const { year, month, day, field } = input;
  if (year < 1900 || year > 2200) return null;
  if (month === undefined) return { field, start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
  if (month < 0 || month > 11) return null;
  if (day === undefined) return { field, start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 1)) };
  const start = new Date(Date.UTC(year, month, day));
  if (day < 1 || day > 31 || start.getUTCFullYear() !== year || start.getUTCMonth() !== month || start.getUTCDate() !== day) return null;
  return { field, start, end: new Date(Date.UTC(year, month, day + 1)) };
}

function extractArchiveSearchDate(query: string) {
  const field = inferArchiveSearchDateField(query);
  const patterns: Array<{ expression: RegExp; read: (match: RegExpMatchArray) => ArchiveSearchDateFilter | null }> = [
    { expression: /\b(19\d{2}|20\d{2}|21\d{2})-(\d{1,2})-(\d{1,2})\b/i, read: (m) => makeArchiveSearchDateFilter({ year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]), field }) },
    { expression: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})[,]?\\s+(19\\d{2}|20\\d{2}|21\\d{2})\\b`, "i"), read: (m) => makeArchiveSearchDateFilter({ year: Number(m[3]), month: monthIndexes.get(m[2].toLowerCase()), day: Number(m[1]), field }) },
    { expression: new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(19\\d{2}|20\\d{2}|21\\d{2})\\b`, "i"), read: (m) => makeArchiveSearchDateFilter({ year: Number(m[3]), month: monthIndexes.get(m[1].toLowerCase()), day: Number(m[2]), field }) },
    { expression: new RegExp(`\\b(${monthPattern})\\s+(19\\d{2}|20\\d{2}|21\\d{2})\\b`, "i"), read: (m) => makeArchiveSearchDateFilter({ year: Number(m[2]), month: monthIndexes.get(m[1].toLowerCase()), field }) },
    { expression: /\b(19\d{2}|20\d{2}|21\d{2})\b/i, read: (m) => makeArchiveSearchDateFilter({ year: Number(m[1]), field }) },
  ];
  for (const pattern of patterns) {
    const match = query.match(pattern.expression);
    if (!match) continue;
    const outsideDate = normalizeComparableArchiveSearchText(query.replace(match[0], " "))
      .replace(/\b(?:find|search|show|list|give|fetch|retrieve|me|the|an?|any|all|archive|archives|archived|file|files|item|items|from|in|on|at|date|please)\b/g, " ")
      .replace(/\s+/g, " ").trim();
    if (!hasArchiveDateIntent(query) && outsideDate) continue;
    const date = pattern.read(match);
    if (date) return { date, matchedText: match[0] };
  }
  return { date: null, matchedText: "" };
}

const archiveSearchFieldPhrases = [
  /\boriginal\s+file\s*name\b/gi, /\barchive(?:d)?\s+file\s*name\b/gi, /\bfile\s*name\b/gi,
  /\bartwork\s+(?:id|identifier)\b/gi, /\barchive\s+categor(?:y|ies)\b/gi, /\basset\s+tags?\b/gi,
  /\bproject\s+(?:name|category|tags?|metadata)\b/gi, /\barchived\s+by\b/gi, /\buploaded\s+by\b/gi,
  /\bcreated\s+by\b/gi, /\bapproved\s+by\b/gi, /\btitle\s*(?:\/|or)?\s*working\s+name\b/gi,
  /\bversion\s*(?:\/|or)?\s*revision\b/gi, /\blanguage\s*(?:\/|or)?\s*market\b/gi,
  /\bartwork\s+type\b/gi, /\bbrand\s*(?:\/|or)?\s*sub[ -]?brand\b/gi, /\bproduct\s+sku\b/gi,
  /\bcampaign\s*(?:\/|or)?\s*project\b/gi, /\bformat\s*(?:\/|or)?\s*dimensions?\b/gi,
  /\bcolou?r\s+space\b/gi, /\bfile\s+formats?\b/gi, /\bprint\s+process\b/gi,
  /\bspecial\s+finishes\b/gi, /\barchive\s+status\b/gi,
  /\bclient\s*(?:\/|or)?\s*brand\s+owner\b/gi, /\bregulatory\s+clearance\b/gi,
  /\bfonts?\s+used\b/gi, /\bimages?\s*(?:\/|or)?\s*photography\b/gi,
  /\billustrations?\s*(?:\/|or)?\s*icons?\b/gi, /\bcolou?r\s+codes?\b/gi,
  /\bthird[ -]?party\s+logos?\s*(?:\/|or)?\s*ip\b/gi, /\bsupplier\s*(?:\/|or)?\s*printer\b/gi,
  /\boutput\s+files?\s+list\b/gi, /\bprint\s+proof\s+ref(?:erence)?\b/gi,
  /\bpackaging\s+dieline\s+ref(?:erence)?\b/gi, /\bchange\s+log\b/gi,
  /\brelated\s+artworks?\b/gi, /\bbrief\s*(?:\/|or)?\s*spec\s+links?\b/gi,
  /\bgeneral\s+notes?\b/gi, /\bmime\s+type\b/gi, /\bfile\s+(?:type|size)\b/gi,
  /\b(?:archived|uploaded)\s+(?:date|at|on|in)\b/gi,
  /\b(?:creation\s+date|created\s+(?:date|at|on|in)|last\s+modified|modified\s+(?:date|at|on|in)|approved\s+(?:date|at|on|in)|go[ -]?live|on[ -]?shelf|expiry|sunset|project\s+date)\b/gi,
  /\b(?:project|resolution|brand|format)\b/gi,
];

const archiveSearchStopWords = new Set([
  "a", "an", "all", "and", "any", "are", "based", "by", "called", "can", "could",
  "display", "fetch", "file", "files", "find", "for", "from", "get", "give", "has", "have",
  "i", "in", "is", "item", "items", "list", "locate", "look", "me", "named", "of", "on",
  "open", "please", "related", "retrieve", "search", "show", "the", "this", "to", "under",
  "that", "these", "those", "view", "want", "was", "were", "where", "which", "whose",
  "with", "would", "you", "archive", "archives", "archieve", "archieves",
  "achive", "achives", "achiewe", "achiewes",
]);

function archiveSearchEditDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function isArchiveSearchStopWord(term: string) {
  if (archiveSearchStopWords.has(term)) return true;
  if (term.length < 6 || term === "archived") return false;

  return ["archive", "archives"].some(
    (subject) => archiveSearchEditDistance(term, subject) <= 2,
  );
}

function extractArchiveSearchFileSize(query: string) {
  const match = query.match(/(?<![\w-])(\d+(?:\.\d+)?)\s*(bytes?|b|kb|mb|gb)(?![\w-])/i);
  if (!match) return { fileSize: null, matchedText: "" };

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factor = unit === "gb"
    ? 1024 ** 3
    : unit === "mb"
      ? 1024 ** 2
      : unit === "kb"
        ? 1024
        : 1;
  const center = amount * factor;
  const tolerance = factor === 1 ? 0 : factor * 0.05;

  return {
    matchedText: match[0],
    fileSize: {
      min: Math.max(0, Math.ceil(center - tolerance)),
      max: Math.floor(center + tolerance) + 1,
      tokens: [
        ...match[1].split("."),
        factor === 1 ? "b" : unit,
      ],
    },
  };
}

export function buildArchiveSearchPlan(query: string): ArchiveSearchPlan {
  const extractedDate = extractArchiveSearchDate(query);
  const extractedFileSize = extractArchiveSearchFileSize(query);
  let termSource = extractedDate.matchedText ? query.replace(extractedDate.matchedText, " ") : query;
  if (extractedFileSize.matchedText) {
    termSource = termSource.replace(extractedFileSize.matchedText, " ");
  }
  for (const fieldPhrase of archiveSearchFieldPhrases) termSource = termSource.replace(fieldPhrase, " ");
  const terms = normalizeComparableArchiveSearchText(termSource)
    .split(" ")
    .filter((term) => term.length > 1 && !isArchiveSearchStopWord(term));
  return {
    terms: [...new Set(terms)],
    date: extractedDate.date,
    fileSize: extractedFileSize.fileSize,
  };
}

function getTextMatchRank(value: string | null | undefined, query: string) {
  const normalizedValue = normalizeArchiveSearchText(value);
  const comparableValue = normalizeComparableArchiveSearchText(value);
  const comparableQuery = normalizeComparableArchiveSearchText(query);
  if (!normalizedValue || !query) return null;
  if (normalizedValue === query || (comparableQuery && comparableValue === comparableQuery)) return 0;
  if (normalizedValue.startsWith(query) || (comparableQuery && comparableValue.startsWith(comparableQuery))) return 1;
  if (normalizedValue.includes(query) || (comparableQuery && comparableValue.includes(comparableQuery))) return 2;
  const queryTokens = comparableQuery.split(" ").filter(Boolean);
  return queryTokens.length > 1 && queryTokens.every((token) => comparableValue.includes(token)) ? 3 : null;
}

const kindPriority: Record<ArchiveSearchMatchKind, number> = {
  ARCHIVE_NAME: 0, PROJECT_NAME: 3, ARCHIVE_CATEGORY: 4, ARCHIVED_FILE_NAME: 5,
  ARTWORK_ID: 6, ASSET_TAG: 7, PROJECT_METADATA: 8, ARCHIVED_BY: 9,
  ARCHIVED_DATE: 10, FILE_METADATA: 11, ARTWORK_METADATA: 12,
};

function legacyEntries(candidate: ArchiveSearchCandidate) {
  const entries: ArchiveSearchEntry[] = [{ field: "Archive name", value: candidate.archiveName, kind: "ARCHIVE_NAME" }];
  if (candidate.projectName) entries.push({ field: "Project name", value: candidate.projectName, kind: "PROJECT_NAME" });
  if (candidate.archiveCategory) entries.push({ field: "Archive category", value: candidate.archiveCategory, kind: "ARCHIVE_CATEGORY" });
  for (const value of candidate.archivedFileNames ?? []) entries.push({ field: "Archived filename", value, kind: "ARCHIVED_FILE_NAME", matchedFileName: value });
  for (const value of candidate.artworkIds ?? []) entries.push({ field: "Artwork ID", value, kind: "ARTWORK_ID" });
  for (const value of candidate.assetTags ?? []) entries.push({ field: "Asset tag", value, kind: "ASSET_TAG" });
  return entries;
}

export function rankArchiveSearchCandidate(candidate: ArchiveSearchCandidate, query: string): ArchiveSearchMatch | null {
  const normalizedQuery = normalizeArchiveSearchText(query);
  const entries = [...legacyEntries(candidate), ...(candidate.entries ?? [])].filter((entry) => entry.value.trim());
  if (!normalizedQuery) return { rank: 0, kind: "ARCHIVE_NAME", matchedFileName: null, matchedField: "Archive name", matchedValue: candidate.archiveName };

  const directMatches = entries.flatMap((entry) => {
    const textRank = [entry.value, `${entry.field} ${entry.value}`, ...(entry.aliases ?? [])]
      .flatMap((value) => {
        const rank = getTextMatchRank(value, normalizedQuery);
        return rank === null ? [] : [rank];
      })
      .sort((left, right) => left - right)[0];
    return textRank === undefined ? [] : [{ entry, textRank }];
  }).sort((left, right) => left.textRank - right.textRank || kindPriority[left.entry.kind] - kindPriority[right.entry.kind]);
  if (directMatches[0]) {
    const { entry, textRank } = directMatches[0];
    return { rank: kindPriority[entry.kind] + textRank, kind: entry.kind, matchedFileName: entry.matchedFileName ?? null, matchedField: entry.field, matchedValue: entry.value };
  }

  const plan = buildArchiveSearchPlan(query);
  const datePrecision = plan.date
    ? plan.date.end.getUTCFullYear() === plan.date.start.getUTCFullYear() + 1 ? 4
      : plan.date.end.getUTCMonth() !== plan.date.start.getUTCMonth() ? 7 : 10
    : 0;
  const dateTokens = plan.date ? plan.date.start.toISOString().slice(0, datePrecision).split("-") : [];
  const queryTokens = [
    ...new Set([
      ...plan.terms,
      ...dateTokens,
      ...(plan.fileSize?.tokens ?? []),
    ]),
  ];
  if (!queryTokens.length) return null;

  const searchableEntries = entries.map((entry) => ({ entry, text: normalizeComparableArchiveSearchText([entry.field, entry.value, ...(entry.aliases ?? [])].join(" ")) }));
  if (!queryTokens.every((token) => searchableEntries.some(({ text }) => text.includes(token)))) return null;

  const fileCoverage = new Map<string, number>();
  for (const { entry, text } of searchableEntries) {
    if (!entry.matchedFileName) continue;
    fileCoverage.set(entry.matchedFileName, (fileCoverage.get(entry.matchedFileName) ?? 0) + queryTokens.filter((token) => text.includes(token)).length);
  }
  const matchedFileName = [...fileCoverage.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const comparableQuery = normalizeComparableArchiveSearchText(query);
  const primary = searchableEntries
    .map(({ entry, text }) => {
      const fieldTokens = normalizeComparableArchiveSearchText(entry.field)
        .split(" ")
        .filter(Boolean);
      return {
        entry,
        coverage: queryTokens.filter((token) => text.includes(token)).length,
        explicitField:
          fieldTokens.length > 0 &&
          fieldTokens.every((token) => comparableQuery.includes(token)),
      };
    })
    .filter(({ coverage }) => coverage > 0)
    .sort((left, right) =>
      Number(right.explicitField) - Number(left.explicitField) ||
      right.coverage - left.coverage ||
      kindPriority[left.entry.kind] - kindPriority[right.entry.kind]
    )[0]?.entry;
  if (!primary) return null;
  return { rank: 20 + kindPriority[primary.kind], kind: primary.kind, matchedFileName: matchedFileName ?? primary.matchedFileName ?? null, matchedField: primary.field, matchedValue: primary.value };
}
