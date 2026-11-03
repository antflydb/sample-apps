import type { Result, Source } from "../types";

// Mock-mode fixtures shaped like docs/API.md. Photos and the video point at
// public-domain NASA assets on images-assets.nasa.gov; audio and PDFs are
// generated in the browser (see assets.ts). Transcript and report snippets
// are placeholder text for layout, not quotes from the real documents
// (except Apollo 11's first words on the Moon).

export interface Fixture extends Result {
  /** Extra words the mock matches on; stripped from responses. */
  tags: string;
}

const nasa = (id: string) => `https://images-assets.nasa.gov/image/${id}/${id}~medium.jpg`;
const S3 = { id: "nasa-media", kind: "s3" as const, name: "NASA media" };
const DRIVE = { id: "mission-reports", kind: "drive" as const, name: "Mission reports" };

function img(file: string, nasaId: string, tags: string): Fixture {
  return {
    id: `nasa-media:images/${file}`,
    title: file,
    kind: "image",
    mime_type: "image/jpeg",
    source: S3,
    path: `images/${file}`,
    file_url: nasa(nasaId),
    web_url: "",
    score: 0,
    matches: [],
    tags,
  };
}

export function fixtures(urls: { smallStep: string; eva: string; report: string; debrief: string }): Fixture[] {
  return [
    img("sts61-eva-9401031.jpg", "9401031", "astronaut eva spacewalk hubble telescope repair servicing sts-61 endeavour"),
    img("sts061-65-015.jpg", "sts061-65-015", "hubble telescope earth australia fisheye orbit sts-61"),
    img("sts38-night-launch.jpg", "s38-s-027", "launch night atlantis shuttle liftoff pad fire"),
    img("as11-40-5877.jpg", "as11-40-5877", "apollo 11 bootprint footprint moon lunar surface step"),
    img("as11-40-5902.jpg", "as11-40-5902", "apollo 11 aldrin astronaut moon lunar module walk"),
    img("sts61-wetf-rehearsal.jpg", "s93-33104", "astronaut training pool hubble repair rehearsal tools sts-61"),
    {
      id: "nasa-media:audio/apollo11-small-step.mp3",
      title: "apollo11-small-step.mp3",
      kind: "audio",
      mime_type: "audio/mpeg",
      source: S3,
      path: "audio/apollo11-small-step.mp3",
      file_url: urls.smallStep,
      web_url: "",
      score: 0,
      matches: [
        { type: "segment", start_ms: 2130, end_ms: 9800, text: "That's one small step for man, one giant leap for mankind." },
      ],
      tags: "apollo 11 armstrong moon step first words lunar",
    },
    {
      id: "nasa-media:audio/sts61-eva3-loop.mp3",
      title: "sts61-eva3-loop.mp3",
      kind: "audio",
      mime_type: "audio/mpeg",
      source: S3,
      path: "audio/sts61-eva3-loop.mp3",
      file_url: urls.eva,
      web_url: "",
      score: 0,
      matches: [
        { type: "segment", start_ms: 41_000, end_ms: 47_500, text: "…the WFPC is in, latches are closed…" },
        { type: "segment", start_ms: 96_200, end_ms: 103_000, text: "Houston, the new camera is seated and we're moving to the next task." },
        { type: "segment", start_ms: 131_000, end_ms: 136_000, text: "…copy, the telescope looks good from here." },
        { type: "segment", start_ms: 150_000, end_ms: 154_000, text: "…stowing the old camera in the payload bay." },
      ],
      tags: "astronaut eva spacewalk hubble telescope repair camera night sts-61 houston",
    },
    {
      id: "nasa-media:video/hst-sm4-release.mp4",
      title: "hst-sm4-release.mp4",
      kind: "video",
      mime_type: "video/mp4",
      source: S3,
      path: "video/hst-sm4-release.mp4",
      file_url:
        "https://images-assets.nasa.gov/video/GSFC_20080822_HST_m10235_Release_BTY_002/GSFC_20080822_HST_m10235_Release_BTY_002~mobile.mp4",
      web_url: "",
      score: 0,
      matches: [{ type: "segment", start_ms: 4000, end_ms: 9000, text: "Hubble released from the robotic arm." }],
      tags: "hubble telescope release arm servicing deploy orbit",
    },
    {
      id: "mission-reports:1AbCsts61report",
      title: "STS-61 Mission Report",
      kind: "pdf",
      mime_type: "application/pdf",
      source: DRIVE,
      path: "STS-61 Mission Report.pdf",
      file_url: urls.report,
      web_url: "https://drive.google.com/file/d/1AbCsts61report/view",
      score: 0,
      matches: [
        { type: "page", page: 47, text: "EVA 3 replaced the Wide Field and Planetary Camera…" },
        { type: "page", page: 52, text: "…corrective optics installed and the aperture door closed." },
        { type: "page", page: 12, text: "The crew repaired the telescope over five spacewalks." },
        { type: "page", page: 58, text: "…night passes slowed the work on the solar arrays." },
      ],
      tags: "hubble telescope repair servicing astronaut eva sts-61 report optics camera",
    },
    {
      id: "mission-reports:1XyZapollo11debrief",
      title: "Apollo 11 Technical Crew Debriefing",
      kind: "pdf",
      mime_type: "application/pdf",
      source: DRIVE,
      path: "Apollo 11 Technical Crew Debriefing.pdf",
      file_url: urls.debrief,
      web_url: "https://drive.google.com/file/d/1XyZapollo11debrief/view",
      score: 0,
      matches: [
        { type: "page", page: 9, text: "…the first step off the footpad felt solid underfoot." },
        { type: "page", page: 21, text: "Launch was smooth through staging." },
      ],
      tags: "apollo 11 moon step lunar launch debrief crew armstrong aldrin",
    },
    {
      id: "mission-reports:1QrSlaunchnotes",
      title: "launch-weather-notes.txt",
      kind: "text",
      mime_type: "text/plain",
      source: DRIVE,
      path: "launch-weather-notes.txt",
      file_url: "data:text/plain;charset=utf-8,Night%20launch%20window%20opened%20at%2004%3A27.",
      web_url: "https://drive.google.com/file/d/1QrSlaunchnotes/view",
      score: 0,
      matches: [
        { type: "text", text: "Night launch window opened at 04:27; winds were within limits." },
        { type: "text", text: "…the pad lights made the plume visible from the causeway." },
      ],
      tags: "launch night weather pad shuttle window",
    },
  ];
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export function initialSources(): Source[] {
  return [
    {
      id: "nasa-media",
      kind: "s3",
      name: "NASA media",
      location: "s3://antfly-nasa-demo/media/",
      status: "idle",
      last_synced_at: minutesAgo(12),
      error: "",
      files: 412,
      by_kind: { image: 300, audio: 108, video: 4 },
    },
    {
      id: "mission-reports",
      kind: "drive",
      name: "Mission reports",
      location: "Google Drive folder",
      status: "syncing",
      last_synced_at: null,
      error: "",
      files: 40,
      by_kind: { pdf: 38, text: 2 },
    },
  ];
}
