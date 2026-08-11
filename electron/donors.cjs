const { net } = require("electron");

/**
 * Donor discovery.
 *
 * CaseFoundry cannot invent a phone's camera, button and port positions: no
 * public database publishes them for any handset. Body width, height and depth
 * are published; everything else is not. Generating a case from spec sheets
 * alone is what produced cases that did not fit.
 *
 * So the app finds an existing, community-printed case for the target phone and
 * measures IT. Fit is then inherited from a model somebody has actually printed,
 * which is the only honest route to "any phone".
 *
 * MakerWorld is the search source because its models are already Bambu 3MF
 * projects. Search and metadata are public; the model FILE is not, so the app
 * opens the model in the user's browser where they are signed in and they save
 * the file themselves. That respects both the download gate and the licences,
 * which on MakerWorld are frequently CC-BY-NC-ND (no derivatives).
 *
 * This runs in the main process because the renderer's Content-Security-Policy
 * forbids outbound connections.
 */

const SEARCH_ENDPOINT =
  "https://makerworld.com/api/v1/search-service/select/design2";
const DETAIL_ENDPOINT = "https://makerworld.com/api/v1/design-service/design";

const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESULTS = 20;

/**
 * Terms that indicate a listing is not a protective case for the phone body.
 * A "camera lens protector" or a "phone stand" matches the same keywords but is
 * useless as a fit donor.
 */
const NOT_A_CASE = [
  /lens protector/i,
  /screen protector/i,
  /phone stand/i,
  /phone holder/i,
  /wall mount/i,
  /car mount/i,
  /dock\b/i,
  /keychain/i,
];

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: "GET", url });
    request.setHeader("Accept", "application/json");
    // MakerWorld rejects requests without a browser-shaped referer.
    request.setHeader("Referer", "https://makerworld.com/en/search/models");

    const timer = setTimeout(() => {
      request.abort();
      reject(new Error("MakerWorld did not respond in time"));
    }, REQUEST_TIMEOUT_MS);

    request.on("response", (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        clearTimeout(timer);
        response.resume();
        reject(new Error(`MakerWorld returned HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(new Error(`MakerWorld sent a malformed response: ${error.message}`));
        }
      });
    });

    request.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not reach MakerWorld: ${error.message}`));
    });
    request.end();
  });
}

/**
 * Scores how likely a listing is to be a usable fit donor.
 *
 * Download count is the strongest available signal: a case downloaded
 * thousands of times has been printed by many people, and a case that does not
 * fit does not stay popular. This is a popularity proxy for fit, not proof of
 * it, which is why the app still requires a fit coupon before a full print.
 */
function scoreDonor(hit, phoneQuery) {
  const title = String(hit.title ?? "");
  if (NOT_A_CASE.some((pattern) => pattern.test(title))) return -1;

  const downloads = Number(hit.downloadCount ?? 0);
  const likes = Number(hit.likeCount ?? 0);

  // Reward listings whose title actually names the queried model.
  const tokens = phoneQuery
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 1);
  const lowerTitle = title.toLowerCase();
  const matched = tokens.filter((token) => lowerTitle.includes(token)).length;
  const titleMatch = tokens.length ? matched / tokens.length : 0;

  // Log-scale the popularity so one viral model does not dominate the ranking.
  const popularity = Math.log10(downloads + 1) + Math.log10(likes + 1) * 0.5;
  return titleMatch * 4 + popularity;
}

/**
 * Searches MakerWorld for candidate donor cases for a phone.
 *
 * Returns ranked candidates with a page URL. It deliberately does NOT download
 * anything: the file endpoint requires the user's session, and many models
 * carry a no-derivatives licence.
 */
async function searchDonors(phone) {
  const query = `${phone.brand} ${phone.model} case`.trim();
  const url =
    `${SEARCH_ENDPOINT}?orderBy=score&designType=0` +
    `&keyword=${encodeURIComponent(query)}&limit=${MAX_RESULTS}&offset=0`;

  const payload = await requestJson(url);
  const hits = Array.isArray(payload.hits) ? payload.hits : [];

  return hits
    .map((hit) => ({
      id: hit.id,
      title: String(hit.title ?? "Untitled"),
      url: `https://makerworld.com/en/models/${hit.id}`,
      downloads: Number(hit.downloadCount ?? 0),
      likes: Number(hit.likeCount ?? 0),
      creator: hit.designCreator?.name ?? null,
      score: scoreDonor(hit, query),
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score);
}

/** Fetches public metadata for one donor, including its licence. */
async function donorDetail(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error("Donor id must be a positive integer");
  }
  const payload = await requestJson(`${DETAIL_ENDPOINT}/${numericId}`);
  return {
    id: numericId,
    title: payload.title ?? null,
    summary: typeof payload.summary === "string" ? payload.summary.slice(0, 4000) : null,
    downloads: Number(payload.downloadCount ?? 0),
    likes: Number(payload.likeCount ?? 0),
    licence: payload.license ?? payload.licence ?? null,
    url: `https://makerworld.com/en/models/${numericId}`,
  };
}

module.exports = { donorDetail, searchDonors, scoreDonor };
