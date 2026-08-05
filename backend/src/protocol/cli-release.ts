export interface CliReleaseArtifact {
  name: string;
  mediaType: string;
  sha256: string;
  size: number;
}

export interface CliReleaseManifest {
  schemaVersion: 1;
  version: string;
  minimumNodeVersion: "22.0.0";
  providers: ["claude", "codex"];
  files: {
    bundle: CliReleaseArtifact;
    macosLinuxInstaller: CliReleaseArtifact;
    windowsInstaller: CliReleaseArtifact;
  };
}
