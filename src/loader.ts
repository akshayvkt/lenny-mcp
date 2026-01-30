import { readdir, readFile, mkdir, access } from "fs/promises";
import { join } from "path";
import { createWriteStream } from "fs";

export interface Episode {
  guest: string;
  content: string;
  path: string;
}

// GitHub repository URL for transcripts
const GITHUB_URL =
  "https://github.com/ChatPRD/lennys-podcast-transcripts/archive/refs/heads/main.zip";

// Default paths
const DEFAULT_LOCAL_PATH =
  process.env.LENNY_TRANSCRIPTS_PATH ||
  "/Users/venkatakshaychintalapati/Downloads/Lenny's Podcast Transcripts Archive [public]";

const HOSTED_TRANSCRIPTS_PATH = "./transcripts";

// Determine which path to use
function getTranscriptsPath(): string {
  if (process.env.MCP_MODE === "sse") {
    return HOSTED_TRANSCRIPTS_PATH;
  }
  return DEFAULT_LOCAL_PATH;
}

// Strip YAML frontmatter from markdown content
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) return content;
  return content.slice(endIdx + 3).trim();
}

// Extract guest name from YAML frontmatter
function extractGuestFromFrontmatter(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) return null;
  const match = content.slice(0, endIdx).match(/^guest:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

// Convert folder name to guest name as fallback
// e.g., "elena-verna-20" → "Elena Verna"
function folderToGuest(folder: string): string {
  return folder
    .replace(/[-_]\d+$/, "") // Remove trailing numbers like "-20"
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Download transcripts from GitHub (for hosted mode)
export async function downloadTranscripts(): Promise<void> {
  const targetPath = HOSTED_TRANSCRIPTS_PATH;

  // Check if transcripts already exist
  try {
    await access(targetPath);
    const entries = await readdir(targetPath, { withFileTypes: true });
    const episodeDirs = entries.filter((e) => e.isDirectory());
    if (episodeDirs.length > 100) {
      console.error(
        `Transcripts already exist at ${targetPath} (${episodeDirs.length} episodes)`
      );
      return;
    }
  } catch {
    // Directory doesn't exist, we need to download
  }

  console.error("Downloading transcripts from GitHub...");

  try {
    // Create target directory
    await mkdir(targetPath, { recursive: true });

    // Download the zip file
    const response = await fetch(GITHUB_URL, {
      redirect: "follow",
      headers: {
        "User-Agent": "lenny-mcp/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const zipPath = "/tmp/lenny-transcripts.zip";
    const fileStream = createWriteStream(zipPath);

    // Write response to file
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    let receivedBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(value);
      receivedBytes += value.length;
      if (receivedBytes % (1024 * 1024) === 0) {
        console.error(`Downloaded ${Math.round(receivedBytes / 1024 / 1024)}MB...`);
      }
    }
    fileStream.end();

    console.error(`Download complete (${Math.round(receivedBytes / 1024 / 1024)}MB)`);

    // Extract the zip file using unzip command (simpler and more reliable)
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    console.error("Extracting transcripts...");
    const tempExtractPath = "/tmp/lenny-extract";

    // Clean up any previous extraction attempt
    try {
      await execAsync(`rm -rf "${tempExtractPath}"`);
    } catch {
      // Ignore if doesn't exist
    }

    // Extract to temp directory (preserves folder structure)
    await execAsync(`unzip -o "${zipPath}" -d "${tempExtractPath}"`);

    // GitHub zips extract to: lennys-podcast-transcripts-main/episodes/{guest}/transcript.md
    const extractedEpisodesPath = `${tempExtractPath}/lennys-podcast-transcripts-main/episodes`;

    // Move episode folders to target path
    await execAsync(`cp -r "${extractedEpisodesPath}"/* "${targetPath}/"`);

    // Clean up temp files
    try {
      await execAsync(`rm -rf "${tempExtractPath}" "${zipPath}"`);
    } catch {
      // Ignore cleanup errors
    }

    // Verify extraction by counting episode directories
    const entries = await readdir(targetPath, { withFileTypes: true });
    const episodeDirs = entries.filter((e) => e.isDirectory());
    if (episodeDirs.length < 50) {
      throw new Error(`Only found ${episodeDirs.length} episodes, expected 300+`);
    }
    console.error(`Extracted ${episodeDirs.length} episode transcripts`);
  } catch (error) {
    console.error("Error downloading transcripts:", error);
    throw error;
  }
}

export async function loadTranscripts(): Promise<Episode[]> {
  const episodes: Episode[] = [];
  const transcriptsPath = getTranscriptsPath();

  try {
    const entries = await readdir(transcriptsPath, { withFileTypes: true });
    const directories = entries.filter((e) => e.isDirectory());

    console.error(
      `Loading transcripts from ${directories.length} episode folders in ${transcriptsPath}...`
    );

    for (const dir of directories) {
      const transcriptPath = join(transcriptsPath, dir.name, "transcript.md");

      try {
        const rawContent = await readFile(transcriptPath, "utf-8");
        const guest =
          extractGuestFromFrontmatter(rawContent) || folderToGuest(dir.name);
        const content = stripFrontmatter(rawContent);

        episodes.push({
          guest,
          content,
          path: transcriptPath,
        });
      } catch {
        // Skip directories without transcript.md (e.g., .git, scripts, index)
      }
    }

    console.error(`Loaded ${episodes.length} episodes successfully.`);
  } catch (error) {
    console.error(`Error loading transcripts: ${error}`);
    throw error;
  }

  return episodes;
}

// Extract a snippet around a match position
export function extractSnippet(
  content: string,
  searchTerms: string[],
  snippetLength: number = 500
): string {
  const lowerContent = content.toLowerCase();

  // Find the first occurrence of any search term
  let bestPosition = -1;
  for (const term of searchTerms) {
    const pos = lowerContent.indexOf(term.toLowerCase());
    if (pos !== -1 && (bestPosition === -1 || pos < bestPosition)) {
      bestPosition = pos;
    }
  }

  if (bestPosition === -1) {
    // No match found, return the beginning (skip first ~2000 chars which are usually ads)
    const startAfterAds = Math.min(2000, content.length);
    return content.slice(startAfterAds, startAfterAds + snippetLength) + "...";
  }

  // Extract snippet centered around the match
  const halfLength = Math.floor(snippetLength / 2);
  const start = Math.max(0, bestPosition - halfLength);
  const end = Math.min(content.length, bestPosition + halfLength);

  let snippet = content.slice(start, end);

  // Try to start at a sentence/paragraph boundary
  if (start > 0) {
    const newlinePos = snippet.indexOf("\n");
    if (newlinePos !== -1 && newlinePos < 100) {
      snippet = snippet.slice(newlinePos + 1);
    }
    snippet = "..." + snippet;
  }

  if (end < content.length) {
    snippet = snippet + "...";
  }

  return snippet.trim();
}

// Parse timestamp from transcript line (e.g., "Lenny (00:03:42):" -> "00:03:42")
export function extractTimestamp(text: string): string | null {
  const match = text.match(/\((\d{2}:\d{2}:\d{2})\)/);
  return match ? match[1] : null;
}
