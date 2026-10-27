# Release privacy checks

Run `pwsh -NoProfile -File tools/test-release-privacy.ps1` for synthetic
regression tests. Windows PowerShell 5.1 is also supported. The application
checks and Windows release workflow both run these tests. No installer is
built or executed by the tests.

Run `pwsh -NoProfile -File tools/check-release-privacy.ps1 -Version VERSION`
to check both existing source and portable ZIPs. `-ArtifactDirectory` selects
a separate fixture or artifact directory; it does not change the source root.

EXE and DLL entries, including dependency DLLs, are scanned directly from the
archive regardless of size. Bounded, overlapping reads inspect UTF-8 and both
UTF-16LE byte alignments for home directories, absolute debug/source paths,
and common credential patterns. Findings omit the matched value. Read errors
and regex timeouts fail the check; no target executable is loaded or run.
The existing text, credential-filename and standalone PDB checks remain.

`config/release-privacy-runtime-paths.json` contains 216 exact UTF-8 path hashes
for public debug/source references in the shipped runtimes. They were checked
in the v1.0.28 portable archive
(SHA-256 `26885081f9dbfd7669e81386cc5fcab7f3287f4d4ad07392034464bdec53cef2`).
The packaged Node 24.22.1 executable has SHA-256
`d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5`,
matching `win-x64/node.exe` in the [official checksum manifest](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt).
The .NET source and mapped PDB references were checked against the official
NETCore and WindowsDesktop 10.0.13 runtime packages. Their SHA-512 hashes were
verified against NuGet registration/catalog metadata and recorded in the
registry. The native `singlefilehost` PDB reference is the previously reviewed
apphost reference. No local project path was accepted into the registry.
These exceptions never exempt an entire binary, directory prefix, or filename.
A toolchain update that changes a path must fail pending review. Verify the
runtime provenance before adding an exception; never allow a personal build
directory merely to make a release pass. Do not publish private path values
in diagnostics, fixtures, or review discussions.

This is a static string safeguard, not a complete privacy or binary audit.
It does not unpack encrypted/compressed executable resources or recursively
scan nested archives. Relative paths, unrecognized encodings and private
facts outside the checked patterns still require review. Existing historical
commits, tags and published packages are not modified by these checks.
