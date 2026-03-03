import pc from "picocolors";

const PAPERCLIP_ART = [
  " ____   _    ____  _____ ____   ____ _     ___ ____  ",
  "|  _ \\ / \\  |  _ \\| ____|  _ \\ / ___| |   |_ _|  _ \\ ",
  "| |_) / _ \\ | |_) |  _| | |_) | |   | |    | || |_) |",
  "|  __/ ___ \\|  __/| |___|  _ <| |___| |___ | ||  __/ ",
  "|_| /_/   \\_\\_|   |_____|_| \\_\\\\____|_____|___|_|    ",
] as const;

const TAGLINE = "Open-source orchestration for zero-human companies";

export function printPaperclipCliBanner(): void {
  const lines = [
    "",
    ...PAPERCLIP_ART.map((line) => pc.cyan(line)),
    pc.blue("  ------------------------------------------------------"),
    pc.bold(pc.white(`  ${TAGLINE}`)),
    "",
  ];

  console.log(lines.join("\n"));
}
