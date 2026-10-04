import {
  buildArchiveSearchPlan,
  parseArchiveSearchQuery,
  rankArchiveSearchCandidate,
} from "../src/lib/archive-search-query";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function checkParsed(input: string, expectedQuery: string, recent = false) {
  const parsed = parseArchiveSearchQuery(input);

  check(
    parsed.query === expectedQuery && parsed.recent === recent,
    `Archive query "${input}" parsed as ${JSON.stringify(parsed)}.`,
  );
}

for (const [input, expected] of [
  ["Merci AppleMint", "Merci AppleMint"],
  ["find Merci AppleMint", "Merci AppleMint"],
  ["find the archive for Merci AppleMint", "Merci AppleMint"],
  ["search archive AppleMint", "AppleMint"],
  ["Can you find Slavomir's file", "Slavomir"],
  ["can u find ChatGPT Image Jun 12, 2026, 07_30_15 PM (1).png", "ChatGPT Image Jun 12, 2026, 07_30_15 PM (1).png"],
  ["find the file named final-master-carton.pdf", "final-master-carton.pdf"],
  ["show archived project Premium Rebrand", "Premium Rebrand"],
  ["where is the Merci AppleMint archive", "Merci AppleMint"],
  ["give me the file of project test3", "test3"],
  ["show me archives from project Test Campaign", "Test Campaign"],
  ["find original file name source-artwork.ai", "source-artwork.ai"],
  ["find file name: campaign-preview.png", "campaign-preview.png"],
  ["search by archive file name: final-artwork.pdf", "final-artwork.pdf"],
  ["find project named Premium Rebrand", "Premium Rebrand"],
  ["find artwork ID ART-2026-0002", "ART-2026-0002"],
  ["show files in archive category Digital & Website", "Digital & Website"],
  ["find files tagged with asset tag Campaign Launch", "Campaign Launch"],
  ["asset tag: Campaign Launch", "Campaign Launch"],
  ["project: test3", "test3"],
  ["I need to find the file for test3 project", "test3"],
  ["do you have Slavomir's file?", "Slavomir"],
  ["Flux metadata fixture", "Flux metadata fixture"],
]) {
  checkParsed(input, expected);
}
checkParsed("show recent archives", "", true);

const exactMatch = rankArchiveSearchCandidate(
  {
    archiveName: "Merci AppleMint",
    projectName: "Premium Rebrand",
    archivedFileNames: ["final-master-carton.pdf"],
  },
  "MERCI APPLEMINT",
);
const prefixMatch = rankArchiveSearchCandidate(
  { archiveName: "Merci AppleMint" },
  "Merci",
);
const containsMatch = rankArchiveSearchCandidate(
  { archiveName: "Merci AppleMint" },
  "AppleMint",
);
const projectMatch = rankArchiveSearchCandidate(
  {
    archiveName: "Archived Artwork",
    projectName: "Premium Rebrand",
  },
  "Premium Rebrand",
);
const filenameMatch = rankArchiveSearchCandidate(
  {
    archiveName: "Premium Rebrand",
    archivedFileNames: ["final-master-carton.pdf"],
  },
  "master-carton",
);
const unicodeWhitespaceFilenameMatch = rankArchiveSearchCandidate(
  {
    archiveName: "Premium Rebrand",
    archivedFileNames: ["Screenshot 2026-08-16 at 11.19.18\u202fAM.png"],
  },
  "Screenshot 2026-08-16 at 11.19.18 AM.png",
);
const artworkIdMatch = rankArchiveSearchCandidate(
  {
    archiveName: "Premium Rebrand",
    artworkIds: ["ART-2026-0002"],
  },
  "ART-2026-0002",
);
const assetTagMatch = rankArchiveSearchCandidate(
  {
    archiveName: "Premium Rebrand",
    assetTags: ["Digital & Website"],
  },
  "Digital & Website",
);
const punctuationInsensitiveAssetTagMatch = rankArchiveSearchCandidate(
  {
    archiveName: "Premium Rebrand",
    assetTags: ["Digital & Website"],
  },
  "Website Digital",
);
const exactCategoryBeatsLooseArchiveNameMatch = rankArchiveSearchCandidate(
  {
    archiveName: "Flux metadata fixture file 123.pdf",
    archiveCategory: "Flux metadata fixture 123",
  },
  "Flux metadata fixture 123",
);
const artworkMetadataMatch = rankArchiveSearchCandidate(
  {
    archiveName: "Production package",
    entries: [
      {
        field: "Colour space",
        value: "RGB",
        kind: "ARTWORK_METADATA",
        matchedFileName: "production-package.pdf",
      },
    ],
  },
  "colour space RGB",
);
const archivedByMatch = rankArchiveSearchCandidate(
  {
    archiveName: "Production package",
    entries: [
      {
        field: "Archived by",
        value: "Admin One",
        kind: "ARCHIVED_BY",
      },
    ],
  },
  "archived by Admin One",
);
const combinedMetadataMatch = rankArchiveSearchCandidate(
  {
    archiveName: "Production package",
    projectName: "test3",
    entries: [
      {
        field: "Colour space",
        value: "RGB",
        kind: "ARTWORK_METADATA",
        matchedFileName: "production-package.pdf",
      },
      {
        field: "Created by",
        value: "User Two",
        kind: "ARTWORK_METADATA",
        matchedFileName: "production-package.pdf",
      },
    ],
  },
  "test3 with colour space RGB created by User Two",
);

const archiveDatePlan = buildArchiveSearchPlan(
  "archives archived on 17 August 2026",
);
const filenameDatePlan = buildArchiveSearchPlan(
  "ChatGPT Image Jun 12, 2026, 07_30_15 PM.png",
);
const archivedBySentencePlan = buildArchiveSearchPlan(
  "that Archived by Admin One",
);
const misspelledArchiveSentencePlan = buildArchiveSearchPlan(
  "archieves from test1",
);
const archivedBySentenceMatch = rankArchiveSearchCandidate(
  {
    archiveName: "test1",
    entries: [
      {
        field: "Archived by",
        value: "Admin One",
        kind: "ARCHIVED_BY",
      },
    ],
  },
  "that Archived by Admin One",
);

check(exactMatch?.rank === 0, "Exact archive-name matches must rank first.");
check(prefixMatch?.rank === 1, "Archive-name prefix matches must rank second.");
check(containsMatch?.rank === 2, "Archive-name contains matches must rank third.");
check(projectMatch?.rank === 3, "Project metadata must rank below archive names.");
check(
  filenameMatch?.kind === "ARCHIVED_FILE_NAME" &&
    filenameMatch.matchedFileName === "final-master-carton.pdf",
  "Archived filename matches must identify the real matching file.",
);
check(
  unicodeWhitespaceFilenameMatch?.kind === "ARCHIVED_FILE_NAME",
  "Equivalent Unicode filename whitespace must still match.",
);
check(artworkIdMatch?.kind === "ARTWORK_ID", "Artwork IDs must be searchable.");
check(assetTagMatch?.kind === "ASSET_TAG", "Asset tags must be searchable.");
check(
  punctuationInsensitiveAssetTagMatch?.kind === "ASSET_TAG",
  "Asset tags must tolerate punctuation and natural word ordering.",
);
check(
  exactCategoryBeatsLooseArchiveNameMatch?.kind === "ARCHIVE_CATEGORY",
  "An exact metadata match must beat a loose archive-name token match.",
);
check(
  artworkMetadataMatch?.kind === "ARTWORK_METADATA" &&
    artworkMetadataMatch.matchedFileName === "production-package.pdf",
  "Every expanded artwork metadata field must identify its matching file.",
);
check(
  archivedByMatch?.kind === "ARCHIVED_BY",
  "Archived-by wording must match archive ownership data.",
);
check(
  combinedMetadataMatch?.matchedFileName === "production-package.pdf",
  "One natural-language query must be able to combine project and artwork fields.",
);
check(
  archiveDatePlan.date?.field === "ARCHIVED" &&
    archiveDatePlan.date.start.toISOString().startsWith("2026-08-17"),
  "Archive date wording must produce an archived-date filter.",
);
check(
  filenameDatePlan.date === null && filenameDatePlan.terms.includes("chatgpt"),
  "A date embedded in a filename must remain filename text, not become a date filter.",
);
check(
  archivedBySentencePlan.terms.join(" ") === "admin one" &&
    archivedBySentenceMatch?.kind === "ARCHIVED_BY",
  "Conversational archived-by wording must not turn 'that' into a search filter.",
);
check(
  misspelledArchiveSentencePlan.terms.join(" ") === "test1",
  "Common archive misspellings such as 'archieves' must not outrank the real project term.",
);

console.log("Flux AI archive query checks passed.");

check(
  buildArchiveSearchPlan("FLUX-ART-489dbdcb-e476-4d16-920b-9d3fd3f7a819").fileSize === null,
  "An artwork identifier containing a numeric UUID segment ending in b must not become a byte-size filter.",
);
check(buildArchiveSearchPlan("files 920b").fileSize?.min === 920, "Standalone byte-size queries must remain supported.");
